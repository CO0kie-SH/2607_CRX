const JOB_STORAGE_KEY = "button11.job";
const PENDING_STORAGE_KEY = "button11.pending";
const BUTTON6_JOB_STORAGE_KEY = "button6.job";
const BUTTON6_PENDING_STORAGE_KEY = "button6.pending";
const ACTIVE_MODE_STORAGE_KEY = "sidepanel.activeMode";
const POPUP_PENDING_FEATURE_STORAGE_KEY = "sidepanel.pendingFeature";
const BUTTON6_SOURCE_WINDOW_STORAGE_KEY = "button6.sourceWindowId";
const BACKEND_BASE_URL_STORAGE_KEY = "settings.backendBaseUrl";
const BACKEND_TOKEN_STORAGE_KEY = "settings.backendToken";
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8081/";
const LEGACY_BACKEND_BASE_URL = "http://127.0.0.1:8080/";
const MAX_TASK_LOG_TEXT_LENGTH = 3000;

const panelFeatureButtons = Array.from(document.querySelectorAll("[data-panel-feature]"));

const elements = {
  panelEyebrow: document.getElementById("panel-eyebrow"),
  panelTitle: document.getElementById("panel-title"),
  statusBadge: document.getElementById("status-badge"),
  phaseText: document.getElementById("phase-text"),
  progressText: document.getElementById("progress-text"),
  progressBar: document.getElementById("progress-bar"),
  jobMessage: document.getElementById("job-message"),
  userEmail: document.getElementById("user-email"),
  planType: document.getElementById("plan-type"),
  workspaceCount: document.getElementById("workspace-count"),
  savedTo: document.getElementById("saved-to"),
  startedAt: document.getElementById("started-at"),
  completedAt: document.getElementById("completed-at"),
  tokenState: document.getElementById("token-state"),
  tokenPreview: document.getElementById("token-preview"),
  copyToken: document.getElementById("copy-token"),
  exportResult: document.getElementById("export-result"),
  openSession: document.getElementById("open-session"),
  refreshJob: document.getElementById("refresh-job"),
  errorSection: document.getElementById("error-section"),
  errorText: document.getElementById("error-text"),
  workspaceSummary: document.getElementById("workspace-summary"),
  workspaceList: document.getElementById("workspace-list"),
  button11Details: document.getElementById("button11-details"),
  button11TokenSection: document.getElementById("button11-token-section"),
  button11WorkspaceSection: document.getElementById("button11-workspace-section"),
  button6Details: document.getElementById("button6-details"),
  featureActions: document.getElementById("feature-actions"),
  featureModeLabel: document.getElementById("feature-mode-label"),
  button6TargetUrl: document.getElementById("button6-target-url"),
  button6PageUrl: document.getElementById("button6-page-url"),
  button6PageTitle: document.getElementById("button6-page-title"),
  button6Country: document.getElementById("button6-country"),
  button6City: document.getElementById("button6-city"),
  button6TabId: document.getElementById("button6-tab-id"),
  button6WindowId: document.getElementById("button6-window-id"),
  button6StartedAt: document.getElementById("button6-started-at"),
  button6CompletedAt: document.getElementById("button6-completed-at"),
  button6Activate: document.getElementById("button6-activate"),
  button6Refresh: document.getElementById("button6-refresh"),
  button6CopyContent: document.getElementById("button6-copy-content"),
  pageContentTitle: document.getElementById("page-content-title"),
  pageContentMeta: document.getElementById("page-content-meta"),
  pageContentBox: document.getElementById("page-content-box"),
  taskLogCount: document.getElementById("task-log-count"),
  taskLogBox: document.getElementById("task-log-box")
};

const phaseLabels = {
  queued: "任务排队",
  checking_tabs: "查找已有标签页",
  reusing_tab: "复用标签页",
  creating_tab: "新建标签页",
  navigating: "跳转 Session",
  loading_session: "加载 Session",
  loading_page: "加载页面",
  refreshing_page: "刷新页面",
  recording_content: "记录页面内容",
  refreshing_session: "刷新 Session",
  reading_session: "读取 Session",
  saving: "保存 AT",
  fetching_workspaces: "查询 Workspace",
  exchanging_workspace: "切换 Workspace",
  completed: "任务完成",
  failed: "任务失败"
};

let currentJob = null;
let currentButton6Job = null;
let currentMode = "button11";
let startInFlight = false;
let button6StartInFlight = false;
let workspaceActionInFlight = false;
let panelFeatureStartInFlight = false;
let panelFeatureActionInFlight = false;

function formatTime(value) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function tokenFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function maskToken(value) {
  const token = String(value || "");
  if (!token) {
    return "--";
  }
  if (token.length <= 32) {
    return `${token} [#${tokenFingerprint(token)}]`;
  }
  return `${token.slice(0, 18)}...${token.slice(-10)} [#${tokenFingerprint(token)}]`;
}

function pageAccessToken(job) {
  return String(job?.pageAccessToken || job?.accessToken || "");
}

function maskWorkspaceToken(value, pageTokenValue) {
  const token = String(value || "");
  const pageToken = String(pageTokenValue || "");
  if (!token) {
    return "尚未加载";
  }
  if (token.length <= 28) {
    return `${token} [#${tokenFingerprint(token)}]`;
  }

  let differenceIndex = 0;
  const comparableLength = Math.min(token.length, pageToken.length);
  while (differenceIndex < comparableLength && token[differenceIndex] === pageToken[differenceIndex]) {
    differenceIndex += 1;
  }

  if (differenceIndex >= comparableLength && token.length === pageToken.length) {
    return `${token.slice(0, 12)}...${token.slice(-10)} [与网页相同 #${tokenFingerprint(token)}]`;
  }

  const segmentStart = Math.max(0, differenceIndex - 8);
  const segmentEnd = Math.min(token.length, differenceIndex + 18);
  const differenceSegment = token.slice(segmentStart, segmentEnd);
  return `${token.slice(0, 10)}...${differenceSegment}...${token.slice(-8)} [空间 #${tokenFingerprint(token)}]`;
}

function encodeBase64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildCodexAuthFields(job) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const parsedExpires = job?.expires ? Math.floor(new Date(job.expires).getTime() / 1000) : 0;
  const expiresAt = Number.isFinite(parsedExpires) && parsedExpires > issuedAt
    ? parsedExpires
    : issuedAt + (30 * 24 * 60 * 60);
  const accountId = job?.accountId || "";
  const planType = job?.planType || "free";
  const userId = job?.userId || "";
  const syntheticIdToken = [
    encodeBase64UrlJson({ alg: "none", typ: "JWT", cpa_synthetic: true }),
    encodeBase64UrlJson({
      iat: issuedAt,
      exp: expiresAt,
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
        chatgpt_plan_type: planType,
        chatgpt_user_id: userId,
        user_id: userId
      },
      email: job?.userEmail || ""
    }),
    "synthetic"
  ].join(".");

  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: syntheticIdToken,
      access_token: pageAccessToken(job),
      refresh_token: job?.sessionToken || "",
      account_id: accountId
    },
    last_refresh: new Date().toISOString()
  };
}

function statusLabel(status) {
  return {
    running: "运行中",
    success: "成功",
    warning: "有提示",
    error: "失败"
  }[status] || "待命";
}

function renderWorkspaces(workspaces, workspaceActions = {}, actionsDisabled = false, pageToken = "") {
  const items = Array.isArray(workspaces) ? workspaces : [];
  elements.workspaceList.replaceChildren();
  elements.workspaceSummary.textContent = `${items.length} 项`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无 Workspace 数据";
    elements.workspaceList.appendChild(empty);
    return;
  }

  for (const workspace of items) {
    const row = document.createElement("div");
    row.className = "workspace-item";

    const index = document.createElement("div");
    index.className = "workspace-index";
    index.textContent = String(workspace.index || items.indexOf(workspace) + 1).padStart(2, "0");

    const body = document.createElement("div");
    body.className = "workspace-body";
    const name = document.createElement("div");
    name.className = "workspace-name";
    name.textContent = workspace.name || workspace.id || "Workspace";

    if (workspace.isCurrent) {
      const current = document.createElement("span");
      current.className = "current-mark";
      current.textContent = "当前";
      name.appendChild(current);
    }

    const meta = document.createElement("div");
    meta.className = "workspace-meta";
    meta.textContent = [workspace.role, workspace.type, workspace.id].filter(Boolean).join(" · ") || "--";

    const token = document.createElement("code");
    token.className = `workspace-token${workspace.accessToken ? " is-loaded" : ""}`;
    token.textContent = `AT: ${maskWorkspaceToken(workspace.accessToken, pageToken)}`;
    token.title = workspace.accessToken || "";

    const actionState = workspaceActions?.[workspace.id] || null;
    const actionRow = document.createElement("div");
    actionRow.className = "workspace-actions";

    const exchangeButton = document.createElement("button");
    exchangeButton.type = "button";
    exchangeButton.className = "workspace-action";
    exchangeButton.dataset.workspaceAction = "exchange";
    exchangeButton.dataset.workspaceId = workspace.id;
    exchangeButton.textContent = actionState?.status === "running" && actionState.action === "exchange"
      ? "交换中..."
      : "交换AT";
    exchangeButton.disabled = actionsDisabled;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    const exchangeReady = Boolean(workspace.accessToken && workspace.exchangeSucceededAt);
    copyButton.className = `workspace-action quiet${exchangeReady ? " is-token-ready" : ""}`;
    copyButton.dataset.workspaceAction = "copy";
    copyButton.dataset.workspaceId = workspace.id;
    copyButton.textContent = actionState?.status === "running" && actionState.action === "copy"
      ? "获取中..."
      : "复制AT";
    copyButton.disabled = actionsDisabled;

    actionRow.append(exchangeButton, copyButton);

    const actionStatus = document.createElement("div");
    actionStatus.className = `workspace-action-status ${actionState?.status || ""}`.trim();
    actionStatus.textContent = actionState?.message || "";
    actionStatus.hidden = !actionStatus.textContent;

    body.append(name, meta, token, actionRow, actionStatus);
    row.append(index, body);
    elements.workspaceList.appendChild(row);
  }
}

function formatTaskLog(log, index) {
  const time = formatTime(log?.time || log?.createdAt || "");
  const level = String(log?.level || "info").toUpperCase();
  return `#${index + 1} ${time} [${level}]\n${log?.message || "-"}`;
}

function renderTaskLogs(job) {
  const logs = Array.isArray(job?.logs) ? job.logs : [];
  const fullText = logs.length
    ? logs
      .map((log, index) => ({ log, index }))
      .reverse()
      .map(({ log, index }) => formatTaskLog(log, index))
      .join("\n\n")
    : "暂无任务日志。";
  const limitNotice = "\n\n[仅显示最新日志，已达到 3000 字上限]";
  const displayText = fullText.length > MAX_TASK_LOG_TEXT_LENGTH
    ? `${fullText.slice(0, MAX_TASK_LOG_TEXT_LENGTH - limitNotice.length)}${limitNotice}`
    : fullText;

  elements.taskLogCount.textContent = `${logs.length} 条 · 倒序 · ${displayText.length}/${MAX_TASK_LOG_TEXT_LENGTH} 字`;
  elements.taskLogBox.textContent = displayText;
  elements.taskLogBox.scrollTop = 0;
}

function buildButton11Content(job, accessToken) {
  if (!job) {
    return "等待按钮11启动任务。";
  }
  return [
    `页面: ${job.pageUrl || "--"}`,
    `标题: ${job.pageTitle || "--"}`,
    `账号: ${job.userEmail || "--"}`,
    `计划: ${job.planType || "--"}`,
    `Workspace: ${job.workspaceCount || 0}`,
    `网页AT: ${accessToken ? maskToken(accessToken) : "--"}`,
    `保存位置: ${job.savedTo || "--"}`
  ].join("\n");
}

function setPanelMode(mode) {
  currentMode = mode === "button6" ? "button6" : "button11";
  const isButton6 = currentMode === "button6";

  elements.panelEyebrow.textContent = isButton6 ? "BUTTON 6" : "BUTTON 11";
  elements.panelTitle.textContent = isButton6 ? "IPInfo Explore" : "AT 任务";
  elements.featureModeLabel.textContent = isButton6 ? "IPInfo 页面" : "按钮11 AT";
  elements.button6Details.hidden = !isButton6;
  elements.button11Details.hidden = isButton6;
  elements.button11TokenSection.hidden = isButton6;
  elements.button11WorkspaceSection.hidden = isButton6;
  elements.button6Activate.hidden = !isButton6;
  elements.button6Refresh.hidden = !isButton6;
  elements.button6CopyContent.hidden = !isButton6;
  elements.refreshJob.hidden = isButton6;
  elements.copyToken.hidden = isButton6;
  elements.openSession.hidden = isButton6;
  elements.exportResult.hidden = isButton6;
}

function renderJob(job) {
  setPanelMode("button11");
  currentJob = job || null;
  const status = job?.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  const accessToken = pageAccessToken(job);
  const errors = [job?.error, job?.saveError, job?.workspaceError].filter(Boolean);
  const workspaceBusy = workspaceActionInFlight
    || status === "running"
    || job?.workspaceAction?.status === "running";

  elements.statusBadge.className = `status-badge ${status}`;
  elements.statusBadge.textContent = statusLabel(status);
  elements.phaseText.textContent = phaseLabels[job?.phase] || (job ? "任务处理中" : "暂无任务");
  elements.progressText.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;
  elements.jobMessage.textContent = job?.message || "等待按钮11启动任务。";
  elements.userEmail.textContent = job?.userEmail || "--";
  elements.planType.textContent = job?.planType || "--";
  elements.workspaceCount.textContent = String(job?.workspaceCount || 0);
  elements.savedTo.textContent = job?.savedTo || (job?.saveError ? "保存失败" : "--");
  elements.startedAt.textContent = formatTime(job?.startedAt);
  elements.completedAt.textContent = formatTime(job?.completedAt);
  elements.tokenState.textContent = accessToken ? "网页已提取" : "未提取";
  elements.tokenPreview.textContent = maskToken(accessToken);
  elements.tokenPreview.title = accessToken;
  elements.copyToken.classList.toggle("is-token-ready", Boolean(accessToken));
  elements.copyToken.disabled = !accessToken || workspaceBusy;
  elements.exportResult.disabled = !job || workspaceBusy;
  elements.openSession.disabled = !Number.isInteger(job?.tabId) || workspaceBusy;
  elements.refreshJob.disabled = workspaceBusy
    || !Number.isInteger(job?.tabId)
    || !job?.backendBaseUrl
    || !job?.token;
  elements.errorSection.hidden = errors.length === 0;
  elements.errorText.textContent = errors.join("\n");
  const content = buildButton11Content(job, accessToken);
  elements.pageContentTitle.textContent = "AT 任务摘要";
  elements.pageContentMeta.textContent = `${content.length} 字符`;
  elements.pageContentBox.textContent = content;
  renderTaskLogs(job);
  renderWorkspaces(job?.workspaces, job?.workspaceActions, workspaceBusy, accessToken);
}

function renderButton6Job(job) {
  setPanelMode("button6");
  currentButton6Job = job || null;
  const status = job?.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  const busy = status === "running" || button6StartInFlight;
  const errors = [job?.error].filter(Boolean);

  elements.statusBadge.className = `status-badge ${status}`;
  elements.statusBadge.textContent = statusLabel(status);
  elements.phaseText.textContent = phaseLabels[job?.phase] || (job ? "页面处理中" : "暂无任务");
  elements.progressText.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;
  elements.jobMessage.textContent = job?.message || "等待按钮6启动任务。";
  elements.button6TargetUrl.textContent = job?.targetUrl || "https://ipinfo.io/explore";
  elements.button6PageUrl.textContent = job?.pageUrl || "--";
  elements.button6PageTitle.textContent = job?.pageTitle || "--";
  elements.button6Country.textContent = job?.country && job?.countryCode
    && String(job.country).toUpperCase() !== String(job.countryCode).toUpperCase()
    ? `${job.country} (${job.countryCode})`
    : job?.country || job?.countryCode || "--";
  elements.button6City.textContent = job?.city || "--";
  elements.button6TabId.textContent = Number.isInteger(job?.tabId) ? String(job.tabId) : "--";
  elements.button6WindowId.textContent = Number.isInteger(job?.windowId) ? String(job.windowId) : "--";
  elements.button6StartedAt.textContent = formatTime(job?.startedAt);
  elements.button6CompletedAt.textContent = formatTime(job?.completedAt);
  elements.button6Activate.disabled = busy || !Number.isInteger(job?.tabId);
  elements.button6Refresh.disabled = busy || !Number.isInteger(job?.tabId);
  elements.button6CopyContent.disabled = busy || !job?.pageContent;
  elements.errorSection.hidden = errors.length === 0;
  elements.errorText.textContent = errors.join("\n");
  elements.pageContentTitle.textContent = "IPInfo 页面内容";
  elements.pageContentMeta.textContent = job
    ? `${job.pageTextLength || 0} 字符 / HTML ${job.pageHtmlLength || 0} 字符${job.pageContentTruncated ? " / 已截断" : ""}`
    : "0 字符";
  elements.pageContentBox.textContent = job?.pageContent || "等待页面内容记录。";
  renderTaskLogs(job);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.cssText = "position: fixed; top: -9999px; left: -9999px;";
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw error;
    }
  }
}

async function updateStoredWorkspaceAction(workspaceId, action, status, message) {
  const result = await chrome.storage.session.get(JOB_STORAGE_KEY);
  const job = result[JOB_STORAGE_KEY];
  if (!job) {
    return;
  }

  await chrome.storage.session.set({
    [JOB_STORAGE_KEY]: {
      ...job,
      workspaceAction: {
        workspaceId,
        action,
        status
      },
      workspaceActions: {
        ...(job.workspaceActions || {}),
        [workspaceId]: {
          action,
          status,
          message,
          updatedAt: new Date().toISOString()
        }
      },
      updatedAt: new Date().toISOString()
    }
  });
}

async function loadJob() {
  const result = await chrome.storage.session.get(JOB_STORAGE_KEY);
  renderJob(result[JOB_STORAGE_KEY] || null);
}

async function loadButton6Job() {
  const result = await chrome.storage.session.get(BUTTON6_JOB_STORAGE_KEY);
  renderButton6Job(result[BUTTON6_JOB_STORAGE_KEY] || null);
}

async function loadActivePanel() {
  const result = await chrome.storage.session.get([
    ACTIVE_MODE_STORAGE_KEY,
    BUTTON6_PENDING_STORAGE_KEY,
    PENDING_STORAGE_KEY
  ]);
  const mode = result[ACTIVE_MODE_STORAGE_KEY]
    || (result[BUTTON6_PENDING_STORAGE_KEY] ? "button6" : "")
    || (result[PENDING_STORAGE_KEY] ? "button11" : "")
    || "button11";

  if (mode === "button6") {
    await loadButton6Job();
    return;
  }
  await loadJob();
}

async function getSidePanelWindowId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs?.[0] || null;
  const detachedPanelUrl = chrome.runtime.getURL("sidepanel.html");
  if (String(activeTab?.url || "") === detachedPanelUrl) {
    const stored = await chrome.storage.session.get(BUTTON6_SOURCE_WINDOW_STORAGE_KEY);
    const sourceWindowId = Number(stored[BUTTON6_SOURCE_WINDOW_STORAGE_KEY]);
    if (Number.isInteger(sourceWindowId)) {
      const sourceWindow = await chrome.windows.get(sourceWindowId).catch(() => null);
      if (sourceWindow) {
        return sourceWindowId;
      }
    }
  }

  const windowId = Number(activeTab?.windowId);
  if (!Number.isInteger(windowId)) {
    throw new Error("当前窗口信息尚未就绪。");
  }
  return windowId;
}

async function startButton6FromFeatureMatrix() {
  const windowId = await getSidePanelWindowId();
  const payload = {
    jobId: `button6-${Date.now()}`,
    windowId,
    targetUrl: "https://ipinfo.io/explore",
    requestedAt: new Date().toISOString()
  };

  panelFeatureStartInFlight = true;
  currentMode = "button6";
  setPanelMode("button6");
  try {
    await chrome.storage.session.set({
      [ACTIVE_MODE_STORAGE_KEY]: "button6",
      [BUTTON6_PENDING_STORAGE_KEY]: payload
    });
    await consumeButton6PendingJob();
  } finally {
    panelFeatureStartInFlight = false;
  }
}

async function startButton11FromFeatureMatrix() {
  const windowId = await getSidePanelWindowId();
  const settings = await chrome.storage.local.get([
    BACKEND_BASE_URL_STORAGE_KEY,
    BACKEND_TOKEN_STORAGE_KEY
  ]);
  const storedBackendBaseUrl = String(settings[BACKEND_BASE_URL_STORAGE_KEY] || "").trim();
  const backendBaseUrl = !storedBackendBaseUrl || storedBackendBaseUrl === LEGACY_BACKEND_BASE_URL
    ? DEFAULT_BACKEND_BASE_URL
    : storedBackendBaseUrl;
  const token = String(settings[BACKEND_TOKEN_STORAGE_KEY] || "");
  if (!token) {
    throw new Error("请先使用按钮1刷新后端 token。");
  }
  if (backendBaseUrl !== storedBackendBaseUrl) {
    await chrome.storage.local.set({ [BACKEND_BASE_URL_STORAGE_KEY]: backendBaseUrl });
  }

  const payload = {
    jobId: `button11-${Date.now()}`,
    backendBaseUrl,
    token,
    windowId,
    requestedAt: new Date().toISOString()
  };

  panelFeatureStartInFlight = true;
  currentMode = "button11";
  setPanelMode("button11");
  try {
    await chrome.storage.session.set({
      [ACTIVE_MODE_STORAGE_KEY]: "button11",
      [PENDING_STORAGE_KEY]: payload
    });
    await consumePendingJob();
  } finally {
    panelFeatureStartInFlight = false;
  }
}

async function openPopupFeatureFromMatrix(featureId) {
  const pending = {
    featureId,
    requestedAt: new Date().toISOString(),
    source: "sidepanel"
  };
  localStorage.setItem(POPUP_PENDING_FEATURE_STORAGE_KEY, JSON.stringify(pending));
  try {
    await chrome.action.openPopup();
  } catch (error) {
    localStorage.removeItem(POPUP_PENDING_FEATURE_STORAGE_KEY);
    throw error;
  }
}

async function runPanelFeature(featureId) {
  if (featureId === "6") {
    await startButton6FromFeatureMatrix();
    return;
  }
  if (featureId === "11") {
    await startButton11FromFeatureMatrix();
    return;
  }
  await openPopupFeatureFromMatrix(featureId);
}

async function consumePendingJob() {
  if (startInFlight || currentMode !== "button11") {
    return;
  }

  const result = await chrome.storage.session.get(PENDING_STORAGE_KEY);
  const pending = result[PENDING_STORAGE_KEY];
  if (!pending) {
    return;
  }

  startInFlight = true;
  await chrome.storage.session.remove(PENDING_STORAGE_KEY);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON11_START",
      payload: pending
    });

    if (!response?.ok) {
      throw new Error(response?.error || "按钮11后台任务启动失败。");
    }
  } catch (error) {
    const existing = currentJob || {};
    renderJob({
      ...existing,
      status: "error",
      phase: "failed",
      progress: existing.progress || 0,
      message: error.message || String(error),
      error: error.message || String(error),
      completedAt: new Date().toISOString()
    });
  } finally {
    startInFlight = false;
  }
}

async function consumeButton6PendingJob() {
  if (button6StartInFlight || currentMode !== "button6") {
    return;
  }

  const result = await chrome.storage.session.get(BUTTON6_PENDING_STORAGE_KEY);
  const pending = result[BUTTON6_PENDING_STORAGE_KEY];
  if (!pending) {
    return;
  }

  button6StartInFlight = true;
  await chrome.storage.session.remove(BUTTON6_PENDING_STORAGE_KEY);
  renderButton6Job({
    ...(currentButton6Job || {}),
    id: pending.jobId,
    status: "running",
    phase: "queued",
    progress: 5,
    targetUrl: pending.targetUrl,
    message: "正在提交按钮6页面任务...",
    startedAt: new Date().toISOString()
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON6_START",
      payload: pending
    });

    if (!response?.ok) {
      throw new Error(response?.error || "按钮6后台任务启动失败。");
    }
  } catch (error) {
    renderButton6Job({
      ...(currentButton6Job || {}),
      status: "error",
      phase: "failed",
      message: error.message || String(error),
      error: error.message || String(error),
      completedAt: new Date().toISOString()
    });
  } finally {
    button6StartInFlight = false;
    await loadButton6Job();
  }
}

elements.copyToken.addEventListener("click", async () => {
  const accessToken = pageAccessToken(currentJob);
  if (!accessToken) {
    return;
  }
  await copyText(accessToken);
  elements.copyToken.textContent = "已复制";
  setTimeout(() => {
    elements.copyToken.textContent = "复制AT";
  }, 1200);
});

panelFeatureButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (panelFeatureActionInFlight) {
      return;
    }

    const featureId = String(button.dataset.panelFeature || "");
    panelFeatureActionInFlight = true;
    panelFeatureButtons.forEach((item) => {
      item.disabled = item.dataset.panelFeature === "3"
        || item.dataset.panelFeature === "4"
        || panelFeatureActionInFlight;
    });

    try {
      await runPanelFeature(featureId);
    } catch (error) {
      elements.errorSection.hidden = false;
      elements.errorText.textContent = error.message || String(error);
    } finally {
      panelFeatureActionInFlight = false;
      panelFeatureButtons.forEach((item) => {
        item.disabled = item.dataset.panelFeature === "3" || item.dataset.panelFeature === "4";
      });
    }
  });
});

elements.workspaceList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-workspace-action]");
  if (!button || workspaceActionInFlight) {
    return;
  }

  const action = button.dataset.workspaceAction || "";
  const workspaceId = button.dataset.workspaceId || "";
  const workspace = (currentJob?.workspaces || []).find((item) => String(item?.id || "") === workspaceId);
  workspaceActionInFlight = true;
  renderJob(currentJob);

  try {
    if (action === "copy" && workspace?.accessToken) {
      await copyText(workspace.accessToken);
      await updateStoredWorkspaceAction(workspaceId, action, "success", "空间 AT 已复制");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "BUTTON11_WORKSPACE_ACTION",
      payload: { action, workspaceId }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Workspace 操作失败。");
    }

    if (action === "copy") {
      const stored = await chrome.storage.session.get(JOB_STORAGE_KEY);
      const storedWorkspace = (stored[JOB_STORAGE_KEY]?.workspaces || [])
        .find((item) => String(item?.id || "") === workspaceId);
      const workspaceAccessToken = String(storedWorkspace?.accessToken || "");
      if (!workspaceAccessToken) {
        throw new Error("目标 Workspace 未返回 AT。");
      }
      await copyText(workspaceAccessToken);
      await updateStoredWorkspaceAction(
        workspaceId,
        action,
        "success",
        response.restoredWorkspaceId === workspaceId
          ? "AT 已复制，当前 Workspace 未变化"
          : "AT 已复制，当前 Workspace 已恢复"
      );
    }
  } catch (error) {
    await updateStoredWorkspaceAction(
      workspaceId,
      action,
      "error",
      error.message || String(error)
    );
  } finally {
    workspaceActionInFlight = false;
    await loadJob();
  }
});

elements.exportResult.addEventListener("click", () => {
  if (!currentJob) {
    return;
  }
  const exportPayload = {
    ...currentJob,
    ...buildCodexAuthFields(currentJob)
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `button11-${currentJob.id || Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

elements.openSession.addEventListener("click", async () => {
  if (!Number.isInteger(currentJob?.tabId)) {
    return;
  }
  const tab = await chrome.tabs.update(currentJob.tabId, { active: true });
  if (Number.isInteger(tab?.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
});

elements.refreshJob.addEventListener("click", async () => {
  if (!currentJob || !Number.isInteger(currentJob.tabId)) {
    return;
  }

  const originalText = elements.refreshJob.textContent;
  elements.refreshJob.disabled = true;
  elements.refreshJob.textContent = "刷新中...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON11_REFRESH",
      payload: {
        jobId: `button11-refresh-${Date.now()}`,
        backendBaseUrl: currentJob.backendBaseUrl,
        token: currentJob.token,
        windowId: currentJob.windowId,
        refreshTabId: currentJob.tabId,
        requestedAt: new Date().toISOString()
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "按钮11无缓存刷新失败。");
    }
  } catch (error) {
    elements.errorSection.hidden = false;
    elements.errorText.textContent = error.message || String(error);
  } finally {
    elements.refreshJob.textContent = originalText;
    elements.refreshJob.disabled = currentJob?.status === "running"
      || !Number.isInteger(currentJob?.tabId);
  }
});

elements.button6Activate.addEventListener("click", async () => {
  if (!Number.isInteger(currentButton6Job?.tabId)) {
    return;
  }

  const tab = await chrome.tabs.update(currentButton6Job.tabId, { active: true });
  if (Number.isInteger(tab?.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
});

elements.button6CopyContent.addEventListener("click", async () => {
  const content = String(currentButton6Job?.pageContent || "");
  if (!content) {
    return;
  }
  await copyText(content);
  elements.button6CopyContent.textContent = "已复制";
  setTimeout(() => {
    elements.button6CopyContent.textContent = "复制内容";
  }, 1200);
});

elements.button6Refresh.addEventListener("click", async () => {
  if (!Number.isInteger(currentButton6Job?.tabId) || button6StartInFlight) {
    return;
  }

  button6StartInFlight = true;
  renderButton6Job(currentButton6Job);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON6_REFRESH",
      payload: {
        jobId: currentButton6Job.id,
        tabId: currentButton6Job.tabId,
        windowId: currentButton6Job.windowId,
        requestedAt: new Date().toISOString()
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "按钮6页面刷新失败。");
    }
  } catch (error) {
    elements.errorSection.hidden = false;
    elements.errorText.textContent = error.message || String(error);
  } finally {
    button6StartInFlight = false;
    await loadButton6Job();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  if (changes[ACTIVE_MODE_STORAGE_KEY]) {
    currentMode = changes[ACTIVE_MODE_STORAGE_KEY].newValue === "button6" ? "button6" : "button11";
    if (currentMode === "button6") {
      void loadButton6Job();
    } else {
      void loadJob();
    }
  }
  if (changes[JOB_STORAGE_KEY] && currentMode === "button11") {
    renderJob(changes[JOB_STORAGE_KEY].newValue || null);
  }
  if (changes[BUTTON6_JOB_STORAGE_KEY] && currentMode === "button6") {
    renderButton6Job(changes[BUTTON6_JOB_STORAGE_KEY].newValue || null);
  }
  if (changes[PENDING_STORAGE_KEY]?.newValue && currentMode === "button11" && !panelFeatureStartInFlight) {
    void consumePendingJob();
  }
  if (changes[BUTTON6_PENDING_STORAGE_KEY]?.newValue && currentMode === "button6" && !panelFeatureStartInFlight) {
    void consumeButton6PendingJob();
  }
});

void loadActivePanel().then(() => {
  if (currentMode === "button6") {
    void consumeButton6PendingJob();
  } else {
    void consumePendingJob();
  }
});
