(() => {
  const JOB_STORAGE_KEY = "button11.job";
  const SESSION_TARGET_URL = "https://chatgpt.com/api/auth/session";
  const WORKSPACE_TARGET_URL = "https://chatgpt.com/backend-api/accounts";
  const AUTHAPI_BASE_URL = "https://auth.openai.com/api/accounts";
  const AGENT_VERSION = "0.138.0-alpha.6";
  const AGENT_HARNESS_ID = "codex-cli";
  const AGENT_RUNNING_LOCATION = "local";
  const TOKEN_PATTERN = /^crx-[0-9a-f]{32}$/i;
  const SESSION_TIMEOUT_MS = 20000;
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_JOB_LOGS = 100;
  let activeJobPromise = null;
  let activeWorkspacePromise = null;
  let activeAuthPromise = null;

  const nowIso = () => new Date().toISOString();
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function createLog(message, level = "info") {
    return {
      time: nowIso(),
      level,
      message
    };
  }

  async function readJob() {
    const result = await chrome.storage.session.get(JOB_STORAGE_KEY);
    return result[JOB_STORAGE_KEY] || null;
  }

  async function replaceJob(job) {
    await chrome.storage.session.set({
      [JOB_STORAGE_KEY]: {
        ...job,
        updatedAt: nowIso()
      }
    });
  }

  async function updateJob(patch, log = null) {
    const current = await readJob();
    await replaceJob({
      ...(current || {}),
      ...patch,
      ...(log ? {
        logs: [...(current?.logs || []), log].slice(-MAX_JOB_LOGS)
      } : {})
    });
  }

  function normalizeBackendBaseUrl(rawValue) {
    const url = new URL(String(rawValue || "http://127.0.0.1:8081/").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("后端地址需要使用 http 或 https。");
    }
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  }

  async function fetchWithTimeout(targetUrl, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(targetUrl, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`请求超时（${timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function waitForSessionPage(tabId) {
    const startedAt = Date.now();
    let lastUrl = "";

    while (Date.now() - startedAt <= SESSION_TIMEOUT_MS) {
      const tab = await chrome.tabs.get(tabId);
      lastUrl = tab.url || lastUrl;

      if (tab.status === "complete" && lastUrl.startsWith(SESSION_TARGET_URL)) {
        return tab;
      }

      if (tab.status === "complete" && lastUrl && !lastUrl.startsWith("about:blank") && !lastUrl.startsWith(SESSION_TARGET_URL)) {
        throw new Error(`Session 页面发生跳转：${lastUrl}`);
      }

      await delay(350);
    }

    throw new Error(`等待 Session 页面超时，最后地址：${lastUrl || "未知"}`);
  }

  async function reloadSessionPageNoCache(tabId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        finish(new Error("无缓存刷新 Session 页面超时。"));
      }, SESSION_TIMEOUT_MS);

      const finish = (error, tab = null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        if (error) {
          reject(error);
          return;
        }
        resolve(tab);
      };

      const onUpdated = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") {
          return;
        }
        const currentUrl = tab.url || "";
        if (currentUrl.startsWith(SESSION_TARGET_URL)) {
          finish(null, tab);
          return;
        }
        if (currentUrl && !currentUrl.startsWith("about:blank")) {
          finish(new Error(`Session 页面刷新后跳转：${currentUrl}`));
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.reload(tabId, { bypassCache: true }).catch((error) => finish(error));
    });
  }

  async function readSessionPage(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const candidates = [
          document.querySelector("pre")?.textContent || "",
          document.body?.innerText || "",
          document.documentElement?.textContent || ""
        ]
          .map((value) => typeof value === "string" ? value.trim() : "")
          .filter(Boolean);

        return {
          title: document.title || "",
          url: window.location.href,
          contentType: document.contentType || "",
          textCandidates: Array.from(new Set(candidates))
        };
      }
    });

    const page = results?.[0]?.result;
    if (!page) {
      throw new Error("Session 页面内容提取失败。");
    }
    return page;
  }

  function parseSessionPage(page) {
    let lastError = "";

    for (const candidate of page.textCandidates || []) {
      try {
        const data = JSON.parse(candidate);
        const accessToken = typeof data?.accessToken === "string" ? data.accessToken.trim() : "";
        if (!accessToken) {
          continue;
        }
        return {
          data,
          accessToken,
          userEmail: typeof data?.user?.email === "string" ? data.user.email.trim() : "",
          expires: typeof data?.expires === "string" ? data.expires : ""
        };
      } catch (error) {
        lastError = error.message || String(error);
      }
    }

    throw new Error(lastError ? `Session JSON 解析失败：${lastError}` : "Session 页面中未发现 accessToken。");
  }

  function decodeBase64UrlJson(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const binary = atob(padded);
    const jsonText = decodeURIComponent(
      Array.from(binary, (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
    );
    return JSON.parse(jsonText);
  }

  function decodeJwtClaims(accessToken) {
    const parts = String(accessToken || "").split(".");
    if (parts.length !== 3) {
      throw new Error("Access Token 不是有效的 JWT 格式。");
    }
    return decodeBase64UrlJson(parts[1]);
  }

  function decodeAccessTokenClaims(accessToken) {
    try {
      const claims = decodeJwtClaims(accessToken);
      const profile = claims?.["https://api.openai.com/profile"] || {};
      const auth = claims?.["https://api.openai.com/auth"] || {};
      return {
        email: typeof profile.email === "string" ? profile.email.trim() : "",
        planType: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type.trim() : "",
        accountId: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id.trim() : "",
        userId: typeof auth.chatgpt_user_id === "string" ? auth.chatgpt_user_id.trim() : ""
      };
    } catch (_error) {
      return {};
    }
  }

  function bytesToBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function buildSshEd25519PublicKey(rawPublicKey) {
    const algorithmName = new TextEncoder().encode("ssh-ed25519");
    const publicKey = rawPublicKey instanceof Uint8Array ? rawPublicKey : new Uint8Array(rawPublicKey);
    const blob = new Uint8Array(4 + algorithmName.length + 4 + publicKey.length);
    const view = new DataView(blob.buffer);
    let offset = 0;

    view.setUint32(offset, algorithmName.length, false);
    offset += 4;
    blob.set(algorithmName, offset);
    offset += algorithmName.length;
    view.setUint32(offset, publicKey.length, false);
    offset += 4;
    blob.set(publicKey, offset);

    return `ssh-ed25519 ${bytesToBase64(blob)}`;
  }

  async function generateEd25519Keypair() {
    if (!globalThis.crypto?.subtle) {
      throw new Error("当前浏览器不支持 Web Crypto。");
    }

    let keyPair = null;
    try {
      keyPair = await globalThis.crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"]
      );
    } catch (error) {
      throw new Error(`当前浏览器不支持 Ed25519：${error.message || String(error)}`);
    }

    const [privateKeyPkcs8, publicKeyRaw] = await Promise.all([
      globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
      globalThis.crypto.subtle.exportKey("raw", keyPair.publicKey)
    ]);

    return {
      privateKey: keyPair.privateKey,
      privateKeyBase64: bytesToBase64(privateKeyPkcs8),
      publicKeySsh: buildSshEd25519PublicKey(publicKeyRaw)
    };
  }

  async function parseAuthApiResponse(response, operationName) {
    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error(`${operationName}响应解析失败：${error.message || String(error)}`);
    }

    if (!response.ok) {
      const details = firstString(data?.error, data?.message, data?.detail, response.statusText);
      throw new Error(`${operationName}失败：HTTP ${response.status}${details ? ` ${details}` : ""}`);
    }
    return data;
  }

  async function registerAuthAgent(accessToken, publicKeySsh) {
    const response = await fetchWithTimeout(`${AUTHAPI_BASE_URL}/v1/agent/register`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        abom: {
          agent_version: AGENT_VERSION,
          agent_harness_id: AGENT_HARNESS_ID,
          running_location: AGENT_RUNNING_LOCATION
        },
        agent_public_key: publicKeySsh
      })
    }, REQUEST_TIMEOUT_MS);
    const data = await parseAuthApiResponse(response, "Agent 注册");
    const agentRuntimeId = firstString(data?.agent_runtime_id);
    if (!agentRuntimeId) {
      throw new Error("Agent 注册响应缺少 agent_runtime_id。");
    }
    return agentRuntimeId;
  }

  async function registerAuthTask(accessToken, agentRuntimeId, privateKey) {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const payload = new TextEncoder().encode(`${agentRuntimeId}:${timestamp}`);
    const signature = await globalThis.crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      payload
    );
    const response = await fetchWithTimeout(
      `${AUTHAPI_BASE_URL}/v1/agent/${encodeURIComponent(agentRuntimeId)}/task/register`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timestamp,
          signature: bytesToBase64(signature)
        })
      },
      REQUEST_TIMEOUT_MS
    );
    const data = await parseAuthApiResponse(response, "Task 注册");
    return firstString(data?.encrypted_task_id);
  }

  function buildAgentIdentityAuthJson(agentRuntimeId, privateKeyBase64, accountInfo) {
    return {
      auth_mode: "agent_identity",
      agent_identity: {
        agent_runtime_id: agentRuntimeId,
        agent_private_key: privateKeyBase64,
        account_id: accountInfo.accountId,
        chatgpt_user_id: accountInfo.userId,
        email: accountInfo.email,
        plan_type: accountInfo.planType,
        chatgpt_account_is_fedramp: false
      }
    };
  }

  async function runAuthExport() {
    const job = await readJob();
    const accessToken = firstString(job?.pageAccessToken, job?.accessToken);
    if (!accessToken) {
      throw new Error("请先完成按钮11的网页 AT 获取任务。");
    }

    const claims = decodeJwtClaims(accessToken);
    const authClaims = claims?.["https://api.openai.com/auth"] || {};
    const profileClaims = claims?.["https://api.openai.com/profile"] || {};
    const accountInfo = {
      accountId: firstString(authClaims.chatgpt_account_id, job?.accountId),
      userId: firstString(authClaims.chatgpt_user_id, job?.userId),
      email: firstString(profileClaims.email, job?.userEmail),
      planType: firstString(authClaims.chatgpt_plan_type, job?.planType) || "free"
    };
    if (!accountInfo.accountId || !accountInfo.userId) {
      throw new Error("网页 AT 缺少 account_id 或 user_id。");
    }

    const priorStatus = job?.status || "success";
    const priorPhase = job?.phase || "completed";
    const priorMessage = job?.message || "任务完成。";
    await updateJob({
      status: "running",
      phase: "generating_auth_key",
      message: "正在生成 AUTH 密钥...",
      authExport: {
        status: "running",
        startedAt: nowIso()
      }
    }, createLog("开始生成 Ed25519 AUTH 密钥。"));

    try {
      const keyPair = await generateEd25519Keypair();
      await updateJob({
        phase: "registering_auth_agent",
        message: "正在注册 Codex Agent..."
      }, createLog("Ed25519 密钥已生成，开始注册 Codex Agent。"));

      const agentRuntimeId = await registerAuthAgent(accessToken, keyPair.publicKeySsh);
      await updateJob({
        phase: "verifying_auth_task",
        message: "Agent 已注册，正在验证 Task..."
      }, createLog(`Agent 已注册：${agentRuntimeId}。`, "success"));

      let taskId = "";
      let taskError = "";
      try {
        taskId = await registerAuthTask(accessToken, agentRuntimeId, keyPair.privateKey);
      } catch (error) {
        taskError = error.message || String(error);
      }

      const authJson = buildAgentIdentityAuthJson(
        agentRuntimeId,
        keyPair.privateKeyBase64,
        accountInfo
      );
      const exportedAt = nowIso();
      await updateJob({
        status: priorStatus,
        phase: priorPhase,
        message: priorMessage,
        authExport: {
          status: taskError ? "warning" : "success",
          agentRuntimeId,
          taskId,
          taskError,
          exportedAt
        }
      }, createLog(
        taskError
          ? `AUTH 已生成，Task 验证提示：${taskError}`
          : "AUTH 已生成并通过 Task 验证。",
        taskError ? "warning" : "success"
      ));

      return {
        ok: true,
        authJson,
        agentRuntimeId,
        taskId,
        taskError,
        exportedAt
      };
    } catch (error) {
      const errorMessage = error.message || String(error);
      await updateJob({
        status: priorStatus,
        phase: priorPhase,
        message: priorMessage,
        authExport: {
          status: "error",
          error: errorMessage,
          completedAt: nowIso()
        }
      }, createLog(`AUTH 生成失败：${errorMessage}`, "error"));
      throw error;
    }
  }

  async function runSub2apiImport(payload = {}) {
    const authResult = await runAuthExport();
    const job = await readJob();
    const backendBaseUrl = normalizeBackendBaseUrl(job?.backendBaseUrl);
    const token = String(job?.token || "").trim();
    const sub2apiUrl = firstString(payload?.sub2apiUrl, payload?.sub2api_url) || "auto";
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error("请先在 Popup 中刷新后端 token。");
    }

    const priorStatus = job?.status || "success";
    const priorPhase = job?.phase || "completed";
    const priorMessage = job?.message || "任务完成。";
    await updateJob({
      status: "running",
      phase: "importing_sub2api",
      message: "AUTH 已生成，正在导入 Sub2API...",
      sub2apiImport: {
        status: "running",
        sub2apiUrl,
        startedAt: nowIso()
      }
    }, createLog(`开始导入 Sub2API，地址模式：${sub2apiUrl}。`));

    try {
      const targetUrl = new URL("api/sub2api/import", backendBaseUrl).toString();
      const result = await requestJsonRpc(
        targetUrl,
        "sub2api.import",
        {
          token,
          sub2api_url: sub2apiUrl,
          auth_json: JSON.stringify(authResult.authJson, null, 2)
        },
        70000
      );
      const accountId = result?.account_id ?? result?.id;
      if (accountId === undefined || accountId === null || accountId === "") {
        throw new Error("Sub2API 导入响应缺少账号 ID。");
      }

      const importedAt = result?.imported_at || nowIso();
      await updateJob({
        status: priorStatus,
        phase: priorPhase,
        message: priorMessage,
        sub2apiImport: {
          status: "success",
          accountId,
          name: result?.name || "",
          action: result?.action || "",
          sub2apiUrl: result?.sub2api_url || sub2apiUrl,
          importedAt
        }
      }, createLog(`Sub2API 导入完成，账号 ID：${accountId}。`, "success"));

      return {
        ok: true,
        accountId,
        name: result?.name || "",
        action: result?.action || "",
        sub2apiUrl: result?.sub2api_url || sub2apiUrl,
        importedAt,
        authTaskError: authResult.taskError || ""
      };
    } catch (error) {
      const errorMessage = error.message || String(error);
      await updateJob({
        status: priorStatus,
        phase: priorPhase,
        message: priorMessage,
        sub2apiImport: {
          status: "error",
          sub2apiUrl,
          error: errorMessage,
          completedAt: nowIso()
        }
      }, createLog(`Sub2API 导入失败：${errorMessage}`, "error"));
      throw error;
    }
  }

  async function requestJsonRpc(targetUrl, method, params, timeoutMs = 8000) {
    const rpcId = Date.now() * 1000000 + Math.floor(Math.random() * 1000000);
    const response = await fetchWithTimeout(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: rpcId
      })
    }, timeoutMs);
    const responseText = await response.text();
    let payload = null;

    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error(`后端响应解析失败：${error.message || String(error)}`);
    }

    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.message || payload?.error || `后端 HTTP ${response.status}`);
    }
    return payload?.result || payload;
  }

  async function saveAccessToken(backendBaseUrl, token, accessToken, userEmail) {
    const targetUrl = new URL("api/at/save", backendBaseUrl).toString();
    const result = await requestJsonRpc(targetUrl, "at.save", {
      token,
      time: nowIso(),
      user: userEmail,
      accessToken
    });
    return {
      savedTo: result.saved_to || "",
      rpcId: result.rpc_id || null
    };
  }

  function generateDeviceId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const value = Math.floor(Math.random() * 16);
      return (character === "x" ? value : ((value & 0x3) | 0x8)).toString(16);
    });
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function collectWorkspaceIds(value, output = new Set(), seen = new WeakSet()) {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return output;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => collectWorkspaceIds(item, output, seen));
      return output;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === "id" && typeof child === "string" && isUuidLike(child)) {
        output.add(child);
      }
      collectWorkspaceIds(child, output, seen);
    }
    return output;
  }

  function firstString(...values) {
    return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
  }

  function extractWorkspaces(data, currentAccountId) {
    const candidates = [data?.data?.items, data?.items, data?.data?.accounts, data?.accounts];
    const items = candidates.find(Array.isArray) || [];
    const byId = new Map();

    for (const item of items) {
      const id = firstString(item?.id, item?.account_id, item?.account?.id);
      if (!isUuidLike(id)) {
        continue;
      }
      byId.set(id, {
        id,
        name: firstString(item?.name, item?.display_name, item?.title, item?.account?.name),
        type: firstString(item?.structure, item?.type, item?.account?.structure, item?.account?.type),
        role: firstString(item?.current_user_role, item?.role, item?.account_user_role, item?.membership?.role),
        isCurrent: Boolean(currentAccountId && id === currentAccountId)
      });
    }

    for (const id of collectWorkspaceIds(data)) {
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: "",
          type: "",
          role: "",
          isCurrent: Boolean(currentAccountId && id === currentAccountId)
        });
      }
    }

    return Array.from(byId.values()).map((workspace, index) => ({
      ...workspace,
      index: index + 1
    }));
  }

  async function fetchWorkspaces(accessToken, currentAccountId) {
    const response = await fetchWithTimeout(WORKSPACE_TARGET_URL, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "OAI-Device-Id": generateDeviceId()
      }
    });
    const responseText = await response.text();
    let data = null;

    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error(`Workspace 响应解析失败：${error.message || String(error)}`);
    }

    if (!response.ok) {
      throw new Error(data?.error || data?.detail || `Workspace HTTP ${response.status}`);
    }

    const workspaces = extractWorkspaces(data, currentAccountId);
    return {
      workspaces,
      workspaceCount: workspaces.length,
      hasDeactivatedWorkspaceHint: responseText.includes("deactivated_workspace")
    };
  }

  async function exchangeWorkspaceSession(tabId, workspaceId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (targetWorkspaceId) => {
        const targetPath = `/api/auth/session?exchange_workspace_token=true&workspace_id=${encodeURIComponent(targetWorkspaceId)}&reason=setCurrentAccount`;
        const response = await fetch(targetPath, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "*/*" }
        });

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          responseText: await response.text()
        };
      },
      args: [workspaceId]
    });

    const result = results?.[0]?.result;
    if (!result) {
      throw new Error("Workspace Session 交换未返回结果。");
    }

    let sessionData = null;
    try {
      sessionData = result.responseText ? JSON.parse(result.responseText) : {};
    } catch (error) {
      throw new Error(`Workspace Session JSON 解析失败：${error.message || String(error)}`);
    }

    if (!result.ok) {
      throw new Error(
        firstString(sessionData?.error, sessionData?.message, sessionData?.detail, result.statusText)
        || `Workspace Session HTTP ${result.status}`
      );
    }

    const accessToken = firstString(sessionData?.accessToken);
    if (!accessToken) {
      throw new Error("目标 Workspace Session 未返回 accessToken。");
    }

    const claims = decodeAccessTokenClaims(accessToken);
    const accountId = claims.accountId || firstString(sessionData?.account?.id);
    if (!accountId || accountId.toLowerCase() !== String(workspaceId).toLowerCase()) {
      throw new Error(`目标 Workspace 校验失败：${accountId || "-"}`);
    }

    return {
      accessToken,
      sessionToken: firstString(sessionData?.sessionToken),
      userEmail: firstString(sessionData?.user?.email, claims.email),
      userId: firstString(sessionData?.user?.id),
      expires: firstString(sessionData?.expires),
      accountId,
      planType: claims.planType || firstString(sessionData?.account?.planType) || "free"
    };
  }

  function mergeWorkspaceAction(job, workspaceId, action, status, message) {
    return {
      ...(job?.workspaceActions || {}),
      [workspaceId]: {
        action,
        status,
        message,
        updatedAt: nowIso()
      }
    };
  }

  async function runWorkspaceAction(payload) {
    const action = String(payload?.action || "");
    const workspaceId = String(payload?.workspaceId || "").trim();
    if (action !== "exchange" && action !== "copy") {
      throw new Error("未知的 Workspace 操作。");
    }
    if (!workspaceId) {
      throw new Error("缺少 Workspace ID。");
    }

    const job = await readJob();
    if (!(job?.pageAccessToken || job?.accessToken) || !Number.isInteger(job?.tabId)) {
      throw new Error("请先完成按钮11的 AT 获取任务。");
    }

    const workspace = (job.workspaces || []).find((item) => String(item?.id || "") === workspaceId);
    if (!workspace) {
      throw new Error("按钮11列表中未找到目标 Workspace。");
    }

    const tab = await chrome.tabs.get(job.tabId);
    if (!String(tab.url || "").startsWith("https://chatgpt.com/")) {
      throw new Error("按钮11的 Session 标签页已离开 ChatGPT 页面。");
    }

    const currentWorkspaceId = firstString(
      job.currentWorkspaceId,
      (job.workspaces || []).find((item) => item?.isCurrent)?.id,
      job.accountId
    );
    if (action === "copy" && !currentWorkspaceId) {
      throw new Error("当前 Workspace ID 为空，请先刷新AT。");
    }

    const priorStatus = job.status || "success";
    const priorPhase = job.phase || "completed";
    const priorMessage = job.message || "任务完成。";
    const actionName = action === "exchange" ? "交换AT" : "复制AT";
    let workspaceActions = mergeWorkspaceAction(job, workspaceId, action, "running", `${actionName}处理中...`);

    await updateJob({
      status: "running",
      phase: "exchanging_workspace",
      message: `正在为 ${workspace.name || workspaceId} 执行${actionName}...`,
      workspaceAction: {
        workspaceId,
        action,
        status: "running"
      },
      workspaceActions
    }, createLog(`开始为 ${workspace.name || workspaceId} 执行${actionName}。`));

    let targetSession = null;
    let restoreError = "";

    try {
      if (action === "copy") {
        try {
          targetSession = await exchangeWorkspaceSession(job.tabId, workspaceId);
        } finally {
          if (currentWorkspaceId.toLowerCase() !== workspaceId.toLowerCase()) {
            try {
              await exchangeWorkspaceSession(job.tabId, currentWorkspaceId);
            } catch (error) {
              restoreError = error.message || String(error);
            }
          }
        }

        if (restoreError) {
          throw new Error(`目标 AT 已获取，但恢复当前 Workspace 失败：${restoreError}`);
        }

        workspaceActions = mergeWorkspaceAction(
          { workspaceActions },
          workspaceId,
          action,
          "success",
          currentWorkspaceId.toLowerCase() === workspaceId.toLowerCase()
            ? "目标 AT 已获取，当前 Workspace 未变化"
            : "目标 AT 已获取，当前 Workspace 已恢复"
        );
        const workspaces = (job.workspaces || []).map((item) => String(item?.id || "") === workspaceId
          ? {
              ...item,
              accessToken: targetSession.accessToken,
              accessTokenLoadedAt: nowIso()
            }
          : item);
        await updateJob({
          status: priorStatus,
          phase: priorPhase,
          message: priorMessage,
          workspaceAction: {
            workspaceId,
            action,
            status: "success"
          },
          workspaces,
          workspaceActions
        }, createLog(`Workspace ${workspace.name || workspaceId} 的 AT 已获取并复制。`, "success"));
        return {
          ok: true,
          action,
          workspaceId,
          accessToken: targetSession.accessToken,
          restoredWorkspaceId: currentWorkspaceId
        };
      }

      targetSession = await exchangeWorkspaceSession(job.tabId, workspaceId);
      let saveResult = { savedTo: "", rpcId: null };
      let saveError = "";
      try {
        saveResult = await saveAccessToken(
          normalizeBackendBaseUrl(job.backendBaseUrl),
          String(job.token || "").trim(),
          targetSession.accessToken,
          targetSession.userEmail
        );
      } catch (error) {
        saveError = error.message || String(error);
      }

      const workspaces = (job.workspaces || []).map((item) => {
        const isTarget = String(item?.id || "").toLowerCase() === targetSession.accountId.toLowerCase();
        return {
          ...item,
          isCurrent: isTarget,
          ...(isTarget ? {
            accessToken: targetSession.accessToken,
            accessTokenLoadedAt: nowIso(),
            exchangeSucceededAt: nowIso(),
            accessTokenSavedTo: saveResult.savedTo || "",
            accessTokenSaveError: saveError
          } : {})
        };
      });
      workspaceActions = mergeWorkspaceAction(
        { workspaceActions },
        workspaceId,
        action,
        saveError ? "warning" : "success",
        saveError ? `已交换，AT 保存提示：${saveError}` : "已交换并保持为当前 Workspace"
      );

      await updateJob({
        status: priorStatus,
        phase: "completed",
        message: saveError ? "Workspace 已交换，空间 AT 已加载，保存存在提示。" : "Workspace 已交换，空间 AT 已加载。",
        currentWorkspaceId: targetSession.accountId,
        workspaces,
        workspaceAction: {
          workspaceId,
          action,
          status: saveError ? "warning" : "success"
        },
        workspaceActions
      }, createLog(
        saveError
          ? `Workspace 已交换，AT 保存提示：${saveError}`
          : `Workspace 已交换为 ${workspace.name || workspaceId}。`,
        saveError ? "warning" : "success"
      ));

      return {
        ok: true,
        action,
        workspaceId,
        accessToken: targetSession.accessToken,
        accountId: targetSession.accountId,
        saveError
      };
    } catch (error) {
      const errorMessage = error.message || String(error);
      workspaceActions = mergeWorkspaceAction({ workspaceActions }, workspaceId, action, "error", errorMessage);
      await updateJob({
        status: priorStatus,
        phase: priorPhase,
        message: priorMessage,
        workspaceAction: {
          workspaceId,
          action,
          status: "error"
        },
        workspaceActions
      }, createLog(errorMessage, "error"));
      throw error;
    }
  }

  async function runJob(payload) {
    const jobId = payload.jobId || `button11-${Date.now()}`;
    const backendBaseUrl = normalizeBackendBaseUrl(payload.backendBaseUrl);
    const token = String(payload.token || "").trim();
    const windowId = Number(payload.windowId);
    const refreshTabId = Number(payload.refreshTabId);
    const isRefresh = Number.isInteger(refreshTabId) && refreshTabId >= 0;

    if (!TOKEN_PATTERN.test(token)) {
      throw new Error("请先在 Popup 中刷新后端 token。");
    }

    await replaceJob({
      id: jobId,
      status: "running",
      phase: "queued",
      progress: 5,
      message: "后台任务已启动。",
      backendBaseUrl,
      token,
      startedAt: nowIso(),
      windowId: Number.isFinite(windowId) ? windowId : null,
      tabId: isRefresh ? refreshTabId : null,
      mode: isRefresh ? "refresh" : "new_tab",
      targetUrl: SESSION_TARGET_URL,
      accessToken: "",
      pageAccessToken: "",
      currentWorkspaceId: "",
      workspaces: [],
      logs: [createLog(isRefresh ? "按钮11刷新任务已启动。" : "按钮11 AT 任务已启动。")]
    });

    let tab = null;

    try {
      if (isRefresh) {
        tab = await chrome.tabs.get(refreshTabId);
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await updateJob({
          tabId: tab.id,
          windowId: tab.windowId,
          phase: "refreshing_session",
          progress: 24,
          message: "正在无缓存刷新 Session 页面..."
        }, createLog("正在无缓存刷新 Session 页面。"));

        if ((tab.url || "").startsWith(SESSION_TARGET_URL)) {
          tab = await reloadSessionPageNoCache(tab.id);
        } else {
          await chrome.tabs.update(tab.id, { url: SESSION_TARGET_URL, active: true });
          tab = await waitForSessionPage(tab.id);
        }
      } else {
        await updateJob(
          { phase: "creating_tab", progress: 12, message: "正在新建标签页..." },
          createLog("正在新建并激活 Session 标签页。")
        );
        const createOptions = {
          url: "about:blank",
          active: true
        };
        if (Number.isInteger(windowId)) {
          createOptions.windowId = windowId;
        }
        tab = await chrome.tabs.create(createOptions);

        if (tab.id === undefined || tab.id === null) {
          throw new Error("新标签页缺少 tabId。");
        }

        await chrome.windows.update(tab.windowId, { focused: true });
        await updateJob({
          tabId: tab.id,
          windowId: tab.windowId,
          phase: "navigating",
          progress: 20,
          message: "新标签页已激活，正在跳转 Session..."
        }, createLog(`标签页 ${tab.id} 已创建，准备跳转 Session。`));

        await delay(80);
        await chrome.tabs.update(tab.id, {
          url: SESSION_TARGET_URL,
          active: true
        });

        await updateJob(
          { phase: "loading_session", progress: 34, message: "正在等待 Session 页面..." },
          createLog("Session 地址已提交，等待页面加载。")
        );
        tab = await waitForSessionPage(tab.id);
      }
      await delay(400);

      await updateJob(
        { phase: "reading_session", progress: 50, message: "正在读取 Session 数据..." },
        createLog("Session 页面加载完成，开始读取网页 AT。")
      );
      const page = await readSessionPage(tab.id);
      const parsed = parseSessionPage(page);
      const claims = decodeAccessTokenClaims(parsed.accessToken);
      const userEmail = parsed.userEmail || claims.email || "";
      const accountId = claims.accountId || firstString(parsed.data?.account?.id);
      const planType = claims.planType || firstString(parsed.data?.account?.planType) || "free";
      const userId = firstString(parsed.data?.user?.id);
      const sessionToken = firstString(parsed.data?.sessionToken);

      await updateJob({
        accessToken: parsed.accessToken,
        pageAccessToken: parsed.accessToken,
        sessionToken,
        userEmail,
        userId,
        expires: parsed.expires,
        accountId,
        currentWorkspaceId: accountId,
        planType,
        pageTitle: page.title || "",
        pageUrl: page.url || SESSION_TARGET_URL,
        phase: "saving",
        progress: 66,
        message: "AT 已提取，正在保存到后端..."
      }, createLog(`网页 AT 已提取，账号：${userEmail || "-"}。`, "success"));

      let saveResult = { savedTo: "", rpcId: null };
      let saveError = "";
      try {
        saveResult = await saveAccessToken(backendBaseUrl, token, parsed.accessToken, userEmail);
      } catch (error) {
        saveError = error.message || String(error);
      }

      await updateJob({
        savedTo: saveResult.savedTo,
        saveRpcId: saveResult.rpcId,
        saveError,
        phase: "fetching_workspaces",
        progress: 82,
        message: "正在查询 Workspace..."
      }, createLog(saveError ? `AT 保存提示：${saveError}` : "网页 AT 已保存，开始查询 Workspace。", saveError ? "warning" : "info"));

      let workspaceResult = { workspaces: [], workspaceCount: 0, hasDeactivatedWorkspaceHint: false };
      let workspaceError = "";
      try {
        workspaceResult = await fetchWorkspaces(parsed.accessToken, accountId);
      } catch (error) {
        workspaceError = error.message || String(error);
      }

      const hasWarning = Boolean(saveError || workspaceError);
      await updateJob({
        status: hasWarning ? "warning" : "success",
        phase: "completed",
        progress: 100,
        message: hasWarning ? "任务完成，部分步骤带有提示。" : "任务完成。",
        completedAt: nowIso(),
        workspaces: workspaceResult.workspaces,
        workspaceCount: workspaceResult.workspaceCount,
        hasDeactivatedWorkspaceHint: workspaceResult.hasDeactivatedWorkspaceHint,
        workspaceError
      }, createLog(
        hasWarning
          ? `任务完成，Workspace ${workspaceResult.workspaceCount} 项，部分步骤带有提示。`
          : `任务完成，Workspace ${workspaceResult.workspaceCount} 项。`,
        hasWarning ? "warning" : "success"
      ));

      return { ok: true, jobId };
    } catch (error) {
      await updateJob({
        status: "error",
        phase: "failed",
        message: error.message || String(error),
        error: error.message || String(error),
        completedAt: nowIso()
      }, createLog(error.message || String(error), "error"));
      throw error;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BUTTON11_GET_JOB") {
      readJob().then((job) => sendResponse({ ok: true, job }));
      return true;
    }

    if (message?.type === "BUTTON11_WORKSPACE_ACTION") {
      if (activeJobPromise || activeWorkspacePromise || activeAuthPromise) {
        sendResponse({ ok: false, error: "按钮11任务正在运行。" });
        return true;
      }

      activeWorkspacePromise = runWorkspaceAction(message.payload || {});
      activeWorkspacePromise
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }))
        .finally(() => {
          activeWorkspacePromise = null;
        });
      return true;
    }

    if (message?.type === "BUTTON11_EXPORT_AUTH") {
      if (activeJobPromise || activeWorkspacePromise || activeAuthPromise) {
        sendResponse({ ok: false, error: "按钮11任务正在运行。" });
        return true;
      }

      activeAuthPromise = runAuthExport();
      activeAuthPromise
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }))
        .finally(() => {
          activeAuthPromise = null;
        });
      return true;
    }

    if (message?.type === "BUTTON11_IMPORT_SUB2API") {
      if (activeJobPromise || activeWorkspacePromise || activeAuthPromise) {
        sendResponse({ ok: false, error: "按钮11任务正在运行。" });
        return true;
      }

      activeAuthPromise = runSub2apiImport(message.payload || {});
      activeAuthPromise
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }))
        .finally(() => {
          activeAuthPromise = null;
        });
      return true;
    }

    if (message?.type !== "BUTTON11_START" && message?.type !== "BUTTON11_REFRESH") {
      return false;
    }

    if (activeJobPromise || activeWorkspacePromise || activeAuthPromise) {
      sendResponse({ ok: false, error: "按钮11任务正在运行。" });
      return true;
    }

    const payload = {
      ...(message.payload || {})
    };
    if (message.type === "BUTTON11_REFRESH") {
      payload.refreshTabId = payload.refreshTabId ?? payload.tabId;
    }

    activeJobPromise = runJob(payload);
    activeJobPromise
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }))
      .finally(() => {
        activeJobPromise = null;
      });
    return true;
  });
})();
