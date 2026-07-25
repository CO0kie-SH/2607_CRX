import json
import unittest
from unittest import mock

from aiohttp.test_utils import TestClient, TestServer

from server import app as app_module


def sample_auth_json() -> dict:
    return {
        "auth_mode": "agent_identity",
        "agent_identity": {
            "agent_runtime_id": "agent-runtime-test",
            "agent_private_key": "private-key-test",
            "account_id": "account-test-1234",
            "chatgpt_user_id": "user-test",
            "email": "user@example.com",
            "plan_type": "chatgpt_plus",
            "chatgpt_account_is_fedramp": False,
        },
    }


def sample_config() -> dict:
    return {
        "impersonate": "chrome",
        "sub2api": {
            "base": "https://configured.example",
            "email": "admin@example.com",
            "password": "password-test",
        },
        "import": {
            "name": "auth-{plan}-{email}",
            "group_ids": [12],
            "concurrency": 3,
            "priority": 1,
            "rate_multiplier": 1,
            "auto_pause_on_expired": True,
            "update_existing": True,
            "model_mapping": {"model-a": "model-b"},
            "extra": {"feature": "off"},
        },
    }


class FakeResponse:
    def __init__(self, body: dict, status_code: int = 200):
        self._body = body
        self.status_code = status_code
        self.text = json.dumps(body)

    def json(self) -> dict:
        return self._body


class Sub2ApiHelpersTest(unittest.TestCase):
    def test_auto_url_and_payload(self) -> None:
        auth_json = sample_auth_json()
        config = sample_config()

        base_url = app_module.normalize_sub2api_url("auto", config["sub2api"]["base"])
        custom_url = app_module.normalize_sub2api_url(
            "https://custom.example/sub2api/",
            config["sub2api"]["base"],
        )
        payload = app_module.build_sub2api_import_payload(auth_json, config["import"])

        self.assertEqual(base_url, "https://configured.example")
        self.assertEqual(custom_url, "https://custom.example/sub2api")
        self.assertEqual(payload["name"], "auth-plus-user@example.com")
        self.assertEqual(payload["group_ids"], [12])
        self.assertEqual(payload["credential_extras"]["model_mapping"], {"model-a": "model-b"})
        self.assertEqual(json.loads(payload["content"]), auth_json)
        with self.assertRaises(ValueError):
            app_module.normalize_sub2api_url("file:///tmp/config", config["sub2api"]["base"])

    def test_sync_import_returns_account_id(self) -> None:
        session = mock.MagicMock()
        session.post.side_effect = [
            FakeResponse({"code": 0, "data": {"access_token": "api-token-test"}}),
            FakeResponse({
                "code": 0,
                "data": {
                    "total": 1,
                    "created": 1,
                    "updated": 0,
                    "failed": 0,
                    "items": [{
                        "account_id": 321,
                        "name": "auth-plus-user@example.com",
                        "action": "created",
                    }],
                },
            }),
        ]

        with mock.patch("curl_cffi.requests.Session", return_value=session):
            result = app_module.perform_sub2api_import_sync(
                sample_config(),
                "https://configured.example",
                sample_auth_json(),
            )

        self.assertEqual(result["id"], 321)
        self.assertEqual(result["account_id"], 321)
        self.assertEqual(result["action"], "created")
        self.assertEqual(session.post.call_count, 2)
        login_call, import_call = session.post.call_args_list
        self.assertEqual(login_call.args[0], "https://configured.example/api/v1/auth/login")
        self.assertEqual(
            import_call.args[0],
            "https://configured.example/api/v1/admin/accounts/import/codex-session",
        )
        self.assertEqual(import_call.kwargs["headers"]["Authorization"], "Bearer api-token-test")
        self.assertEqual(import_call.kwargs["json"]["group_ids"], [12])
        session.close.assert_called_once_with()


class Sub2ApiEndpointTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.client = TestClient(TestServer(app_module.create_app()))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()

    async def test_jsonrpc_import_returns_added_id(self) -> None:
        upstream_result = {
            "id": 654,
            "account_id": 654,
            "name": "auth-plus-user@example.com",
            "action": "created",
            "sub2api_url": "https://configured.example",
            "created": 1,
            "updated": 0,
            "failed": 0,
            "warnings": [],
        }

        with (
            mock.patch.object(app_module, "load_sub2api_config", return_value=sample_config()),
            mock.patch.object(
                app_module,
                "perform_sub2api_import_sync",
                return_value=upstream_result,
            ) as perform_import,
        ):
            response = await self.client.post(
                "/api/sub2api/import",
                json={
                    "jsonrpc": "2.0",
                    "method": "sub2api.import",
                    "params": {
                        "token": "crx-0123456789abcdef0123456789abcdef",
                        "sub2api_url": "auto",
                        "auth_json": json.dumps(sample_auth_json()),
                    },
                    "id": 1001,
                },
            )

        payload = await response.json()
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["id"], 1001)
        self.assertEqual(payload["result"]["id"], 654)
        self.assertEqual(payload["result"]["account_id"], 654)
        call_args = perform_import.call_args.args
        self.assertEqual(call_args[1], "https://configured.example")
        self.assertEqual(call_args[2], sample_auth_json())

    async def test_auth_json_must_be_a_string(self) -> None:
        response = await self.client.post(
            "/api/sub2api/import",
            json={
                "jsonrpc": "2.0",
                "method": "sub2api.import",
                "params": {
                    "token": "crx-0123456789abcdef0123456789abcdef",
                    "sub2api_url": "auto",
                    "auth_json": sample_auth_json(),
                },
                "id": 1002,
            },
        )

        payload = await response.json()
        self.assertEqual(response.status, 400)
        self.assertEqual(payload["error"]["code"], -32602)
        self.assertIn("JSON string", payload["error"]["message"])


if __name__ == "__main__":
    unittest.main()
