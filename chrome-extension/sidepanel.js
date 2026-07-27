const JOB_STORAGE_KEY = "button11.job";
const PENDING_STORAGE_KEY = "button11.pending";
const BUTTON6_JOB_STORAGE_KEY = "button6.job";
const BUTTON6_PENDING_STORAGE_KEY = "button6.pending";
const BUTTON17_JOB_STORAGE_KEY = "button17.job";
const BUTTON17_PENDING_STORAGE_KEY = "button17.pending";
const BUTTON18_JOB_STORAGE_KEY = "button18.job";
const BUTTON18_PENDING_STORAGE_KEY = "button18.pending";
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
  exportAuth: document.getElementById("export-auth"),
  importSub2api: document.getElementById("import-sub2api"),
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
  button17Details: document.getElementById("button17-details"),
  button17AtSection: document.getElementById("button17-at-section"),
  button17AtInput: document.getElementById("button17-at-input"),
  button17AtStatus: document.getElementById("button17-at-status"),
  button17FetchAt: document.getElementById("button17-fetch-at"),
  button17CopyAt: document.getElementById("button17-copy-at"),
  button17CheckMomo: document.getElementById("button17-check-momo"),
  button17MomoResult: document.getElementById("button17-momo-result"),
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
  button17Availability: document.getElementById("button17-availability"),
  button17AccountPlan: document.getElementById("button17-account-plan"),
  button17CurrentPrice: document.getElementById("button17-current-price"),
  button17OriginalPrice: document.getElementById("button17-original-price"),
  button17Currency: document.getElementById("button17-currency"),
  button17BillingPeriod: document.getElementById("button17-billing-period"),
  button17Promotion: document.getElementById("button17-promotion"),
  button17VisiblePlans: document.getElementById("button17-visible-plans"),
  button17ExtractionMode: document.getElementById("button17-extraction-mode"),
  button17PageTitle: document.getElementById("button17-page-title"),
  button17TabId: document.getElementById("button17-tab-id"),
  button17StartedAt: document.getElementById("button17-started-at"),
  button17CompletedAt: document.getElementById("button17-completed-at"),
  button17Activate: document.getElementById("button17-activate"),
  button17Refresh: document.getElementById("button17-refresh"),
  button17Copy: document.getElementById("button17-copy"),
  button18Details: document.getElementById("button18-details"),
  button18MonthlyLimit: document.getElementById("button18-monthly-limit"),
  button18ProgressWidth: document.getElementById("button18-progress-width"),
  button18CreditBalance: document.getElementById("button18-credit-balance"),
  button18SharedNote: document.getElementById("button18-shared-note"),
  button18ExtractionMode: document.getElementById("button18-extraction-mode"),
  button18PageTitle: document.getElementById("button18-page-title"),
  button18TabId: document.getElementById("button18-tab-id"),
  button18StartedAt: document.getElementById("button18-started-at"),
  button18CompletedAt: document.getElementById("button18-completed-at"),
  button18Activate: document.getElementById("button18-activate"),
  button18Refresh: document.getElementById("button18-refresh"),
  button18Copy: document.getElementById("button18-copy"),
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
  expanding_plans: "展开全部套餐",
  waiting_pricing: "等待 Plus 价格",
  reading_pricing: "读取 Plus 价格",
  rechecking_pricing: "补查 Plus 价格",
  waiting_usage: "等待 Codex 用量",
  reading_usage: "读取 Codex 用量",
  refreshing_session: "刷新 Session",
  reading_session: "读取 Session",
  saving: "保存 AT",
  fetching_workspaces: "查询 Workspace",
  exchanging_workspace: "切换 Workspace",
  generating_auth_key: "生成 AUTH 密钥",
  registering_auth_agent: "注册 Codex Agent",
  verifying_auth_task: "验证 AUTH Task",
  importing_sub2api: "导入 Sub2API",
  completed: "任务完成",
  failed: "任务失败"
};

let currentJob = null;
let currentButton6Job = null;
let currentButton17Job = null;
let currentButton18Job = null;
let currentMode = "button11";
let startInFlight = false;
let button6StartInFlight = false;
let button17StartInFlight = false;
let button17AtInFlight = false;
let button17MomoInFlight = false;
let button18StartInFlight = false;
let workspaceActionInFlight = false;
let authExportInFlight = false;
let sub2apiImportInFlight = false;
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
    `保存位置: ${job.savedTo || "--"}`,
    `Sub2API ID: ${job.sub2apiImport?.accountId ?? "--"}`
  ].join("\n");
}

function setPanelMode(mode) {
  currentMode = ["button6", "button17", "button18"].includes(mode) ? mode : "button11";
  const isButton6 = currentMode === "button6";
  const isButton11 = currentMode === "button11";
  const isButton17 = currentMode === "button17";
  const isButton18 = currentMode === "button18";

  elements.panelEyebrow.textContent = isButton6
    ? "BUTTON 6"
    : isButton17
      ? "BUTTON 17"
      : isButton18
        ? "BUTTON 18"
        : "BUTTON 11";
  elements.panelTitle.textContent = isButton6
    ? "IPInfo Explore"
    : isButton17
      ? "Plus 套餐价格"
      : isButton18
        ? "Codex 套餐用量"
        : "AT 任务";
  elements.featureModeLabel.textContent = isButton6
    ? "IPInfo 页面"
    : isButton17
      ? "Plus 定价"
      : isButton18
        ? "Codex 用量"
        : "按钮11 AT";
  elements.button6Details.hidden = !isButton6;
  elements.button11Details.hidden = !isButton11;
  elements.button17Details.hidden = !isButton17;
  elements.button18Details.hidden = !isButton18;
  elements.button17AtSection.hidden = true;
  elements.button11TokenSection.hidden = !isButton11;
  elements.button11WorkspaceSection.hidden = !isButton11;
  elements.button6Activate.hidden = !isButton6;
  elements.button6Refresh.hidden = !isButton6;
  elements.button6CopyContent.hidden = !isButton6;
  elements.refreshJob.hidden = !isButton11;
  elements.copyToken.hidden = !isButton11;
  elements.openSession.hidden = !isButton11;
  elements.exportResult.hidden = !isButton11;
  elements.exportAuth.hidden = !isButton11;
  elements.importSub2api.hidden = !isButton11;
  elements.button17Activate.hidden = !isButton17;
  elements.button17Refresh.hidden = !isButton17;
  elements.button17Copy.hidden = !isButton17;
  elements.button18Activate.hidden = !isButton18;
  elements.button18Refresh.hidden = !isButton18;
  elements.button18Copy.hidden = !isButton18;
}

function renderJob(job) {
  setPanelMode("button11");
  currentJob = job || null;
  const status = job?.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  const accessToken = pageAccessToken(job);
  const errors = [
    job?.error,
    job?.saveError,
    job?.workspaceError,
    job?.authExport?.error,
    job?.sub2apiImport?.error
  ].filter(Boolean);
  const workspaceBusy = workspaceActionInFlight
    || authExportInFlight
    || sub2apiImportInFlight
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
  elements.exportAuth.disabled = !accessToken || workspaceBusy;
  elements.importSub2api.disabled = !accessToken
    || !job?.backendBaseUrl
    || !job?.token
    || workspaceBusy;
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

function buildButton17Content(job) {
  if (!job) {
    return "等待按钮17启动任务。";
  }
  const availablePlans = Array.isArray(job.availablePlans) ? job.availablePlans : [];
  const availablePlansText = availablePlans
    .map((plan) => [plan.name, plan.price, plan.billingPeriod].filter(Boolean).join(" "))
    .join("；") || "--";
  const lines = [
    `套餐: ${job.planName || "Plus"}`,
    `Plus状态: ${job.plusAvailable === false ? "当前页面未展示" : job.currentPrice || job.alreadyOnPlus ? "已展示" : "等待读取"}`,
    `账号套餐: ${job.alreadyOnPlus ? `已是 Plus（${job.currentPlanCta || "你当前的套餐"}）` : "非 Plus / 可升级"}`,
    `当前价格: ${job.currentPrice || "--"}`,
    `原价: ${job.originalPrice || "--"}`,
    `币种: ${job.currency || "--"}${job.currencyIsVnd ? "（VND 可检测）" : job.plusPriceZero ? "（非VND，禁止检测）" : ""}`,
    `计费周期: ${job.billingPeriod || "--"}`,
    `优惠: ${job.promotion || "--"}`,
    `优惠说明: ${job.terms || "--"}`,
    `可见套餐: ${availablePlansText}`,
    `页面: ${job.pageUrl || job.targetUrl || "--"}`
  ];
  if (job.momoStatus && job.momoStatus !== "idle") {
    const methods = Array.isArray(job.momoMethods) && job.momoMethods.length
      ? job.momoMethods.join(", ")
      : "--";
    lines.push(
      "",
      "--- MoMo 通道检测 ---",
      `结论: ${job.momoMessage || job.momoDecision || "检测中"}`,
      `支付通道: ${methods}`,
      `包含MoMo: ${job.momoHasChannel == null ? "--" : job.momoHasChannel ? "是" : "否"}`,
      `trial标记: ${job.momoActualTrial == null ? "--" : job.momoActualTrial ? "是" : "否"}`,
      `0元/优惠: ${job.momoOfferApplied == null ? "--" : job.momoOfferApplied ? "是" : "否"}`,
      `优惠判定依据: ${job.momoOfferEvidence || "--"}（amount_due=0 可能只是 promo）`,
      `Stripe模式: ${job.momoStripeMode || "--"}`,
      `币种: ${job.momoCurrency || "--"}`,
      `应付金额(最小货币单位): ${job.momoAmountDue == null ? "--" : job.momoAmountDue}`,
      `Checkout尾号: ${job.momoCheckoutSuffix || "--"}`,
      `检测时间: ${job.momoCheckedAt || "--"}`
    );
  }
  return lines.join("\n");
}

function buildButton18Content(job) {
  if (!job) {
    return "等待按钮18启动任务。";
  }
  return [
    `每月使用上限剩余: ${job.monthlyLimitPercent || "--"}`,
    `进度条宽度: ${job.progressWidth || "--"}`,
    `剩余额度: ${job.creditBalance ?? "--"}`,
    `共用说明: ${job.sharedNote || "--"}`,
    `提取方式: ${job.extractionMode || "--"}`,
    `页面: ${job.pageUrl || job.targetUrl || "--"}`,
    `标题: ${job.pageTitle || "--"}`
  ].join("\n");
}

function renderButton18Job(job) {
  setPanelMode("button18");
  currentButton18Job = job || null;
  const status = job?.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  const busy = status === "running" || button18StartInFlight;
  const hasResult = Boolean(job?.monthlyLimitPercent || job?.creditBalance !== undefined && job?.creditBalance !== "");

  elements.statusBadge.className = `status-badge ${status}`;
  elements.statusBadge.textContent = statusLabel(status);
  elements.phaseText.textContent = phaseLabels[job?.phase] || (job ? "用量读取中" : "暂无任务");
  elements.progressText.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;
  elements.jobMessage.textContent = job?.message || "等待按钮18启动任务。";
  elements.button18MonthlyLimit.textContent = job?.monthlyLimitPercent || "--";
  elements.button18ProgressWidth.textContent = job?.progressWidth || "--";
  elements.button18CreditBalance.textContent = job?.creditBalance === "" || job?.creditBalance == null
    ? "--"
    : String(job.creditBalance);
  elements.button18SharedNote.textContent = job?.sharedNote || "--";
  elements.button18ExtractionMode.textContent = job?.extractionMode || "--";
  elements.button18PageTitle.textContent = job?.pageTitle || "--";
  elements.button18TabId.textContent = Number.isInteger(job?.tabId) ? String(job.tabId) : "--";
  elements.button18StartedAt.textContent = formatTime(job?.startedAt);
  elements.button18CompletedAt.textContent = formatTime(job?.completedAt);
  elements.button18Activate.disabled = busy || !Number.isInteger(job?.tabId);
  elements.button18Refresh.disabled = busy || !Number.isInteger(job?.tabId);
  elements.button18Copy.disabled = busy || !hasResult;
  elements.errorSection.hidden = !job?.error;
  elements.errorText.textContent = job?.error || "";
  const summary = buildButton18Content(job);
  elements.pageContentTitle.textContent = "Codex 用量结果";
  elements.pageContentMeta.textContent = `${summary.length} 字符`;
  elements.pageContentBox.textContent = job?.pageSnippet
    ? `${summary}\n\n--- 页面片段 ---\n${job.pageSnippet}`
    : summary;
  renderTaskLogs(job);
}

function renderButton17Job(job) {
  setPanelMode("button17");
  currentButton17Job = job || null;
  const status = job?.status || "idle";
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  const busy = status === "running" || button17StartInFlight;
  const atBusy = button17AtInFlight || job?.accountAtStatus === "loading";
  const momoBusy = button17MomoInFlight || job?.momoStatus === "running";
  const showAtSection = Boolean(job?.plusAvailable && job?.plusPriceZero);
  const allowMomoActions = Boolean(
    showAtSection && job?.currencyIsVnd && !job?.alreadyOnPlus
  );
  const errors = [job?.error, job?.accountAtError, job?.momoError].filter(Boolean);

  elements.statusBadge.className = `status-badge ${status}`;
  elements.statusBadge.textContent = statusLabel(status);
  elements.phaseText.textContent = phaseLabels[job?.phase] || (job ? "价格读取中" : "暂无任务");
  elements.progressText.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;
  elements.jobMessage.textContent = job?.message || "等待按钮17启动任务。";
  const availablePlans = Array.isArray(job?.availablePlans) ? job.availablePlans : [];
  const availablePlansText = availablePlans
    .map((plan) => [plan.name, plan.price].filter(Boolean).join(" "))
    .join("；");
  elements.button17Availability.textContent = job?.plusAvailable === false
    ? "当前页面未展示"
    : job?.currentPrice || job?.alreadyOnPlus
      ? "已展示"
      : "--";
  elements.button17AccountPlan.textContent = job?.alreadyOnPlus
    ? `已是 Plus（${job?.currentPlanCta || "你当前的套餐"}）`
    : job?.plusAvailable === false
      ? "未展示 Plus"
      : job?.currentPrice
        ? "非 Plus / 可升级"
        : "--";
  elements.button17CurrentPrice.textContent = job?.currentPrice || "--";
  elements.button17OriginalPrice.textContent = job?.originalPrice || "--";
  elements.button17Currency.textContent = job?.currency
    ? `${job.currency}${job.currencyIsVnd ? " ✓VND" : " ✗非VND"}`
    : job?.currencyIsVnd
      ? "VND"
      : job?.plusPriceZero
        ? "非VND"
        : "--";
  elements.button17BillingPeriod.textContent = job?.billingPeriod || "--";
  elements.button17Promotion.textContent = job?.promotion || "--";
  elements.button17VisiblePlans.textContent = availablePlansText || "--";
  elements.button17ExtractionMode.textContent = job?.extractionMode || "--";
  elements.button17PageTitle.textContent = job?.pageTitle || "--";
  elements.button17TabId.textContent = Number.isInteger(job?.tabId) ? String(job.tabId) : "--";
  elements.button17StartedAt.textContent = formatTime(job?.startedAt);
  elements.button17CompletedAt.textContent = formatTime(job?.completedAt);
  elements.button17Activate.disabled = busy || !Number.isInteger(job?.tabId);
  elements.button17Refresh.disabled = busy || momoBusy || !Number.isInteger(job?.tabId);
  elements.button17Copy.disabled = busy || (!job?.currentPrice && !job?.alreadyOnPlus && job?.plusAvailable !== false);
  elements.button17AtSection.hidden = !showAtSection;
  elements.button17AtInput.value = showAtSection ? job?.accountAccessToken || "" : "";
  elements.button17AtInput.title = showAtSection ? job?.accountAccessToken || "" : "";
  elements.button17AtStatus.textContent = job?.accountAtStatus === "success"
    ? job?.accountEmail || "提取完成"
    : job?.accountAtStatus === "error"
      ? "提取失败"
      : atBusy
        ? "提取中"
        : "等待提取";
  elements.button17FetchAt.disabled = !allowMomoActions || busy || atBusy || momoBusy;
  elements.button17CopyAt.disabled = !allowMomoActions || !job?.accountAccessToken;
  elements.button17CopyAt.classList.toggle("is-token-ready", Boolean(allowMomoActions && job?.accountAccessToken));
  elements.button17CheckMomo.disabled = !allowMomoActions || !job?.accountAccessToken || busy || atBusy || momoBusy;
  const methods = Array.isArray(job?.momoMethods) ? job.momoMethods.join(", ") : "";
  elements.button17MomoResult.className = `button17-momo-result ${job?.momoStatus === "success" ? "success" : job?.momoStatus === "warning" ? "warning" : job?.momoStatus === "error" ? "error" : ""}`;
  elements.button17MomoResult.textContent = !showAtSection
    ? "等待零价 Plus"
    : !job?.currencyIsVnd
      ? `币种非 VND（${job?.currency || job?.billingPeriod || "未知"}），检测按钮已禁用`
      : job?.momoStatus === "running"
        ? "正在创建 Checkout 并读取支付通道..."
        : job?.accountAtStatus === "loading"
          ? "正在提取 AT，随后自动检测支付通道..."
          : job?.momoMessage
            || (methods ? `支付通道：${methods}` : allowMomoActions && job?.accountAccessToken ? "可手动复检" : "等待自动检测");
  elements.errorSection.hidden = errors.length === 0;
  elements.errorText.textContent = errors.join("\n");
  const summary = buildButton17Content(job);
  elements.pageContentTitle.textContent = "Plus 价格结果";
  elements.pageContentMeta.textContent = `${summary.length} 字符`;
  elements.pageContentBox.textContent = job?.cardText
    ? `${summary}\n\n--- Plus 卡片原文 ---\n${job.cardText}`
    : summary;
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

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

async function loadButton17Job() {
  const result = await chrome.storage.session.get(BUTTON17_JOB_STORAGE_KEY);
  renderButton17Job(result[BUTTON17_JOB_STORAGE_KEY] || null);
}

async function loadButton18Job() {
  const result = await chrome.storage.session.get(BUTTON18_JOB_STORAGE_KEY);
  renderButton18Job(result[BUTTON18_JOB_STORAGE_KEY] || null);
}

async function loadActivePanel() {
  const result = await chrome.storage.session.get([
    ACTIVE_MODE_STORAGE_KEY,
    BUTTON6_PENDING_STORAGE_KEY,
    BUTTON17_PENDING_STORAGE_KEY,
    BUTTON18_PENDING_STORAGE_KEY,
    PENDING_STORAGE_KEY
  ]);
  const mode = result[ACTIVE_MODE_STORAGE_KEY]
    || (result[BUTTON6_PENDING_STORAGE_KEY] ? "button6" : "")
    || (result[BUTTON17_PENDING_STORAGE_KEY] ? "button17" : "")
    || (result[BUTTON18_PENDING_STORAGE_KEY] ? "button18" : "")
    || (result[PENDING_STORAGE_KEY] ? "button11" : "")
    || "button11";

  if (mode === "button6") {
    await loadButton6Job();
    return;
  }
  if (mode === "button17") {
    await loadButton17Job();
    return;
  }
  if (mode === "button18") {
    await loadButton18Job();
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

async function startButton17FromFeatureMatrix() {
  const windowId = await getSidePanelWindowId();
  const payload = {
    jobId: `button17-${Date.now()}`,
    windowId,
    targetUrl: "https://chatgpt.com/?promo_campaign=plus-1-month-free#pricing",
    requestedAt: new Date().toISOString()
  };

  panelFeatureStartInFlight = true;
  currentMode = "button17";
  setPanelMode("button17");
  try {
    await chrome.storage.session.set({
      [ACTIVE_MODE_STORAGE_KEY]: "button17",
      [BUTTON17_PENDING_STORAGE_KEY]: payload
    });
    await consumeButton17PendingJob();
  } finally {
    panelFeatureStartInFlight = false;
  }
}

async function startButton18FromFeatureMatrix() {
  const windowId = await getSidePanelWindowId();
  const payload = {
    jobId: `button18-${Date.now()}`,
    windowId,
    targetUrl: "https://chatgpt.com/codex/settings/usage",
    requestedAt: new Date().toISOString()
  };

  panelFeatureStartInFlight = true;
  currentMode = "button18";
  setPanelMode("button18");
  try {
    await chrome.storage.session.set({
      [ACTIVE_MODE_STORAGE_KEY]: "button18",
      [BUTTON18_PENDING_STORAGE_KEY]: payload
    });
    await consumeButton18PendingJob();
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

async function openChatGptLoginFromFeatureMatrix() {
  const windowId = await getSidePanelWindowId();
  const tabs = await chrome.tabs.query({ active: true, windowId });
  const response = await chrome.runtime.sendMessage({
    type: "OPEN_CHATGPT_LOGIN_PAGE",
    payload: {
      tabId: tabs?.[0]?.id,
      windowId,
      requestedAt: new Date().toISOString()
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "GPT 登录页打开失败。");
  }
  return response;
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
  if (featureId === "16") {
    await openChatGptLoginFromFeatureMatrix();
    return;
  }
  if (featureId === "17") {
    await startButton17FromFeatureMatrix();
    return;
  }
  if (featureId === "18") {
    await startButton18FromFeatureMatrix();
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

async function consumeButton17PendingJob() {
  if (button17StartInFlight || currentMode !== "button17") {
    return;
  }

  const result = await chrome.storage.session.get(BUTTON17_PENDING_STORAGE_KEY);
  const pending = result[BUTTON17_PENDING_STORAGE_KEY];
  if (!pending) {
    return;
  }

  button17StartInFlight = true;
  await chrome.storage.session.remove(BUTTON17_PENDING_STORAGE_KEY);
  renderButton17Job({
    ...(currentButton17Job || {}),
    id: pending.jobId,
    status: "running",
    phase: "queued",
    progress: 5,
    targetUrl: pending.targetUrl,
    message: "正在提交按钮17价格任务...",
    startedAt: new Date().toISOString()
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON17_START",
      payload: pending
    });
    if (!response?.ok) {
      throw new Error(response?.error || "按钮17价格任务启动失败。");
    }
  } catch (error) {
    renderButton17Job({
      ...(currentButton17Job || {}),
      status: "error",
      phase: "failed",
      message: error.message || String(error),
      error: error.message || String(error),
      completedAt: new Date().toISOString()
    });
  } finally {
    button17StartInFlight = false;
    await loadButton17Job();
  }
}

async function consumeButton18PendingJob() {
  if (button18StartInFlight || currentMode !== "button18") {
    return;
  }

  const result = await chrome.storage.session.get(BUTTON18_PENDING_STORAGE_KEY);
  const pending = result[BUTTON18_PENDING_STORAGE_KEY];
  if (!pending) {
    return;
  }

  button18StartInFlight = true;
  await chrome.storage.session.remove(BUTTON18_PENDING_STORAGE_KEY);
  renderButton18Job({
    ...(currentButton18Job || {}),
    id: pending.jobId,
    status: "running",
    phase: "queued",
    progress: 5,
    targetUrl: pending.targetUrl,
    message: "正在提交按钮18用量任务...",
    startedAt: new Date().toISOString()
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON18_START",
      payload: pending
    });
    if (!response?.ok) {
      throw new Error(response?.error || "按钮18用量任务启动失败。");
    }
  } catch (error) {
    renderButton18Job({
      ...(currentButton18Job || {}),
      status: "error",
      phase: "failed",
      message: error.message || String(error),
      error: error.message || String(error),
      completedAt: new Date().toISOString()
    });
  } finally {
    button18StartInFlight = false;
    await loadButton18Job();
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
  downloadJson(exportPayload, `button11-${currentJob.id || Date.now()}.json`);
});

elements.exportAuth.addEventListener("click", async () => {
  if (!currentJob || !pageAccessToken(currentJob) || authExportInFlight) {
    return;
  }

  const originalText = elements.exportAuth.textContent;
  let actionError = "";
  authExportInFlight = true;
  elements.exportAuth.textContent = "生成中...";
  renderJob(currentJob);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON11_EXPORT_AUTH"
    });
    if (!response?.ok || !response.authJson) {
      throw new Error(response?.error || "AUTH 生成失败。");
    }

    downloadJson(response.authJson, "auth.json");
    elements.exportAuth.textContent = "已导出AUTH";
  } catch (error) {
    actionError = error.message || String(error);
    elements.errorSection.hidden = false;
    elements.errorText.textContent = actionError;
    elements.exportAuth.textContent = "导出失败";
  } finally {
    authExportInFlight = false;
    await loadJob();
    if (actionError) {
      elements.errorSection.hidden = false;
      elements.errorText.textContent = actionError;
    }
    window.setTimeout(() => {
      elements.exportAuth.textContent = originalText;
    }, 1200);
  }
});

elements.importSub2api.addEventListener("click", async () => {
  if (!currentJob || !pageAccessToken(currentJob) || sub2apiImportInFlight) {
    return;
  }

  const originalText = elements.importSub2api.textContent;
  let actionError = "";
  sub2apiImportInFlight = true;
  elements.importSub2api.textContent = "导入中...";
  renderJob(currentJob);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON11_IMPORT_SUB2API",
      payload: {
        sub2apiUrl: "auto"
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Sub2API 导入失败。");
    }

    elements.importSub2api.textContent = `已导入 #${response.accountId}`;
  } catch (error) {
    actionError = error.message || String(error);
    elements.errorSection.hidden = false;
    elements.errorText.textContent = actionError;
    elements.importSub2api.textContent = "导入失败";
  } finally {
    sub2apiImportInFlight = false;
    await loadJob();
    if (actionError) {
      elements.errorSection.hidden = false;
      elements.errorText.textContent = actionError;
    }
    window.setTimeout(() => {
      elements.importSub2api.textContent = originalText;
    }, 1600);
  }
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

elements.button17Activate.addEventListener("click", async () => {
  if (!Number.isInteger(currentButton17Job?.tabId)) {
    return;
  }
  const tab = await chrome.tabs.update(currentButton17Job.tabId, { active: true });
  if (Number.isInteger(tab?.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
});

elements.button17Copy.addEventListener("click", async () => {
  if (!currentButton17Job?.currentPrice && currentButton17Job?.plusAvailable !== false) {
    return;
  }
  await copyText(buildButton17Content(currentButton17Job));
  elements.button17Copy.textContent = "已复制";
  setTimeout(() => {
    elements.button17Copy.textContent = "复制价格";
  }, 1200);
});

elements.button17FetchAt.addEventListener("click", async () => {
  if (!currentButton17Job?.plusAvailable || !currentButton17Job?.plusPriceZero
    || !currentButton17Job?.currencyIsVnd || currentButton17Job?.alreadyOnPlus || button17AtInFlight) {
    return;
  }

  const originalText = elements.button17FetchAt.textContent;
  button17AtInFlight = true;
  elements.button17FetchAt.textContent = "提取中...";
  renderButton17Job(currentButton17Job);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON17_FETCH_CURRENT_AT"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "当前账号 AT 提取失败。");
    }
  } catch (error) {
    elements.errorSection.hidden = false;
    elements.errorText.textContent = error.message || String(error);
  } finally {
    button17AtInFlight = false;
    elements.button17FetchAt.textContent = originalText;
    await loadButton17Job();
  }
});

elements.button17CopyAt.addEventListener("click", async () => {
  const accessToken = String(currentButton17Job?.accountAccessToken || "");
  if (!accessToken) {
    return;
  }

  await copyText(accessToken);
  elements.button17CopyAt.textContent = "已复制";
  setTimeout(() => {
    elements.button17CopyAt.textContent = "复制AT";
  }, 1200);
});

elements.button17CheckMomo.addEventListener("click", async () => {
  if (!currentButton17Job?.accountAccessToken || !currentButton17Job?.currencyIsVnd
    || currentButton17Job?.alreadyOnPlus || button17MomoInFlight) {
    return;
  }

  const originalText = elements.button17CheckMomo.textContent;
  button17MomoInFlight = true;
  elements.button17CheckMomo.textContent = "检测中...";
  renderButton17Job(currentButton17Job);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON17_CHECK_MOMO"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "MoMo 支付通道检测失败。");
    }
  } catch (error) {
    elements.errorSection.hidden = false;
    elements.errorText.textContent = error.message || String(error);
  } finally {
    button17MomoInFlight = false;
    elements.button17CheckMomo.textContent = originalText;
    await loadButton17Job();
  }
});

elements.button18Activate.addEventListener("click", async () => {
  if (!Number.isInteger(currentButton18Job?.tabId)) {
    return;
  }
  const tab = await chrome.tabs.update(currentButton18Job.tabId, { active: true });
  if (Number.isInteger(tab?.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
});

elements.button18Copy.addEventListener("click", async () => {
  if (!currentButton18Job?.monthlyLimitPercent && currentButton18Job?.creditBalance === "") {
    return;
  }
  await copyText(buildButton18Content(currentButton18Job));
  elements.button18Copy.textContent = "已复制";
  setTimeout(() => {
    elements.button18Copy.textContent = "复制用量";
  }, 1200);
});

elements.button18Refresh.addEventListener("click", async () => {
  if (!Number.isInteger(currentButton18Job?.tabId) || button18StartInFlight) {
    return;
  }
  button18StartInFlight = true;
  renderButton18Job(currentButton18Job);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON18_REFRESH",
      payload: {
        jobId: currentButton18Job.id,
        tabId: currentButton18Job.tabId,
        windowId: currentButton18Job.windowId,
        requestedAt: new Date().toISOString()
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "按钮18用量刷新失败。");
    }
  } catch (error) {
    elements.errorSection.hidden = false;
    elements.errorText.textContent = error.message || String(error);
  } finally {
    button18StartInFlight = false;
    await loadButton18Job();
  }
});

elements.button17Refresh.addEventListener("click", async () => {
  if (!Number.isInteger(currentButton17Job?.tabId) || button17StartInFlight) {
    return;
  }

  button17StartInFlight = true;
  renderButton17Job(currentButton17Job);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BUTTON17_REFRESH",
      payload: {
        jobId: currentButton17Job.id,
        tabId: currentButton17Job.tabId,
        windowId: currentButton17Job.windowId,
        requestedAt: new Date().toISOString()
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "按钮17价格刷新失败。");
    }
  } catch (error) {
    elements.errorSection.hidden = false;
    elements.errorText.textContent = error.message || String(error);
  } finally {
    button17StartInFlight = false;
    await loadButton17Job();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  if (changes[ACTIVE_MODE_STORAGE_KEY]) {
    const nextMode = changes[ACTIVE_MODE_STORAGE_KEY].newValue;
    currentMode = ["button6", "button17", "button18"].includes(nextMode) ? nextMode : "button11";
    if (currentMode === "button6") {
      void loadButton6Job();
    } else if (currentMode === "button17") {
      void loadButton17Job();
    } else if (currentMode === "button18") {
      void loadButton18Job();
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
  if (changes[BUTTON17_JOB_STORAGE_KEY] && currentMode === "button17") {
    renderButton17Job(changes[BUTTON17_JOB_STORAGE_KEY].newValue || null);
  }
  if (changes[BUTTON18_JOB_STORAGE_KEY] && currentMode === "button18") {
    renderButton18Job(changes[BUTTON18_JOB_STORAGE_KEY].newValue || null);
  }
  if (changes[PENDING_STORAGE_KEY]?.newValue && currentMode === "button11" && !panelFeatureStartInFlight) {
    void consumePendingJob();
  }
  if (changes[BUTTON6_PENDING_STORAGE_KEY]?.newValue && currentMode === "button6" && !panelFeatureStartInFlight) {
    void consumeButton6PendingJob();
  }
  if (changes[BUTTON17_PENDING_STORAGE_KEY]?.newValue && currentMode === "button17" && !panelFeatureStartInFlight) {
    void consumeButton17PendingJob();
  }
  if (changes[BUTTON18_PENDING_STORAGE_KEY]?.newValue && currentMode === "button18" && !panelFeatureStartInFlight) {
    void consumeButton18PendingJob();
  }
});

void loadActivePanel().then(() => {
  if (currentMode === "button6") {
    void consumeButton6PendingJob();
  } else if (currentMode === "button17") {
    void consumeButton17PendingJob();
  } else if (currentMode === "button18") {
    void consumeButton18PendingJob();
  } else {
    void consumePendingJob();
  }
});
