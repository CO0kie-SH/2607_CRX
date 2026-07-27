const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const EXTENSION_VERSION_NAME = chrome.runtime.getManifest().version_name || EXTENSION_VERSION;
const LOGGER_BUILD = "url-capture-v33";
const REDACTED_VALUE = "[REDACTED]";
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8081/";
const LEGACY_BACKEND_BASE_URL = "http://127.0.0.1:8080/";
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const HTML_TEXT_UPLOAD_TIMEOUT_MS = 10000;
const HTML_FULL_UPLOAD_TIMEOUT_MS = 30000;
const BACKEND_BASE_URL_STORAGE_KEY = "settings.backendBaseUrl";
const BACKEND_TOKEN_STORAGE_KEY = "settings.backendToken";
const BACKEND_AUTO_REFRESH_STORAGE_KEY = "settings.backendAutoRefresh";
const BROWSER_STARTUP_SIGNAL_STORAGE_KEY = "runtime.browserStartupSignal";
const SIDEPANEL_ACTIVE_MODE_STORAGE_KEY = "sidepanel.activeMode";
const BUTTON6_RIGHT_WINDOW_STORAGE_KEY = "button6.rightWindowId";
const BUTTON6_SOURCE_WINDOW_STORAGE_KEY = "button6.sourceWindowId";
const BUTTON6_NATIVE_PANEL_PENDING_STORAGE_KEY = "button6.nativePanelPending";
const BUTTON6_POPUP_PROMPT_STORAGE_KEY = "button6.popupPrompt";
const URL_LOGGER_SETTINGS_KEY = "urlLogger.settings";
const URL_LOGGER_LOGS_KEY = "urlLogger.global.logs";
const URL_LOGGER_STATE_KEY = "urlLogger.global.state";
const MAX_URL_LOGS = 300;
const AUTO_BACKEND_CONNECT_ATTEMPTS = 3;
const AUTO_BACKEND_CONNECT_RETRY_MS = 2000;
const AUTO_BACKEND_START_DELAY_MS = 1000;
const BUTTON6_AFTER_TOKEN_DELAY_MS = 100;
const BUTTON6_TARGET_URL = "https://ipinfo.io/explore";
const CHATGPT_LOGIN_TARGET_URL = "https://chatgpt.com/auth/login";
const BACKEND_TOKEN_PATTERN = /^crx-[0-9a-f]{32}$/i;
let activeAutomaticTokenRefreshPromise = null;
let activePrimaryBackendStartupPromise = null;
let activeStartupWindowFallbackPromise = null;
let activeButton6AfterTokenSchedulePromise = null;
let activeButton6PopupPromptPromise = null;
let browserStartupSignalHandledInWorker = false;
let urlLoggerWriteQueue = Promise.resolve();
const SENSITIVE_PARAM_NAMES = new Set([
  "access_token",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "id_token",
  "password",
  "refresh_token",
  "secret",
  "session",
  "sessionid",
  "sid",
  "state",
  "token"
]);

function shouldRedactParam(name) {
  return SENSITIVE_PARAM_NAMES.has(String(name || "").toLowerCase());
}

function redactParams(params) {
  let changed = false;

  for (const [name] of params.entries()) {
    if (!shouldRedactParam(name)) {
      continue;
    }

    params.set(name, REDACTED_VALUE);
    changed = true;
  }

  return changed;
}

function redactHash(hash) {
  if (!hash || !hash.includes("?")) {
    return { hash, changed: false };
  }

  const questionIndex = hash.indexOf("?");
  const hashPath = hash.slice(0, questionIndex + 1);
  const hashQuery = hash.slice(questionIndex + 1);
  const hashParams = new URLSearchParams(hashQuery);
  const changed = redactParams(hashParams);

  return {
    hash: changed ? `${hashPath}${hashParams.toString()}` : hash,
    changed
  };
}

function maskSensitiveUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl);
    const queryChanged = redactParams(url.searchParams);
    const redactedHash = redactHash(url.hash);

    if (redactedHash.changed) {
      url.hash = redactedHash.hash;
    }

    return queryChanged || redactedHash.changed ? url.toString() : rawUrl;
  } catch (error) {
    return rawUrl;
  }
}

function writeLog(eventName, details = {}) {
  const logEntry = {
    time: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    extensionVersionName: EXTENSION_VERSION_NAME,
    loggerBuild: LOGGER_BUILD,
    eventName,
    ...details
  };

  console.groupCollapsed(`[My Extension v${EXTENSION_VERSION_NAME} ${LOGGER_BUILD}] ${eventName} ${logEntry.time}`);
  console.log("time:", logEntry.time);
  console.log("extensionVersion:", logEntry.extensionVersion);
  console.log("extensionVersionName:", logEntry.extensionVersionName);
  console.log("loggerBuild:", logEntry.loggerBuild);
  console.log("eventName:", logEntry.eventName);

  if (logEntry.currentPage) {
    console.table(logEntry.currentPage);
    console.log("currentPage:", logEntry.currentPage);
  }

  if (logEntry.navigation) {
    console.table(logEntry.navigation);
    console.log("navigation:", logEntry.navigation);
  }

  console.log("fullLog:", JSON.stringify(logEntry, null, 2));
  console.groupEnd();
}

function getLocalTime() {
  return new Date().toLocaleString();
}

function enqueueUrlLoggerWrite(task) {
  const queuedTask = urlLoggerWriteQueue.then(task, task);
  urlLoggerWriteQueue = queuedTask.catch(() => {});
  return queuedTask;
}

async function appendBackgroundRuntimeLog(eventType, details = {}) {
  const entry = {
    time: getLocalTime(),
    kind: "runtime",
    eventType,
    details
  };

  await enqueueUrlLoggerWrite(async () => {
    const result = await chrome.storage.local.get(URL_LOGGER_LOGS_KEY);
    const logs = Array.isArray(result[URL_LOGGER_LOGS_KEY])
      ? result[URL_LOGGER_LOGS_KEY]
      : [];

    await chrome.storage.local.set({
      [URL_LOGGER_LOGS_KEY]: [entry, ...logs].slice(0, MAX_URL_LOGS)
    });
  });

  chrome.runtime.sendMessage({ type: "URL_LOG_UPDATED" }, () => {
    void chrome.runtime.lastError;
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(targetUrl, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(targetUrl, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getBackendBaseUrl() {
  const result = await chrome.storage.local.get(BACKEND_BASE_URL_STORAGE_KEY);
  const value = String(result[BACKEND_BASE_URL_STORAGE_KEY] || DEFAULT_BACKEND_BASE_URL).trim() || DEFAULT_BACKEND_BASE_URL;

  try {
    const url = new URL(value);
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch (error) {
    return DEFAULT_BACKEND_BASE_URL;
  }
}

async function postExtensionEventReport(eventName, details = {}) {
  const backendBaseUrl = await getBackendBaseUrl();
  const targetUrl = new URL("api/report", backendBaseUrl).toString();
  const manifest = chrome.runtime.getManifest();
  const payload = {
    event_name: eventName,
    time: new Date().toISOString(),
    extension_version: EXTENSION_VERSION,
    logger_build: LOGGER_BUILD,
    backend_base_url: backendBaseUrl,
    details: {
      extension_id: chrome.runtime.id,
      extension_name: manifest.name || "",
      extension_version_name: EXTENSION_VERSION_NAME,
      ...details
    }
  };

  const response = await fetchWithTimeout(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }

  return {
    ok: true,
    targetUrl
  };
}

async function postExtensionLoadReport(trigger, reason) {
  try {
    const result = await postExtensionEventReport("extension_loaded", {
      trigger,
      reason
    });

    writeLog("extension_load_report_sent", {
      trigger,
      reason,
      targetUrl: result.targetUrl
    });
    return result;
  } catch (error) {
    writeLog("extension_load_report_failed", {
      trigger,
      reason,
      error: String(error)
    });
    return {
      ok: false,
      error: String(error)
    };
  }
}

async function checkBackendConnection(backendBaseUrl) {
  const targetUrl = new URL("api/status", backendBaseUrl).toString();
  const response = await fetchWithTimeout(targetUrl, {
    method: "GET",
    cache: "no-store"
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`后端连接失败：HTTP ${response.status}`);
  }

  return {
    targetUrl,
    status: response.status,
    responseText
  };
}

function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch (_error) {
    return "";
  }
}

async function collectAllTabInfoForToken() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab) => {
    const safeUrl = maskSensitiveUrl(tab.url || "");
    return {
      id: tab.id ?? null,
      windowId: tab.windowId ?? null,
      title: tab.title || "",
      url: safeUrl,
      hostname: getHostname(safeUrl),
      active: Boolean(tab.active),
      incognito: Boolean(tab.incognito),
      status: tab.status || ""
    };
  });
}

async function requestNewBackendToken(backendBaseUrl) {
  const targetUrl = new URL("api/get_crc_token", backendBaseUrl).toString();
  const result = await requestJsonRpc(targetUrl, "token.generate", {});
  const token = String(result?.token || "").trim();

  if (!result?.ok || !BACKEND_TOKEN_PATTERN.test(token)) {
    throw new Error(result?.error || "自动获取后端 token 失败。");
  }

  return {
    token,
    targetUrl
  };
}

async function createBackendTokenRecord(backendBaseUrl, token, tabs) {
  const targetUrl = new URL("api/token/create", backendBaseUrl).toString();
  const result = await requestJsonRpc(targetUrl, "token.create", {
    token,
    time: new Date().toISOString(),
    extension_version: EXTENSION_VERSION,
    extension_version_name: EXTENSION_VERSION_NAME,
    tabs
  });

  if (!result?.ok) {
    throw new Error(result?.error || "自动创建后端 token 记录失败。");
  }

  return {
    ...result,
    targetUrl
  };
}

async function resolveButton6WindowId(preferredWindowId = null) {
  if (preferredWindowId !== null && preferredWindowId !== undefined && preferredWindowId !== "") {
    const normalizedWindowId = Number(preferredWindowId);
    if (Number.isInteger(normalizedWindowId)) {
      return normalizedWindowId;
    }
  }

  const focusedTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const focusedWindowId = Number(focusedTabs?.[0]?.windowId);
  if (Number.isInteger(focusedWindowId)) {
    return focusedWindowId;
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  const activeWindowId = Number(activeTabs?.[0]?.windowId);
  if (!Number.isInteger(activeWindowId)) {
    throw new Error("后端 token 已生成，但没有可用于按钮6的浏览器窗口。");
  }
  return activeWindowId;
}

async function closeLegacyButton6RightWindow(sourceWindowId) {
  const stored = await chrome.storage.session.get(BUTTON6_RIGHT_WINDOW_STORAGE_KEY);
  const storedWindowId = Number(stored[BUTTON6_RIGHT_WINDOW_STORAGE_KEY]);
  if (Number.isInteger(storedWindowId) && storedWindowId !== sourceWindowId) {
    await chrome.windows.remove(storedWindowId).catch(() => {});
  }
  await chrome.storage.session.remove(BUTTON6_RIGHT_WINDOW_STORAGE_KEY);
}

function mountButton6EmbeddedFeatureArea(panelUrl) {
  const hostId = "__crx_button6_embedded_feature_area__";
  const existing = document.getElementById(hostId);
  if (existing) {
    const existingFrame = existing.querySelector("iframe");
    if (existingFrame && existingFrame.src !== panelUrl) {
      existingFrame.src = panelUrl;
    }
    return {
      ok: true,
      hostId,
      reused: true
    };
  }

  const host = document.createElement("aside");
  host.id = hostId;
  host.setAttribute("aria-label", "Extension feature panel");
  Object.assign(host.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: "min(430px, 42vw)",
    minWidth: "340px",
    height: "100vh",
    zIndex: "2147483647",
    overflow: "hidden",
    borderLeft: "1px solid #cbd5e1",
    background: "#ffffff",
    boxShadow: "-10px 0 28px rgba(15, 23, 42, 0.2)",
    colorScheme: "light",
    isolation: "isolate"
  });

  const frame = document.createElement("iframe");
  frame.src = panelUrl;
  frame.title = "Extension feature panel";
  frame.setAttribute("allow", "clipboard-read; clipboard-write");
  Object.assign(frame.style, {
    display: "block",
    width: "100%",
    height: "100%",
    border: "0",
    background: "#f4f6f8"
  });

  host.appendChild(frame);
  document.documentElement.appendChild(host);
  return {
    ok: true,
    hostId,
    reused: false
  };
}

function unmountButton6EmbeddedFeatureArea() {
  const host = document.getElementById("__crx_button6_embedded_feature_area__");
  if (!host) {
    return {
      ok: true,
      removed: false
    };
  }
  host.remove();
  return {
    ok: true,
    removed: true
  };
}

function isButton6TargetUrl(value) {
  return String(value || "").startsWith(BUTTON6_TARGET_URL);
}

function isButton6TargetTab(tab) {
  return isButton6TargetUrl(tab?.url) || isButton6TargetUrl(tab?.pendingUrl);
}

function isAboutBlankTab(tab) {
  const url = String(tab?.url || "").trim().toLowerCase();
  const pendingUrl = String(tab?.pendingUrl || "").trim().toLowerCase();
  if (pendingUrl && pendingUrl !== "about:blank") {
    return false;
  }
  return url === "about:blank" || pendingUrl === "about:blank";
}

function isChatGptLoginTab(tab) {
  return String(tab?.url || "").startsWith(CHATGPT_LOGIN_TARGET_URL)
    || String(tab?.pendingUrl || "").startsWith(CHATGPT_LOGIN_TARGET_URL);
}

async function openChatGptLoginPage(payload = {}) {
  const preferredTabId = Number(payload.tabId);
  const preferredWindowId = Number(payload.windowId);
  let currentTab = Number.isInteger(preferredTabId)
    ? await chrome.tabs.get(preferredTabId).catch(() => null)
    : null;

  if (!currentTab) {
    const query = { active: true };
    if (Number.isInteger(preferredWindowId)) {
      query.windowId = preferredWindowId;
    } else {
      query.lastFocusedWindow = true;
    }
    const activeTabs = await chrome.tabs.query(query);
    currentTab = activeTabs[0] || null;
  }

  let tab;
  let mode;
  if (Number.isInteger(currentTab?.id) && isAboutBlankTab(currentTab)) {
    [tab] = await Promise.all([
      chrome.tabs.update(currentTab.id, {
        url: CHATGPT_LOGIN_TARGET_URL,
        active: true
      }),
      chrome.windows.update(currentTab.windowId, { focused: true })
    ]);
    mode = "current_tab";
  } else {
    const tabs = await chrome.tabs.query({});
    const currentWindowId = Number(currentTab?.windowId ?? preferredWindowId);
    const existingTab = tabs.find((item) => (
      isChatGptLoginTab(item) && item.windowId === currentWindowId && item.active
    )) || tabs.find((item) => (
      isChatGptLoginTab(item) && item.windowId === currentWindowId
    )) || tabs.find((item) => isChatGptLoginTab(item));

    if (existingTab) {
      [tab] = await Promise.all([
        chrome.tabs.update(existingTab.id, { active: true }),
        chrome.windows.update(existingTab.windowId, { focused: true })
      ]);
      mode = "reuse";
    } else {
      const createOptions = {
        url: CHATGPT_LOGIN_TARGET_URL,
        active: true
      };
      if (Number.isInteger(currentWindowId)) {
        createOptions.windowId = currentWindowId;
      }
      tab = await chrome.tabs.create(createOptions);
      mode = "new_tab";
    }
  }

  if (!Number.isInteger(tab?.id)) {
    throw new Error("GPT 登录页未返回标签页信息。");
  }

  const result = {
    ok: true,
    mode,
    tabId: tab.id,
    windowId: tab.windowId,
    targetUrl: CHATGPT_LOGIN_TARGET_URL
  };
  writeLog("chatgpt_login_page_opened", result);
  await appendBackgroundRuntimeLog("GPT 登录页已打开", {
    status: "success",
    mode,
    tabId: tab.id,
    windowId: tab.windowId,
    targetUrl: CHATGPT_LOGIN_TARGET_URL
  });
  return result;
}

async function resolveButton6TargetTab(windowId, preferredTabId = null) {
  const normalizedPreferredTabId = preferredTabId !== null
    && preferredTabId !== undefined
    && preferredTabId !== ""
    ? Number(preferredTabId)
    : null;

  if (Number.isInteger(normalizedPreferredTabId)) {
    const preferredTab = await chrome.tabs.get(normalizedPreferredTabId).catch(() => null);
    if (preferredTab && isButton6TargetTab(preferredTab)) {
      return preferredTab;
    }
  }

  const tabs = await chrome.tabs.query({ windowId });
  return tabs.find((tab) => (
    Number.isInteger(tab?.id)
    && isButton6TargetTab(tab)
  )) || null;
}

async function removeButton6EmbeddedFeatureArea(tabId) {
  const normalizedTabId = Number(tabId);
  if (!Number.isInteger(normalizedTabId)) {
    return {
      ok: false,
      removed: false,
      error: "按钮6来源标签页不存在。"
    };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: normalizedTabId },
    func: unmountButton6EmbeddedFeatureArea
  }).catch((error) => [{
    result: {
      ok: false,
      removed: false,
      error: error.message || String(error)
    }
  }]);
  return results?.[0]?.result || {
    ok: false,
    removed: false,
    error: "网页内侧栏清理结果为空。"
  };
}

async function openButton6RightFeatureArea(windowId, preferredTabId = null) {
  const targetTab = await resolveButton6TargetTab(windowId, preferredTabId);
  const targetWindowId = Number(targetTab?.windowId ?? windowId);
  const targetTabId = Number(targetTab?.id);

  await chrome.storage.session.set({
    [SIDEPANEL_ACTIVE_MODE_STORAGE_KEY]: "button6",
    [BUTTON6_SOURCE_WINDOW_STORAGE_KEY]: targetWindowId
  });
  await closeLegacyButton6RightWindow(targetWindowId);

  try {
    await chrome.sidePanel.setOptions({
      path: "sidepanel.html",
      enabled: true
    });
    await chrome.sidePanel.open({ windowId: targetWindowId });
    await chrome.storage.session.remove(BUTTON6_NATIVE_PANEL_PENDING_STORAGE_KEY);
    if (Number.isInteger(targetTabId)) {
      await removeButton6EmbeddedFeatureArea(targetTabId);
    }
    writeLog("button6_right_feature_area_opened", {
      windowId: targetWindowId,
      tabId: Number.isInteger(targetTabId) ? targetTabId : null,
      panelMode: "side_panel"
    });
    await appendBackgroundRuntimeLog("按钮6右侧功能区已打开", {
      status: "success",
      windowId: targetWindowId,
      tabId: Number.isInteger(targetTabId) ? targetTabId : null,
      panelMode: "side_panel"
    });
    return {
      ok: true,
      mode: "side_panel",
      windowId: targetWindowId,
      tabId: Number.isInteger(targetTabId) ? targetTabId : null
    };
  } catch (sidePanelError) {
    const pending = {
      windowId: targetWindowId,
      tabId: Number.isInteger(targetTabId) ? targetTabId : null,
      requestedAt: new Date().toISOString(),
      error: sidePanelError.message || String(sidePanelError)
    };
    await chrome.storage.session.set({
      [BUTTON6_NATIVE_PANEL_PENDING_STORAGE_KEY]: pending
    });
    if (Number.isInteger(targetTabId)) {
      const panelUrl = `${chrome.runtime.getURL("sidepanel.html")}?embedded=button6`;
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: mountButton6EmbeddedFeatureArea,
        args: [panelUrl]
      }).catch((error) => [{
        result: {
          ok: false,
          error: error.message || String(error)
        }
      }]);
      const injectionResult = injectionResults?.[0]?.result;
      if (injectionResult?.ok) {
        writeLog("button6_embedded_feature_area_opened", {
          windowId: targetWindowId,
          tabId: targetTabId,
          panelMode: "embedded",
          reused: Boolean(injectionResult.reused),
          nativePanelError: pending.error
        });
        await appendBackgroundRuntimeLog("按钮6网页内侧栏已打开", {
          status: "success",
          windowId: targetWindowId,
          tabId: targetTabId,
          panelMode: "embedded"
        });
        return {
          ok: true,
          mode: "embedded",
          windowId: targetWindowId,
          tabId: targetTabId,
          nativePanelError: pending.error
        };
      }
      if (injectionResult?.error) {
        pending.embeddedError = injectionResult.error;
        await chrome.storage.session.set({
          [BUTTON6_NATIVE_PANEL_PENDING_STORAGE_KEY]: pending
        });
      }
    }

    writeLog("button6_native_panel_pending", {
      windowId: targetWindowId,
      tabId: pending.tabId,
      panelMode: "native_pending",
      error: pending.embeddedError || pending.error
    });
    await appendBackgroundRuntimeLog("按钮6原生侧栏等待点击打开", {
      status: "warning",
      windowId: targetWindowId,
      tabId: pending.tabId,
      panelMode: "native_pending"
    });
    return {
      ok: false,
      mode: "native_pending",
      windowId: targetWindowId,
      tabId: pending.tabId,
      error: pending.embeddedError || pending.error
    };
  }
}

async function queueButton6PopupPrompt({
  jobId,
  windowId,
  tabId,
  trigger,
  reason,
  panelMode
}) {
  const normalizedWindowId = Number(windowId);
  const normalizedTabId = Number(tabId);
  if (!Number.isInteger(normalizedWindowId) || !Number.isInteger(normalizedTabId)) {
    return {
      ok: false,
      error: "按钮6 Popup 缺少来源窗口或标签页。"
    };
  }

  const stored = await chrome.storage.session.get(BUTTON6_POPUP_PROMPT_STORAGE_KEY);
  const previous = stored[BUTTON6_POPUP_PROMPT_STORAGE_KEY];
  const previousPopupWindowId = Number(previous?.popupWindowId);
  if (Number.isInteger(previousPopupWindowId) && previous?.jobId !== jobId) {
    await chrome.windows.remove(previousPopupWindowId).catch(() => {});
  }

  const prompt = {
    status: "pending",
    jobId,
    sourceWindowId: normalizedWindowId,
    sourceTabId: normalizedTabId,
    targetUrl: BUTTON6_TARGET_URL,
    trigger,
    reason,
    panelMode,
    requestedAt: new Date().toISOString(),
    popupWindowId: null
  };
  await chrome.storage.session.set({
    [BUTTON6_POPUP_PROMPT_STORAGE_KEY]: prompt
  });
  writeLog("button6_popup_prompt_queued", prompt);

  const [sourceWindow, sourceTab] = await Promise.all([
    chrome.windows.get(normalizedWindowId).catch(() => null),
    chrome.tabs.get(normalizedTabId).catch(() => null)
  ]);
  if (
    sourceWindow?.focused
    && sourceTab?.active
    && isButton6TargetTab(sourceTab)
  ) {
    writeLog("button6_popup_prompt_focus_state_matched", {
      jobId,
      sourceWindowId: normalizedWindowId,
      sourceTabId: normalizedTabId
    });
    await openButton6PopupPromptForFocusedTab(normalizedWindowId, sourceTab).catch((error) => {
      writeLog("button6_popup_prompt_focus_state_failed", {
        jobId,
        sourceWindowId: normalizedWindowId,
        sourceTabId: normalizedTabId,
        error: error.message || String(error)
      });
    });
  }

  return {
    ok: true,
    prompt
  };
}

async function openButton6PopupPromptForFocusedTab(windowId, tab) {
  const stored = await chrome.storage.session.get(BUTTON6_POPUP_PROMPT_STORAGE_KEY);
  const prompt = stored[BUTTON6_POPUP_PROMPT_STORAGE_KEY];
  if (!prompt || prompt.status === "completed") {
    return {
      ok: false,
      skipped: true,
      reason: "no_pending_prompt"
    };
  }

  const sourceWindowId = Number(prompt.sourceWindowId);
  const sourceTabId = Number(prompt.sourceTabId);
  if (
    windowId !== sourceWindowId
    || Number(tab?.id) !== sourceTabId
    || !isButton6TargetTab(tab)
  ) {
    return {
      ok: false,
      skipped: true,
      reason: "focus_not_matched"
    };
  }

  const popupWindowId = Number(prompt.popupWindowId);
  if (Number.isInteger(popupWindowId)) {
    const existingPopup = await chrome.windows.get(popupWindowId).catch(() => null);
    if (existingPopup) {
      await chrome.windows.update(popupWindowId, { focused: true });
      return {
        ok: true,
        reused: true,
        popupWindowId
      };
    }
  }

  if (activeButton6PopupPromptPromise) {
    return activeButton6PopupPromptPromise;
  }

  activeButton6PopupPromptPromise = (async () => {
    await chrome.storage.session.set({
      [BUTTON6_POPUP_PROMPT_STORAGE_KEY]: {
        ...prompt,
        status: "opening",
        popupWindowId: null,
        openingAt: new Date().toISOString()
      }
    });

    const popupUrl = new URL(chrome.runtime.getURL("popup.html"));
    popupUrl.searchParams.set("mode", "button6_prompt");
    popupUrl.searchParams.set("sourceWindowId", String(sourceWindowId));
    popupUrl.searchParams.set("sourceTabId", String(sourceTabId));
    popupUrl.searchParams.set("jobId", String(prompt.jobId || ""));
    const popupWindow = await chrome.windows.create({
      url: popupUrl.toString(),
      type: "popup",
      width: 480,
      height: 360,
      focused: true
    });
    if (!Number.isInteger(popupWindow?.id)) {
      throw new Error("按钮6 Popup 未返回窗口ID。");
    }

    const openedPrompt = {
      ...prompt,
      status: "opened",
      popupWindowId: popupWindow.id,
      openedAt: new Date().toISOString()
    };
    await chrome.storage.session.set({
      [BUTTON6_POPUP_PROMPT_STORAGE_KEY]: openedPrompt
    });
    writeLog("button6_popup_prompt_opened", {
      jobId: prompt.jobId,
      sourceWindowId,
      sourceTabId,
      popupWindowId: popupWindow.id
    });
    await appendBackgroundRuntimeLog("按钮6 Popup 已打开", {
      status: "success",
      jobId: prompt.jobId,
      windowId: sourceWindowId,
      tabId: sourceTabId,
      popupWindowId: popupWindow.id
    });
    return {
      ok: true,
      reused: false,
      popupWindowId: popupWindow.id
    };
  })().catch(async (error) => {
    const message = error.message || String(error);
    await chrome.storage.session.set({
      [BUTTON6_POPUP_PROMPT_STORAGE_KEY]: {
        ...prompt,
        status: "pending",
        popupWindowId: null,
        error: message
      }
    });
    writeLog("button6_popup_prompt_failed", {
      jobId: prompt.jobId,
      sourceWindowId,
      sourceTabId,
      error: message
    });
    return {
      ok: false,
      error: message
    };
  }).finally(() => {
    activeButton6PopupPromptPromise = null;
  });

  return activeButton6PopupPromptPromise;
}

async function completeButton6PopupPrompt(payload = {}) {
  const stored = await chrome.storage.session.get(BUTTON6_POPUP_PROMPT_STORAGE_KEY);
  const prompt = stored[BUTTON6_POPUP_PROMPT_STORAGE_KEY] || {};
  const sourceTabId = Number(payload.sourceTabId ?? prompt.sourceTabId);
  const sourceWindowId = Number(payload.sourceWindowId ?? prompt.sourceWindowId);
  const jobId = String(payload.jobId || prompt.jobId || "");
  const completedPrompt = {
    ...prompt,
    status: "completed",
    popupWindowId: null,
    completedAt: new Date().toISOString()
  };
  await chrome.storage.session.set({
    [BUTTON6_POPUP_PROMPT_STORAGE_KEY]: completedPrompt
  });
  const embeddedResult = await removeButton6EmbeddedFeatureArea(sourceTabId);

  await chrome.storage.session.remove(BUTTON6_NATIVE_PANEL_PENDING_STORAGE_KEY);
  writeLog("button6_popup_prompt_completed", {
    jobId,
    sourceWindowId: Number.isInteger(sourceWindowId) ? sourceWindowId : null,
    sourceTabId: Number.isInteger(sourceTabId) ? sourceTabId : null,
    embeddedRemoved: Boolean(embeddedResult?.removed),
    embeddedError: embeddedResult?.error || ""
  });
  return {
    ok: true,
    embeddedResult
  };
}

async function isButton6PopupPromptCompleted(jobId) {
  const stored = await chrome.storage.session.get(BUTTON6_POPUP_PROMPT_STORAGE_KEY);
  const prompt = stored[BUTTON6_POPUP_PROMPT_STORAGE_KEY];
  return Boolean(
    prompt
    && prompt.status === "completed"
    && String(prompt.jobId || "") === String(jobId || "")
  );
}

async function clearCompletedButton6PopupPrompt(jobId) {
  if (await isButton6PopupPromptCompleted(jobId)) {
    await chrome.storage.session.remove(BUTTON6_POPUP_PROMPT_STORAGE_KEY);
    return true;
  }
  return false;
}

function scheduleButton6AfterBackendToken({
  trigger = "backend_token_completed",
  reason = "",
  preferredWindowId = null
} = {}) {
  if (activeButton6AfterTokenSchedulePromise) {
    return activeButton6AfterTokenSchedulePromise;
  }

  activeButton6AfterTokenSchedulePromise = (async () => {
    const scheduledAt = new Date().toISOString();
    writeLog("button6_after_token_scheduled", {
      trigger,
      reason,
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      scheduledAt
    });
    await appendBackgroundRuntimeLog("按钮6延迟触发已安排", {
      trigger,
      reason,
      status: "running",
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      targetUrl: BUTTON6_TARGET_URL
    });

    await delay(BUTTON6_AFTER_TOKEN_DELAY_MS);

    const workerApi = globalThis.__CRX_BUTTON6_WORKER__;
    if (!workerApi?.start) {
      throw new Error("按钮6后台工作器尚未加载。");
    }
    if (workerApi.isBusy?.()) {
      throw new Error("按钮6页面任务正在运行。");
    }

    const windowId = await resolveButton6WindowId(preferredWindowId);
    const payload = {
      jobId: `button6-after-token-${Date.now()}`,
      windowId,
      targetUrl: BUTTON6_TARGET_URL,
      requestedAt: new Date().toISOString(),
      trigger
    };

    await chrome.storage.session.set({
      [SIDEPANEL_ACTIVE_MODE_STORAGE_KEY]: "button6"
    });

    let navigationPromptQueued = false;
    const taskPromise = workerApi.start({
      ...payload,
      onNavigationStarted: async (navigation) => {
        const promptResult = await queueButton6PopupPrompt({
          jobId: payload.jobId,
          windowId: navigation.windowId ?? windowId,
          tabId: navigation.tabId,
          trigger,
          reason,
          panelMode: "navigation_pending"
        });
        navigationPromptQueued = Boolean(promptResult?.ok);
        return promptResult;
      }
    });
    writeLog("button6_after_token_started", {
      trigger,
      reason,
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      jobId: payload.jobId,
      windowId,
      targetUrl: BUTTON6_TARGET_URL
    });
    await appendBackgroundRuntimeLog("后端token完成后已触发按钮6", {
      trigger,
      reason,
      status: "running",
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      jobId: payload.jobId,
      windowId,
      targetUrl: BUTTON6_TARGET_URL
    });

    void taskPromise.then(async (response) => {
      const succeeded = Boolean(response?.ok);
      let featureArea;
      if (await isButton6PopupPromptCompleted(payload.jobId)) {
        featureArea = {
          ok: true,
          mode: "side_panel",
          windowId,
          tabId: Number.isInteger(response?.tabId) ? response.tabId : null,
          confirmedByPrompt: true
        };
      } else {
        featureArea = await openButton6RightFeatureArea(windowId, response?.tabId).catch(async (error) => {
          const message = error.message || String(error);
          writeLog("button6_right_feature_area_failed", {
            windowId,
            jobId: payload.jobId,
            error: message
          });
          await appendBackgroundRuntimeLog("按钮6右侧功能区打开失败", {
            status: "error",
            windowId,
            jobId: payload.jobId,
            error: message
          });
          return {
            ok: false,
            mode: "error",
            error: message
          };
        });
      }

      if (await isButton6PopupPromptCompleted(payload.jobId)) {
        if (featureArea.mode === "embedded" && Number.isInteger(featureArea.tabId)) {
          await removeButton6EmbeddedFeatureArea(featureArea.tabId);
        }
        featureArea = {
          ...featureArea,
          mode: "side_panel",
          confirmedByPrompt: true
        };
        await clearCompletedButton6PopupPrompt(payload.jobId);
      }
      writeLog(succeeded ? "button6_after_token_completed" : "button6_after_token_failed", {
        trigger,
        reason,
        jobId: payload.jobId,
        windowId,
        panelMode: featureArea.mode,
        targetUrl: BUTTON6_TARGET_URL,
        error: succeeded ? "" : response?.error || "按钮6任务失败。"
      });
      await appendBackgroundRuntimeLog(
        succeeded ? "按钮6自动任务完成" : "按钮6自动任务失败",
        {
          trigger,
          reason,
          status: succeeded ? "success" : "error",
          jobId: payload.jobId,
          windowId,
          panelMode: featureArea.mode,
          targetUrl: BUTTON6_TARGET_URL,
          error: succeeded ? "" : response?.error || "按钮6任务失败。"
        }
      );
      if (succeeded && featureArea.mode !== "side_panel" && !navigationPromptQueued) {
        try {
          await queueButton6PopupPrompt({
            jobId: payload.jobId,
            windowId: featureArea.windowId ?? windowId,
            tabId: featureArea.tabId ?? response?.tabId,
            trigger,
            reason,
            panelMode: featureArea.mode
          });
        } catch (error) {
          const message = error.message || String(error);
          writeLog("button6_popup_prompt_queue_failed", {
            jobId: payload.jobId,
            windowId: featureArea.windowId ?? windowId,
            tabId: featureArea.tabId ?? response?.tabId,
            error: message
          });
          await appendBackgroundRuntimeLog("按钮6 Popup 排队失败", {
            status: "error",
            jobId: payload.jobId,
            windowId: featureArea.windowId ?? windowId,
            tabId: featureArea.tabId ?? response?.tabId,
            error: message
          });
        }
      }
    }).catch(async (error) => {
      writeLog("button6_after_token_failed", {
        trigger,
        reason,
        jobId: payload.jobId,
        windowId,
        error: error.message || String(error)
      });
      await appendBackgroundRuntimeLog("按钮6自动任务失败", {
        trigger,
        reason,
        status: "error",
        jobId: payload.jobId,
        windowId,
        targetUrl: BUTTON6_TARGET_URL,
        error: error.message || String(error)
      });
    });

    return {
      ok: true,
      jobId: payload.jobId,
      windowId,
      targetUrl: BUTTON6_TARGET_URL,
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS
    };
  })().catch(async (error) => {
    const message = error.message || String(error);
    writeLog("button6_after_token_schedule_failed", {
      trigger,
      reason,
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      error: message
    });
    await appendBackgroundRuntimeLog("按钮6延迟触发失败", {
      trigger,
      reason,
      status: "error",
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      targetUrl: BUTTON6_TARGET_URL,
      error: message
    });
    return {
      ok: false,
      delayMs: BUTTON6_AFTER_TOKEN_DELAY_MS,
      error: message
    };
  }).finally(() => {
    activeButton6AfterTokenSchedulePromise = null;
  });

  return activeButton6AfterTokenSchedulePromise;
}

async function replaceBackendTokenAfterStartup(trigger = "onStartup") {
  await ensureDefaultSettings();
  await delay(AUTO_BACKEND_START_DELAY_MS);
  const backendBaseUrl = await getBackendBaseUrl();

  writeLog("backend_auto_connect_started", {
    trigger,
    backendBaseUrl,
    maxAttempts: AUTO_BACKEND_CONNECT_ATTEMPTS
  });

  await chrome.storage.local.set({
    [BACKEND_AUTO_REFRESH_STORAGE_KEY]: {
      status: "running",
      trigger,
      backendBaseUrl,
      maxAttempts: AUTO_BACKEND_CONNECT_ATTEMPTS,
      startedAt: new Date().toISOString()
    }
  });

  let lastError = null;
  for (let attempt = 1; attempt <= AUTO_BACKEND_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const connection = await checkBackendConnection(backendBaseUrl);
      writeLog("backend_auto_connect_succeeded", {
        trigger,
        backendBaseUrl,
        targetUrl: connection.targetUrl,
        attempt
      });

      const tokenResult = await requestNewBackendToken(backendBaseUrl);
      const tabs = await collectAllTabInfoForToken();
      const createResult = await createBackendTokenRecord(
        backendBaseUrl,
        tokenResult.token,
        tabs
      );
      const completedAt = new Date().toISOString();

      await chrome.storage.local.set({
        [BACKEND_TOKEN_STORAGE_KEY]: tokenResult.token,
        [BACKEND_AUTO_REFRESH_STORAGE_KEY]: {
          status: "success",
          trigger,
          backendBaseUrl,
          attempt,
          tabCount: tabs.length,
          savedTo: createResult.saved_to || "",
          completedAt
        }
      });

      writeLog("backend_token_auto_refresh_succeeded", {
        trigger,
        backendBaseUrl,
        attempt,
        tabCount: tabs.length,
        savedTo: createResult.saved_to || "",
        tokenPreview: `${tokenResult.token.slice(0, 8)}...${tokenResult.token.slice(-6)}`
      });

      chrome.runtime.sendMessage({
        type: "BACKEND_TOKEN_UPDATED",
        source: "browser_startup",
        completedAt
      }, () => {
        void chrome.runtime.lastError;
      });

      void scheduleButton6AfterBackendToken({
        trigger,
        reason: "backend_token_auto_refresh_succeeded"
      });

      void postExtensionEventReport("backend_token_auto_refreshed", {
        trigger,
        attempt,
        tab_count: tabs.length,
        saved_to: createResult.saved_to || ""
      }).catch((error) => {
        writeLog("backend_token_auto_refresh_report_failed", {
          trigger,
          error: error.message || String(error)
        });
      });

      return {
        ok: true,
        token: tokenResult.token,
        backendBaseUrl,
        attempt,
        tabCount: tabs.length,
        savedTo: createResult.saved_to || ""
      };
    } catch (error) {
      lastError = error;
      writeLog("backend_token_auto_refresh_attempt_failed", {
        trigger,
        backendBaseUrl,
        attempt,
        error: error.message || String(error)
      });

      if (attempt < AUTO_BACKEND_CONNECT_ATTEMPTS) {
        await delay(AUTO_BACKEND_CONNECT_RETRY_MS);
      }
    }
  }

  const failedAt = new Date().toISOString();
  await chrome.storage.local.set({
    [BACKEND_AUTO_REFRESH_STORAGE_KEY]: {
      status: "error",
      trigger,
      backendBaseUrl,
      attempts: AUTO_BACKEND_CONNECT_ATTEMPTS,
      error: lastError?.message || String(lastError || "自动刷新失败。"),
      failedAt
    }
  });

  writeLog("backend_token_auto_refresh_failed", {
    trigger,
    backendBaseUrl,
    attempts: AUTO_BACKEND_CONNECT_ATTEMPTS,
    error: lastError?.message || String(lastError || "自动刷新失败。")
  });

  return {
    ok: false,
    backendBaseUrl,
    attempts: AUTO_BACKEND_CONNECT_ATTEMPTS,
    error: lastError?.message || String(lastError || "自动刷新失败。")
  };
}

function startAutomaticBackendTokenRefresh(trigger = "onStartup") {
  if (activeAutomaticTokenRefreshPromise) {
    return activeAutomaticTokenRefreshPromise;
  }

  activeAutomaticTokenRefreshPromise = replaceBackendTokenAfterStartup(trigger)
    .finally(() => {
      activeAutomaticTokenRefreshPromise = null;
    });
  return activeAutomaticTokenRefreshPromise;
}

function startPrimaryBackendStartupFlow(trigger, reason = "") {
  if (activePrimaryBackendStartupPromise) {
    return activePrimaryBackendStartupPromise;
  }

  activePrimaryBackendStartupPromise = (async () => {
    await ensureDefaultSettings();
    const backendBaseUrl = await getBackendBaseUrl();
    const startedAt = new Date().toISOString();

    await chrome.storage.session.set({
      [BROWSER_STARTUP_SIGNAL_STORAGE_KEY]: {
        status: "running",
        source: trigger,
        reason,
        loggerBuild: LOGGER_BUILD,
        startedAt
      }
    });
    await appendBackgroundRuntimeLog("后端自动连接开始", {
      trigger,
      reason,
      backendBaseUrl,
      targetUrl: new URL("api/status", backendBaseUrl).toString(),
      status: "running"
    });

    try {
      const result = await startAutomaticBackendTokenRefresh(trigger);
      const completedAt = new Date().toISOString();
      const state = {
        status: result?.ok ? "success" : "error",
        source: trigger,
        reason,
        loggerBuild: LOGGER_BUILD,
        completedAt
      };

      if (result?.ok) {
        browserStartupSignalHandledInWorker = true;
      } else {
        state.error = result?.error || "自动刷新失败。";
      }

      await chrome.storage.session.set({
        [BROWSER_STARTUP_SIGNAL_STORAGE_KEY]: state
      });
      await appendBackgroundRuntimeLog(
        result?.ok ? "后端自动连接成功" : "后端自动连接失败",
        {
          trigger,
          reason,
          backendBaseUrl: result?.backendBaseUrl || backendBaseUrl,
          targetUrl: new URL("api/status", result?.backendBaseUrl || backendBaseUrl).toString(),
          status: result?.ok ? "success" : "error",
          attempt: result?.attempt ?? result?.attempts,
          tokenStatus: result?.ok ? "updated" : "unchanged",
          tabCount: result?.tabCount,
          savedTo: result?.savedTo || "",
          error: result?.error || ""
        }
      );

      return result;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = error.message || String(error);

      await chrome.storage.session.set({
        [BROWSER_STARTUP_SIGNAL_STORAGE_KEY]: {
          status: "error",
          source: trigger,
          reason,
          loggerBuild: LOGGER_BUILD,
          error: message,
          failedAt
        }
      });
      await appendBackgroundRuntimeLog("后端自动连接失败", {
        trigger,
        reason,
        backendBaseUrl,
        targetUrl: new URL("api/status", backendBaseUrl).toString(),
        status: "error",
        tokenStatus: "unchanged",
        error: message
      });
      writeLog("browser_startup_primary_flow_failed", {
        trigger,
        reason,
        error: message
      });

      return {
        ok: false,
        backendBaseUrl,
        error: message
      };
    }
  })().finally(() => {
    activePrimaryBackendStartupPromise = null;
  });

  return activePrimaryBackendStartupPromise;
}

function isLikelyBrowserStartupTab(tab) {
  const targetUrl = String(tab?.pendingUrl || tab?.url || "").toLowerCase();
  return !targetUrl
    || targetUrl === "about:blank"
    || targetUrl === "about:newtab"
    || targetUrl.startsWith("chrome://newtab")
    || targetUrl.startsWith("chrome://new-tab-page")
    || targetUrl.startsWith("edge://newtab")
    || targetUrl.startsWith("brave://newtab");
}

async function connectBackendWithExistingTokenFromWindow(windowId, tab) {
  const backendBaseUrl = await getBackendBaseUrl();
  const stored = await chrome.storage.local.get(BACKEND_TOKEN_STORAGE_KEY);
  const existingToken = String(stored[BACKEND_TOKEN_STORAGE_KEY] || "").trim();
  const hasExistingToken = BACKEND_TOKEN_PATTERN.test(existingToken);
  const startedAt = new Date().toISOString();

  await chrome.storage.session.set({
    [BROWSER_STARTUP_SIGNAL_STORAGE_KEY]: {
      status: "running",
      source: "windows.onFocusChanged",
      loggerBuild: LOGGER_BUILD,
      windowId,
      tabId: tab?.id ?? null,
      startedAt
    }
  });

  writeLog("backend_startup_window_connect_started", {
    backendBaseUrl,
    windowId,
    tabId: tab?.id ?? null,
    maxAttempts: AUTO_BACKEND_CONNECT_ATTEMPTS,
    tokenReused: hasExistingToken,
    tokenStatus: hasExistingToken ? "reused" : "missing",
    tokenPreview: hasExistingToken
      ? `${existingToken.slice(0, 8)}...${existingToken.slice(-6)}`
      : ""
  });
  await appendBackgroundRuntimeLog("窗口兜底连接开始", {
    trigger: "windows.onFocusChanged",
    backendBaseUrl,
    targetUrl: new URL("api/status", backendBaseUrl).toString(),
    status: "running",
    tokenStatus: hasExistingToken ? "reused" : "missing",
    windowId,
    tabId: tab?.id ?? null
  });

  let lastError = null;
  for (let attempt = 1; attempt <= AUTO_BACKEND_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const connection = await checkBackendConnection(backendBaseUrl);
      const completedAt = new Date().toISOString();
      const state = {
        status: "success",
        mode: "reuse_existing_token",
        trigger: "windows.onFocusChanged",
        source: "windows.onFocusChanged",
        loggerBuild: LOGGER_BUILD,
        backendBaseUrl,
        attempt,
        tokenReused: hasExistingToken,
        tokenStatus: hasExistingToken ? "reused" : "missing",
        windowId,
        tabId: tab?.id ?? null,
        completedAt
      };

      await chrome.storage.local.set({
        [BACKEND_AUTO_REFRESH_STORAGE_KEY]: state
      });
      await chrome.storage.session.set({
        [BROWSER_STARTUP_SIGNAL_STORAGE_KEY]: state
      });

      writeLog("backend_startup_window_connect_succeeded", {
        ...state,
        targetUrl: connection.targetUrl,
        tokenPreview: hasExistingToken
          ? `${existingToken.slice(0, 8)}...${existingToken.slice(-6)}`
          : ""
      });
      await appendBackgroundRuntimeLog("窗口兜底连接成功", {
        trigger: "windows.onFocusChanged",
        backendBaseUrl,
        targetUrl: connection.targetUrl,
        status: "success",
        attempt,
        tokenStatus: hasExistingToken ? "reused" : "missing",
        windowId,
        tabId: tab?.id ?? null
      });

      void postExtensionEventReport("backend_connected_from_startup_window", {
        trigger: "windows.onFocusChanged",
        attempt,
        token_reused: hasExistingToken,
        token_status: hasExistingToken ? "reused" : "missing",
        window_id: windowId,
        tab_id: tab?.id ?? null
      }).catch((error) => {
        writeLog("backend_startup_window_report_failed", {
          error: error.message || String(error)
        });
      });

      return {
        ok: true,
        tokenReused: hasExistingToken,
        tokenStatus: hasExistingToken ? "reused" : "missing",
        attempt
      };
    } catch (error) {
      lastError = error;
      writeLog("backend_startup_window_connect_attempt_failed", {
        backendBaseUrl,
        windowId,
        tabId: tab?.id ?? null,
        attempt,
        error: error.message || String(error)
      });

      if (attempt < AUTO_BACKEND_CONNECT_ATTEMPTS) {
        await delay(AUTO_BACKEND_CONNECT_RETRY_MS);
      }
    }
  }

  const failedAt = new Date().toISOString();
  const state = {
    status: "error",
    mode: "reuse_existing_token",
    trigger: "windows.onFocusChanged",
    source: "windows.onFocusChanged",
    loggerBuild: LOGGER_BUILD,
    backendBaseUrl,
    attempts: AUTO_BACKEND_CONNECT_ATTEMPTS,
    tokenReused: hasExistingToken,
    tokenStatus: hasExistingToken ? "reused" : "missing",
    windowId,
    tabId: tab?.id ?? null,
    error: lastError?.message || String(lastError || "后端连接失败。"),
    failedAt
  };
  await chrome.storage.local.set({
    [BACKEND_AUTO_REFRESH_STORAGE_KEY]: state
  });
  await chrome.storage.session.set({
    [BROWSER_STARTUP_SIGNAL_STORAGE_KEY]: state
  });
  writeLog("backend_startup_window_connect_failed", state);
  await appendBackgroundRuntimeLog("窗口兜底连接失败", {
    trigger: "windows.onFocusChanged",
    backendBaseUrl,
    targetUrl: new URL("api/status", backendBaseUrl).toString(),
    status: "error",
    attempt: AUTO_BACKEND_CONNECT_ATTEMPTS,
    tokenStatus: hasExistingToken ? "reused" : "missing",
    windowId,
    tabId: tab?.id ?? null,
    error: state.error
  });

  return {
    ok: false,
    error: state.error
  };
}

async function handleBrowserStartupWindowSignal(windowId, tab) {
  if (!isLikelyBrowserStartupTab(tab) || browserStartupSignalHandledInWorker) {
    return {
      ok: false,
      skipped: true,
      reason: "not_eligible"
    };
  }

  if (activeStartupWindowFallbackPromise) {
    return activeStartupWindowFallbackPromise;
  }

  if (activePrimaryBackendStartupPromise) {
    const primaryResult = await activePrimaryBackendStartupPromise;
    if (primaryResult?.ok) {
      browserStartupSignalHandledInWorker = true;
      return {
        ok: false,
        skipped: true,
        reason: "primary_startup_succeeded"
      };
    }
  }

  if (activeAutomaticTokenRefreshPromise) {
    const primaryResult = await activeAutomaticTokenRefreshPromise;
    if (primaryResult?.ok) {
      browserStartupSignalHandledInWorker = true;
      return {
        ok: false,
        skipped: true,
        reason: "primary_startup_succeeded"
      };
    }
  }

  const sessionState = await chrome.storage.session.get(BROWSER_STARTUP_SIGNAL_STORAGE_KEY);
  const startupMarker = sessionState[BROWSER_STARTUP_SIGNAL_STORAGE_KEY];
  if (startupMarker?.status === "success" && startupMarker?.loggerBuild === LOGGER_BUILD) {
    browserStartupSignalHandledInWorker = true;
    return {
      ok: false,
      skipped: true,
      reason: "startup_already_succeeded"
    };
  }

  if (activeStartupWindowFallbackPromise) {
    return activeStartupWindowFallbackPromise;
  }

  activeStartupWindowFallbackPromise = connectBackendWithExistingTokenFromWindow(windowId, tab)
    .then((result) => {
      if (result?.ok) {
        browserStartupSignalHandledInWorker = true;
      }
      return result;
    })
    .finally(() => {
      activeStartupWindowFallbackPromise = null;
    });
  return activeStartupWindowFallbackPromise;
}

async function postNavigationReport(navigation, entry) {
  try {
    const result = await postExtensionEventReport("url_jump_recorded", {
      tabContext: {
        tabId: entry.tabId ?? null,
        windowId: entry.windowId ?? null
      },
      navigation
    });

    writeLog("url_jump_report_sent", {
      targetUrl: result.targetUrl,
      navigation
    });
  } catch (error) {
    writeLog("url_jump_report_failed", {
      error: String(error),
      navigation
    });
  }
}

async function ensureDefaultSettings() {
  const result = await chrome.storage.local.get([
    BACKEND_BASE_URL_STORAGE_KEY,
    URL_LOGGER_SETTINGS_KEY,
    URL_LOGGER_LOGS_KEY,
    URL_LOGGER_STATE_KEY
  ]);
  const patch = {};

  if (!result[BACKEND_BASE_URL_STORAGE_KEY] || result[BACKEND_BASE_URL_STORAGE_KEY] === LEGACY_BACKEND_BASE_URL) {
    patch[BACKEND_BASE_URL_STORAGE_KEY] = DEFAULT_BACKEND_BASE_URL;
  }

  if (!result[URL_LOGGER_SETTINGS_KEY]) {
    patch[URL_LOGGER_SETTINGS_KEY] = {
      enabled: true
    };
  }

  if (!Array.isArray(result[URL_LOGGER_LOGS_KEY])) {
    patch[URL_LOGGER_LOGS_KEY] = [];
  }

  if (!result[URL_LOGGER_STATE_KEY]) {
    patch[URL_LOGGER_STATE_KEY] = {
      lastByTab: {}
    };
  }

  if (!Object.keys(patch).length) {
    return;
  }

  await chrome.storage.local.set(patch);

  writeLog("default_settings_initialized", {
    backendBaseUrl: patch[BACKEND_BASE_URL_STORAGE_KEY] || result[BACKEND_BASE_URL_STORAGE_KEY] || DEFAULT_BACKEND_BASE_URL,
    urlLoggerEnabled: (patch[URL_LOGGER_SETTINGS_KEY] || result[URL_LOGGER_SETTINGS_KEY] || {}).enabled ?? true
  });
}

async function getUrlLoggerSettings() {
  const result = await chrome.storage.local.get(URL_LOGGER_SETTINGS_KEY);
  return {
    enabled: true,
    ...(result[URL_LOGGER_SETTINGS_KEY] || {})
  };
}

async function appendNavigationLog(entry) {
  if (!entry?.url) {
    return;
  }

  const settings = await getUrlLoggerSettings();

  if (!settings.enabled) {
    return;
  }

  const safeUrl = maskSensitiveUrl(entry.url);
  const navigation = {
    time: getLocalTime(),
    title: "",
    ...entry,
    url: safeUrl
  };
  const appended = await enqueueUrlLoggerWrite(async () => {
    const result = await chrome.storage.local.get([URL_LOGGER_LOGS_KEY, URL_LOGGER_STATE_KEY]);
    const logs = Array.isArray(result[URL_LOGGER_LOGS_KEY]) ? result[URL_LOGGER_LOGS_KEY] : [];
    const state = {
      lastByTab: {},
      ...(result[URL_LOGGER_STATE_KEY] || {})
    };
    const tabKey = String(entry.tabId ?? "unknown");
    const signature = [
      entry.reason || "",
      safeUrl,
      entry.error || "",
      entry.transitionType || ""
    ].join("|");

    if (state.lastByTab[tabKey] === signature && entry.reason !== "recording_enabled") {
      return false;
    }

    state.lastByTab[tabKey] = signature;
    await chrome.storage.local.set({
      [URL_LOGGER_LOGS_KEY]: [navigation, ...logs].slice(0, MAX_URL_LOGS),
      [URL_LOGGER_STATE_KEY]: state
    });
    return true;
  });

  if (!appended) {
    return;
  }

  writeLog("url_jump_recorded", {
    tabContext: {
      tabId: entry.tabId ?? null,
      windowId: entry.windowId ?? null
    },
    navigation
  });

  chrome.runtime.sendMessage({ type: "URL_LOG_UPDATED" }, () => {
    void chrome.runtime.lastError;
  });

  void postNavigationReport(navigation, entry);
}

function recordNavigationAttempt(source, details) {
  void appendNavigationLog({
    reason: source,
    url: details.url,
    title: details.title || "",
    tabId: details.tabId ?? null,
    windowId: details.windowId ?? null,
    frameId: details.frameId ?? null,
    requestId: details.requestId || "",
    transitionType: details.transitionType || "",
    error: details.error || ""
  });
}

function triggerButton17NavigationRecovery(source, details) {
  const handler = globalThis.__CRX_BUTTON17_WORKER__?.handleNavigationSignal;
  if (typeof handler !== "function") {
    return;
  }

  void handler(source, details).then((result) => {
    if (result?.recovered || (result?.attempt && !result?.ignored)) {
      writeLog("button17_navigation_recovery_result", {
        source,
        tabId: details.tabId ?? null,
        windowId: details.windowId ?? null,
        recovered: Boolean(result.recovered),
        attempt: result.attempt || 0,
        exhausted: Boolean(result.exhausted),
        error: result.error || ""
      });
    }
  }).catch((error) => {
    writeLog("button17_navigation_recovery_failed", {
      source,
      tabId: details.tabId ?? null,
      windowId: details.windowId ?? null,
      error: error.message || String(error)
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  void ensureDefaultSettings().then(() => postExtensionLoadReport("onInstalled", details.reason || "unknown"));
  void startPrimaryBackendStartupFlow("onInstalled", details.reason || "unknown");
  writeLog("extension_installed", {
    reason: details.reason,
    previousVersion: details.previousVersion || null
  });
});

writeLog("background_loaded", {
  message: "Background service worker loaded with navigation capture listeners."
});
void ensureDefaultSettings();

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaultSettings().then(() => postExtensionLoadReport("onStartup", "browser_started"));
  void startPrimaryBackendStartupFlow("onStartup", "browser_started");
  writeLog("browser_started");
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  recordNavigationAttempt("webNavigation.onBeforeNavigate", details);
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  recordNavigationAttempt("webNavigation.onErrorOccurred", details);
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    recordNavigationAttempt("webRequest.onBeforeRequest", details);
  },
  {
    urls: [
      "http://*/*",
      "https://*/*"
    ],
    types: ["main_frame"]
  }
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return;
  }

  recordNavigationAttempt("tabs.onUpdated.url", {
    tabId,
    windowId: tab?.windowId ?? null,
    url: changeInfo.url,
    title: tab?.title || "",
    frameId: 0
  });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);

    if (!tab?.url) {
      return;
    }

    recordNavigationAttempt("tabs.onActivated", {
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      url: tab.url,
      title: tab.title || "",
      frameId: 0
    });
  } catch (error) {
    writeLog("tabs_on_activated_failed", {
      error: String(error)
    });
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  try {
    const tabs = await chrome.tabs.query({
      active: true,
      windowId
    });
    const tab = tabs[0];

    writeLog("window_focus_changed", {
      windowId,
      tabId: tab?.id ?? null,
      title: tab?.title || "",
      url: maskSensitiveUrl(tab?.url || tab?.pendingUrl || "")
    });

    void handleBrowserStartupWindowSignal(windowId, tab).catch((error) => {
      writeLog("browser_startup_window_signal_failed", {
        windowId,
        tabId: tab?.id ?? null,
        error: error.message || String(error)
      });
    });

    if (!tab?.url) {
      return;
    }

    recordNavigationAttempt("windows.onFocusChanged", {
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      url: tab.url,
      title: tab.title || "",
      frameId: 0
    });
    triggerButton17NavigationRecovery("windows.onFocusChanged", {
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      url: tab.url,
      title: tab.title || ""
    });

    void openButton6PopupPromptForFocusedTab(windowId, tab).catch((error) => {
      writeLog("button6_popup_prompt_focus_handler_failed", {
        windowId,
        tabId: tab.id ?? null,
        error: error.message || String(error)
      });
    });
  } catch (error) {
    writeLog("windows_on_focus_changed_failed", {
      error: String(error)
    });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.session.get(BUTTON6_POPUP_PROMPT_STORAGE_KEY).then(async (stored) => {
    const prompt = stored[BUTTON6_POPUP_PROMPT_STORAGE_KEY];
    if (!prompt) {
      return;
    }

    if (Number(prompt.sourceWindowId) === windowId) {
      await chrome.storage.session.remove(BUTTON6_POPUP_PROMPT_STORAGE_KEY);
      return;
    }

    if (Number(prompt.popupWindowId) !== windowId) {
      return;
    }

    await chrome.storage.session.set({
      [BUTTON6_POPUP_PROMPT_STORAGE_KEY]: {
        ...prompt,
        status: "pending",
        popupWindowId: null,
        closedAt: new Date().toISOString()
      }
    });
    writeLog("button6_popup_prompt_closed", {
      jobId: prompt.jobId || "",
      popupWindowId: windowId,
      sourceWindowId: prompt.sourceWindowId,
      sourceTabId: prompt.sourceTabId
    });
  }).catch((error) => {
    writeLog("button6_popup_prompt_close_handler_failed", {
      windowId,
      error: error.message || String(error)
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_CHATGPT_LOGIN_PAGE") {
    openChatGptLoginPage(message.payload || {}).then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || String(error)
      });
    });
    return true;
  }

  if (message?.type === "SCHEDULE_BUTTON6_AFTER_TOKEN") {
    scheduleButton6AfterBackendToken({
      trigger: String(message.payload?.trigger || "manual_backend_token_completed"),
      reason: String(message.payload?.reason || "popup_button1"),
      preferredWindowId: message.payload?.windowId
    }).then(sendResponse);
    return true;
  }

  if (message?.type === "BUTTON6_POPUP_PROMPT_COMPLETED") {
    completeButton6PopupPrompt(message.payload || {}).then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || String(error)
      });
    });
    return true;
  }

  if (message?.type === "GET_TAB_CONTEXT") {
    sendResponse({
      ok: true,
      tabContext: {
        tabId: sender.tab?.id || null,
        windowId: sender.tab?.windowId || null,
        incognito: Boolean(sender.tab?.incognito)
      }
    });
    return true;
  }

  if (message?.type === "SET_URL_LOGGER_ENABLED") {
    chrome.storage.local.set({
      [URL_LOGGER_SETTINGS_KEY]: {
        enabled: Boolean(message.enabled)
      }
    }).then(() => {
      writeLog("url_logger_setting_changed", {
        enabled: Boolean(message.enabled)
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "CLEAR_URL_LOGS") {
    chrome.storage.local.set({
      [URL_LOGGER_LOGS_KEY]: [],
      [URL_LOGGER_STATE_KEY]: {
        lastByTab: {}
      }
    }).then(() => {
      writeLog("url_logs_cleared");
      chrome.runtime.sendMessage({ type: "URL_LOG_UPDATED" }, () => {
        void chrome.runtime.lastError;
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "CONTENT_URL_EVENT") {
    const source = message.payload?.reason || "content.url_event";
    const details = {
      tabId: sender.tab?.id ?? null,
      windowId: sender.tab?.windowId ?? null,
      url: message.payload?.url || sender.tab?.url || "",
      title: message.payload?.title || sender.tab?.title || "",
      frameId: sender.frameId ?? 0
    };
    recordNavigationAttempt(source, details);
    if (source === "page_loaded") {
      triggerButton17NavigationRecovery(source, details);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "SEND_EXTENSION_LOAD_REPORT") {
    postExtensionLoadReport(
      String(message.trigger || "popup_manual"),
      String(message.reason || "manual_test")
    ).then((result) => {
      sendResponse(result);
    });
    return true;
  }

  if (message?.type === "START_IP_CAPTURE") {
    sendResponse({ ok: true, message: "任务已启动" });

    handleIpCapture(
      String(message.backendBaseUrl || DEFAULT_BACKEND_BASE_URL),
      String(message.token || "")
    ).catch((error) => {
      writeLog("ip_capture_error", {
        error: error.message || String(error)
      });
    });

    return true;
  }

  if (!message || message.type !== "LOG_EVENT") {
    return false;
  }

  writeLog(message.eventName || "popup_event", {
    ...(message.payload || {}),
    sender: {
      id: sender.id || null,
      url: sender.url || null
    }
  });

  sendResponse({ ok: true });
  return true;
});

const ipCaptureState = {
  currentTabId: null,
  notificationId: null
};

async function findOrOpenTargetPage(targetUrl) {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(targetUrl));

  if (existingTab) {
    writeLog("target_page_found", {
      targetUrl,
      tabId: existingTab.id,
      windowId: existingTab.windowId
    });
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
    return existingTab;
  }

  writeLog("target_page_opening", { targetUrl });

  const newTab = await chrome.tabs.create({
    url: targetUrl,
    active: false
  });

  writeLog("target_page_opened", {
    targetUrl,
    tabId: newTab.id,
    windowId: newTab.windowId
  });

  return newTab;
}

async function waitForPageComplete(tabId, timeoutMs = 30000) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        reject(new Error("等待页面加载超时"));
        return;
      }

      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          clearInterval(checkInterval);
          resolve(tab);
        }
      } catch (error) {
        clearInterval(checkInterval);
        reject(error);
      }
    }, 500);
  });
}

async function extractPageContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title || "",
      url: window.location.href,
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : ""
    })
  });

  const page = results?.[0]?.result;
  if (!page) {
    throw new Error("页面内容提取失败");
  }

  return page;
}

function generateJsonRpcId() {
  return Date.now() * 1000000 + Math.floor(Math.random() * 1000000);
}

async function requestJsonRpc(targetUrl, method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const rpcId = generateJsonRpcId();
  const rpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
    id: rpcId
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcRequest),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let rpcResponse;

    try {
      rpcResponse = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error("JSON-RPC 响应解析失败");
    }

    if (!response.ok) {
      throw new Error(rpcResponse.error?.message || `HTTP ${response.status}`);
    }

    if (rpcResponse.id !== rpcId) {
      throw new Error("JSON-RPC ID 不匹配");
    }

    if (rpcResponse.error) {
      throw new Error(rpcResponse.error.message || "JSON-RPC 错误");
    }

    return rpcResponse.result || {};
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs / 1000}秒）`);
    }
    throw error;
  }
}

async function postHtmlCaptureJsonRpc(backendBaseUrl, captureType, page, tab, token) {
  const targetPath = captureType === "text" ? "api/html/text" : "api/html/all";
  const targetUrl = new URL(targetPath, backendBaseUrl).toString();
  const contentField = captureType === "text" ? "text" : "html";
  const timeoutMs = captureType === "text" ? HTML_TEXT_UPLOAD_TIMEOUT_MS : HTML_FULL_UPLOAD_TIMEOUT_MS;
  const method = captureType === "text" ? "html.captureText" : "html.captureAll";

  const params = {
    token,
    time: new Date().toISOString(),
    extension_version: EXTENSION_VERSION,
    extension_version_name: EXTENSION_VERSION_NAME,
    page: {
      title: page.title || tab.title || "",
      url: maskSensitiveUrl(page.url || tab.url || ""),
      tabId: tab.id ?? null,
      windowId: tab.windowId ?? null,
      sourceReason: "button3_background_capture"
    },
    [contentField]: page[contentField] || ""
  };

  return await requestJsonRpc(targetUrl, method, params, timeoutMs);
}

function showNotification(id, title, message, iconUrl = "icon.png") {
  return chrome.notifications.create(id, {
    type: "basic",
    iconUrl,
    title,
    message
  });
}

async function handleIpCapture(backendBaseUrl, token) {
  const targetUrl = "https://ipinfo.dkly.net/";
  const notificationId = `ip-capture-${Date.now()}`;

  ipCaptureState.notificationId = notificationId;

  try {
    await showNotification(notificationId, "抓取IP信息", "正在打开目标页面...");

    const tab = await findOrOpenTargetPage(targetUrl);
    ipCaptureState.currentTabId = tab.id;

    await showNotification(notificationId, "抓取IP信息", "等待页面加载完成...");

    const completedTab = await waitForPageComplete(tab.id);

    writeLog("ip_capture_page_loaded", {
      tabId: completedTab.id,
      url: completedTab.url
    });

    await showNotification(notificationId, "抓取IP信息", "正在提取页面内容...");

    const page = await extractPageContent(completedTab.id);

    writeLog("ip_capture_content_extracted", {
      tabId: completedTab.id,
      textBytes: new Blob([page.text || ""]).size,
      htmlBytes: new Blob([page.html || ""]).size
    });

    await showNotification(notificationId, "抓取IP信息", "正在上传到后端...");

    const textResult = await postHtmlCaptureJsonRpc(backendBaseUrl, "text", page, completedTab, token);
    const htmlResult = await postHtmlCaptureJsonRpc(backendBaseUrl, "all", page, completedTab, token);

    writeLog("ip_capture_completed", {
      tabId: completedTab.id,
      textBytes: textResult.bytes,
      htmlBytes: htmlResult.bytes
    });

    await showNotification(notificationId, "抓取完成", "IP信息已成功保存，点击查看页面");

    return {
      ok: true,
      tabId: completedTab.id,
      textBytes: textResult.bytes,
      htmlBytes: htmlResult.bytes
    };
  } catch (error) {
    writeLog("ip_capture_failed", {
      error: error.message || String(error)
    });

    await showNotification(notificationId, "抓取失败", error.message || "未知错误");

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === ipCaptureState.notificationId && ipCaptureState.currentTabId) {
    chrome.tabs.update(ipCaptureState.currentTabId, { active: true }).then(() => {
      chrome.tabs.get(ipCaptureState.currentTabId).then((tab) => {
        chrome.windows.update(tab.windowId, { focused: true });
      });
    }).catch(() => {
      // Tab might be closed
    });
  }

  chrome.notifications.clear(notificationId);
});
