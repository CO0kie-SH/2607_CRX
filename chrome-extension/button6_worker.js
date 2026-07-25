(() => {
  const JOB_STORAGE_KEY = "button6.job";
  const TARGET_URL = "https://ipinfo.io/explore";
  const PAGE_TIMEOUT_MS = 30000;
  const LOCATION_WAIT_MS = 10000;
  const MAX_PAGE_CONTENT_LENGTH = 50000;
  const MAX_JOB_LOGS = 100;
  let activeJobPromise = null;

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

  function isTargetUrl(value) {
    return String(value || "").startsWith(TARGET_URL);
  }

  function isAboutBlankTab(tab) {
    const url = String(tab?.url || "").trim().toLowerCase();
    const pendingUrl = String(tab?.pendingUrl || "").trim().toLowerCase();
    if (pendingUrl && pendingUrl !== "about:blank") {
      return false;
    }
    return url === "about:blank" || pendingUrl === "about:blank";
  }

  async function findActiveAboutBlankTab(windowId) {
    const query = { active: true };
    if (Number.isInteger(windowId)) {
      query.windowId = windowId;
    } else {
      query.lastFocusedWindow = true;
    }
    const tabs = await chrome.tabs.query(query);
    return tabs.find((tab) => isAboutBlankTab(tab)) || null;
  }

  async function notifyNavigationStarted(payload, tab, mode) {
    if (typeof payload?.onNavigationStarted !== "function") {
      return;
    }
    try {
      await payload.onNavigationStarted({
        jobId: payload.jobId,
        tabId: tab?.id,
        windowId: tab?.windowId,
        targetUrl: TARGET_URL,
        mode,
        requestedAt: nowIso()
      });
    } catch (error) {
      await updateJob({}, createLog(
        `确认 Popup 提前打开失败：${error.message || String(error)}`,
        "warning"
      ));
    }
  }

  async function findExistingTargetTab() {
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => (
      Number.isInteger(tab?.id)
      && (isTargetUrl(tab.url) || isTargetUrl(tab.pendingUrl))
    ));
    return matches.find((tab) => tab.active) || matches[0] || null;
  }

  async function waitForTargetPage(tabId) {
    const startedAt = Date.now();
    let lastUrl = "";

    while (Date.now() - startedAt <= PAGE_TIMEOUT_MS) {
      const tab = await chrome.tabs.get(tabId);
      lastUrl = tab.url || lastUrl;
      if (tab.status === "complete" && isTargetUrl(lastUrl)) {
        return tab;
      }
      await delay(250);
    }

    throw new Error(`等待 IPInfo Explore 页面超时，最后地址：${lastUrl || "未知"}`);
  }

  function reloadTargetPageNoCache(tabId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => finish(new Error("无缓存刷新 IPInfo Explore 超时。")), PAGE_TIMEOUT_MS);

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
        if (isTargetUrl(tab?.url)) {
          finish(null, tab);
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.reload(tabId, { bypassCache: true }).catch((error) => finish(error));
    });
  }

  function extractIpInfoPageData(maxLength) {
    const rawText = document.body?.innerText || "";
    const html = document.documentElement?.outerHTML || "";

    const cleanValue = (value) => String(value || "")
      .trim()
      .replace(/^[\s"']+|[\s"',;}]+$/g, "")
      .trim();
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const readTextValue = (aliases) => {
      for (const alias of aliases) {
        const escapedAlias = escapeRegex(alias);
        const patterns = [
          new RegExp(`(?:^|[^A-Za-z0-9_])["']?${escapedAlias}["']?\\s*[:=]\\s*["']([^"'\\r\\n,}]+)["']`, "i"),
          new RegExp(`(?:^|[\\n\\r])\\s*${escapedAlias}\\s*[:：]\\s*([^\\r\\n]+)`, "i"),
          new RegExp(`(?:^|[\\n\\r])\\s*${escapedAlias}\\s*[\\r\\n]+\\s*([^\\r\\n]+)`, "i")
        ];
        for (const pattern of patterns) {
          const match = rawText.match(pattern);
          const value = cleanValue(match?.[1]);
          if (value) {
            return value;
          }
        }
      }
      return "";
    };
    const readDomPairValue = (aliases) => {
      const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[\s_-]+/g, "")));
      const normalizeLabel = (value) => String(value || "")
        .toLowerCase()
        .replace(/[:：]/g, "")
        .replace(/[\s_-]+/g, "")
        .trim();

      for (const label of document.querySelectorAll("dt, th, [data-key], [data-field], [data-label]")) {
        const attributeLabel = label.getAttribute("data-key")
          || label.getAttribute("data-field")
          || label.getAttribute("data-label")
          || label.textContent;
        if (!normalizedAliases.has(normalizeLabel(attributeLabel))) {
          continue;
        }

        const valueElement = label.matches("dt")
          ? label.nextElementSibling
          : label.matches("th")
            ? label.parentElement?.querySelector("td")
            : null;
        const directValue = cleanValue(valueElement?.textContent);
        if (directValue) {
          return directValue;
        }

        const rowText = cleanValue(label.parentElement?.innerText || label.parentElement?.textContent);
        const labelText = cleanValue(label.textContent);
        const rowValue = cleanValue(rowText.replace(labelText, "").replace(/^[:：\s]+/, ""));
        if (rowValue) {
          return rowValue;
        }
      }
      return "";
    };
    const readValue = (aliases) => readTextValue(aliases) || readDomPairValue(aliases);

    const country = readValue(["country_name", "countryName", "country", "国家"]);
    const explicitCountryCode = readValue(["country_code", "countryCode", "country code", "国家代码"]);
    const countryCode = cleanValue(explicitCountryCode || (/^[a-z]{2}$/i.test(country) ? country : "")).toUpperCase();
    const city = readValue(["city_name", "cityName", "city", "城市"]);

    return {
      title: document.title || "",
      url: window.location.href,
      pageContent: rawText.slice(0, maxLength),
      pageTextLength: rawText.length,
      pageHtmlLength: html.length,
      pageContentTruncated: rawText.length > maxLength,
      country,
      countryCode,
      city
    };
  }

  async function capturePageContent(tabId) {
    const startedAt = Date.now();
    let content = null;

    do {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractIpInfoPageData,
        args: [MAX_PAGE_CONTENT_LENGTH]
      });
      content = results?.[0]?.result || null;
      if (!content) {
        throw new Error("IPInfo 页面内容读取结果为空。");
      }
      if (content.country || content.countryCode || content.city) {
        return content;
      }
      await delay(500);
    } while (Date.now() - startedAt <= LOCATION_WAIT_MS);

    return content;
  }

  async function completeJob(tab, mode, content) {
    const country = String(content?.country || "").trim();
    const countryCode = String(content?.countryCode || "").trim().toUpperCase();
    const city = String(content?.city || "").trim();
    const countryDisplay = country && countryCode && country.toUpperCase() !== countryCode
      ? `${country} (${countryCode})`
      : country || countryCode || "未提取";
    const cityDisplay = city || "未提取";
    const locationComplete = Boolean((country || countryCode) && city);

    await updateJob({
      status: "success",
      phase: "completed",
      progress: 100,
      message: mode === "reuse"
        ? "已复用并刷新 IPInfo Explore 页面。"
        : "IPInfo Explore 页面已打开。",
      mode,
      tabId: tab.id,
      windowId: tab.windowId,
      pageTitle: content?.title || tab.title || "",
      pageUrl: content?.url || tab.url || TARGET_URL,
      pageContent: content?.pageContent || "",
      pageTextLength: content?.pageTextLength || 0,
      pageHtmlLength: content?.pageHtmlLength || 0,
      pageContentTruncated: Boolean(content?.pageContentTruncated),
      pageCapturedAt: nowIso(),
      country,
      countryCode,
      city,
      locationExtractedAt: nowIso(),
      completedAt: nowIso(),
      error: ""
    }, createLog(
      `页面内容记录完成：正文 ${content?.pageTextLength || 0} 字符，HTML ${content?.pageHtmlLength || 0} 字符。`,
      "success"
    ));
    await updateJob({}, createLog(
      `当前国家：${countryDisplay}；当前城市：${cityDisplay}。`,
      locationComplete ? "success" : "warning"
    ));
  }

  async function runNewPageJob(payload) {
    const jobId = payload?.jobId || `button6-${Date.now()}`;
    const windowId = Number(payload?.windowId);

    await replaceJob({
      id: jobId,
      status: "running",
      phase: "queued",
      progress: 5,
      message: "后台页面任务已启动。",
      targetUrl: TARGET_URL,
      requestedAt: payload?.requestedAt || nowIso(),
      startedAt: nowIso(),
      windowId: Number.isInteger(windowId) ? windowId : null,
      tabId: null,
      mode: "new_tab",
      error: "",
      logs: [createLog("按钮6 IPInfo 页面任务已启动。")]
    });

    try {
      await updateJob(
        { phase: "checking_tabs", progress: 12, message: "正在查找已有 IPInfo 标签页..." },
        createLog("正在检查标签列表中的 IPInfo Explore 页面。")
      );
      let tab = await findActiveAboutBlankTab(windowId);
      if (tab) {
        await updateJob({
          mode: "current_tab",
          tabId: tab.id,
          windowId: tab.windowId,
          phase: "navigating",
          progress: 28,
          message: "当前页为空白页，正在直接跳转 IPInfo Explore..."
        }, createLog(`复用当前 about:blank 标签页 ${tab.id}，直接跳转 ${TARGET_URL}。`));

        await chrome.windows.update(tab.windowId, { focused: true });
        tab = await chrome.tabs.update(tab.id, { url: TARGET_URL, active: true });
        await notifyNavigationStarted(payload, tab, "current_tab");
        await updateJob(
          { phase: "loading_page", progress: 68, message: "正在等待页面加载..." },
          createLog("当前标签页已提交目标地址，等待页面完成加载。")
        );
        tab = await waitForTargetPage(tab.id);
        await updateJob(
          { phase: "recording_content", progress: 86, message: "页面已加载，正在记录页面内容..." },
          createLog(`页面加载完成：${tab.title || tab.url || TARGET_URL}。`)
        );
        const content = await capturePageContent(tab.id);
        await completeJob(tab, "current_tab", content);
        return { ok: true, jobId, tabId: tab.id, mode: "current_tab" };
      }

      tab = await findExistingTargetTab();
      if (tab) {
        await updateJob({
          mode: "reuse",
          tabId: tab.id,
          windowId: tab.windowId,
          phase: "reusing_tab",
          progress: 28,
          message: "发现已有页面，正在激活并刷新..."
        }, createLog(`发现已有 IPInfo 标签页 ${tab.id}，正在复用。`));

        tab = await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        if (!isTargetUrl(tab.url)) {
          tab = await waitForTargetPage(tab.id);
        }

        await notifyNavigationStarted(payload, tab, "reuse");

        await updateJob(
          { phase: "refreshing_page", progress: 58, message: "正在无缓存刷新已有页面..." },
          createLog("已有标签页已激活，开始无缓存刷新。")
        );
        tab = await reloadTargetPageNoCache(tab.id);
        await updateJob(
          { phase: "recording_content", progress: 86, message: "刷新完成，正在记录页面内容..." },
          createLog("已有标签页已激活并完成无缓存刷新。")
        );
        const content = await capturePageContent(tab.id);
        await completeJob(tab, "reuse", content);
        return { ok: true, jobId, tabId: tab.id, mode: "reuse" };
      }

      await updateJob(
        { phase: "creating_tab", progress: 18, message: "正在新建标签页..." },
        createLog("未发现已有 IPInfo 标签页，正在新建并激活标签页。")
      );
      const createOptions = { url: "about:blank", active: true };
      if (Number.isInteger(windowId)) {
        createOptions.windowId = windowId;
      }
      tab = await chrome.tabs.create(createOptions);
      if (!Number.isInteger(tab?.id)) {
        throw new Error("新标签页缺少 tabId。");
      }

      await chrome.windows.update(tab.windowId, { focused: true });
      await updateJob({
        tabId: tab.id,
        windowId: tab.windowId,
        phase: "navigating",
        progress: 38,
        message: "新标签页已激活，正在跳转 IPInfo Explore..."
      }, createLog(`标签页 ${tab.id} 已创建，准备跳转 ${TARGET_URL}。`));
      await delay(80);
      await chrome.tabs.update(tab.id, { url: TARGET_URL, active: true });
      tab = await chrome.tabs.get(tab.id);
      await notifyNavigationStarted(payload, tab, "new_tab");
      await updateJob(
        { phase: "loading_page", progress: 68, message: "正在等待页面加载..." },
        createLog("目标地址已提交，等待页面完成加载。")
      );
      tab = await waitForTargetPage(tab.id);
      await updateJob(
        { phase: "recording_content", progress: 86, message: "页面已加载，正在记录内容..." },
        createLog(`页面加载完成：${tab.title || tab.url || TARGET_URL}。`)
      );
      const content = await capturePageContent(tab.id);
      await completeJob(tab, "new_tab", content);
      return { ok: true, jobId, tabId: tab.id };
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

  async function runRefreshJob(payload) {
    const current = await readJob();
    const tabId = Number(payload?.tabId ?? current?.tabId);
    if (!Number.isInteger(tabId)) {
      throw new Error("按钮6页面标签页不存在。");
    }

    await updateJob({
      status: "running",
      phase: "refreshing_page",
      progress: 30,
      message: "正在无缓存刷新 IPInfo Explore...",
      error: ""
    }, createLog("开始无缓存刷新 IPInfo Explore。"));

    try {
      let tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });

      if (isTargetUrl(tab.url)) {
        tab = await reloadTargetPageNoCache(tabId);
      } else {
        await chrome.tabs.update(tabId, { url: TARGET_URL, active: true });
        tab = await waitForTargetPage(tabId);
      }

      await updateJob(
        { phase: "recording_content", progress: 86, message: "刷新完成，正在重新记录内容..." },
        createLog("页面刷新完成，开始重新读取正文。")
      );
      const content = await capturePageContent(tab.id);
      await completeJob(tab, "refresh", content);
      return { ok: true, jobId: current?.id || "", tabId };
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

  function dispatchButton6Job(messageType, payload = {}) {
    if (activeJobPromise) {
      return Promise.resolve({ ok: false, error: "按钮6页面任务正在运行。" });
    }

    const jobPromise = messageType === "BUTTON6_REFRESH"
      ? runRefreshJob(payload)
      : runNewPageJob(payload);
    activeJobPromise = jobPromise;
    return jobPromise
      .then((result) => result)
      .catch((error) => {
        return { ok: false, error: error.message || String(error) };
      })
      .finally(() => {
        if (activeJobPromise === jobPromise) {
          activeJobPromise = null;
        }
      });
  }

  globalThis.__CRX_BUTTON6_WORKER__ = Object.freeze({
    start: (payload = {}) => dispatchButton6Job("BUTTON6_START", payload),
    refresh: (payload = {}) => dispatchButton6Job("BUTTON6_REFRESH", payload),
    isBusy: () => Boolean(activeJobPromise)
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BUTTON6_GET_JOB") {
      readJob().then((job) => sendResponse({ ok: true, job }));
      return true;
    }

    if (message?.type !== "BUTTON6_START" && message?.type !== "BUTTON6_REFRESH") {
      return false;
    }

    void dispatchButton6Job(message.type, message.payload || {}).then(sendResponse);
    return true;
  });
})();
