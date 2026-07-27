(() => {
  const JOB_STORAGE_KEY = "button18.job";
  const TARGET_URL = "https://chatgpt.com/codex/settings/usage";
  const PAGE_TIMEOUT_MS = 30000;
  const USAGE_WAIT_MS = 20000;
  const MAX_CARD_TEXT_LENGTH = 8000;
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
    try {
      const url = new URL(String(value || ""));
      if (url.origin !== "https://chatgpt.com") {
        return false;
      }
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return path === "/codex/settings/usage"
        || path === "/codex/cloud/settings/analytics"
        || path.startsWith("/codex/settings/usage")
        || path.startsWith("/codex/cloud/settings");
    } catch (_error) {
      return false;
    }
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
    throw new Error(`等待 Codex 用量页面超时，最后地址：${lastUrl || "未知"}`);
  }

  function reloadTargetPageNoCache(tabId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(
        () => finish(new Error("无缓存刷新 Codex 用量页面超时。")),
        PAGE_TIMEOUT_MS
      );

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

  function extractCodexUsagePageData(maxCardTextLength) {
    const normalizeText = (value) => String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
    const textOf = (element) => normalizeText(element?.innerText || element?.textContent || "");
    const collectRoots = (root, output = [], seen = new Set()) => {
      if (!root || seen.has(root)) {
        return output;
      }
      seen.add(root);
      output.push(root);
      const walk = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const node of walk) {
        if (node.shadowRoot) {
          collectRoots(node.shadowRoot, output, seen);
        }
      }
      return output;
    };

    const roots = collectRoots(document);
    const pageText = textOf(document.body);
    let monthlyLimitPercent = "";
    let monthlyLimitLabel = "";
    let creditBalance = "";
    let progressWidth = "";
    let cardText = "";
    let extractionMode = "text_fallback";

    // 1) 优先按 article / 标题块 DOM 解析
    for (const root of roots) {
      const articles = root.querySelectorAll
        ? Array.from(root.querySelectorAll("article"))
        : [];
      for (const article of articles) {
        const text = textOf(article);
        if (!monthlyLimitPercent && /每月使用上限|monthly\s+usage\s+limit/i.test(text)) {
          const big = Array.from(article.querySelectorAll("span, div, p"))
            .map(textOf)
            .find((value) => /^\d{1,3}(?:\.\d+)?%$/.test(value));
          const percentMatch = (big && big.match(/^(\d{1,3}(?:\.\d+)?)%$/))
            || text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
          if (percentMatch) {
            monthlyLimitPercent = `${percentMatch[1]}%`;
          }
          // 取进度条前景（通常 style 含 width 且非 100% 背景轨道；优先 transition width）
          const bars = Array.from(article.querySelectorAll("[style*='width']"));
          const preferred = bars.find((el) => /transition/i.test(el.getAttribute("class") || "")
            || /transition/i.test(el.getAttribute("style") || ""))
            || bars.find((el) => /width:\s*\d/i.test(el.getAttribute("style") || ""))
            || bars[bars.length - 1];
          const styleText = String(preferred?.getAttribute("style") || "");
          progressWidth = styleText.match(/width:\s*([^;]+)/i)?.[1]?.trim() || "";
          monthlyLimitLabel = /剩余|remaining/i.test(text) ? "剩余" : "";
          cardText = text;
          extractionMode = "usage_dom";
        }
        if (creditBalance === "" && /剩余额度|credits?\s+balance|credit\s+balance/i.test(text)) {
          const valueSpan = Array.from(article.querySelectorAll("span, div, p"))
            .map(textOf)
            .find((value) => /^\d+(?:[.,]\d+)?$/.test(value));
          creditBalance = valueSpan || "";
          if (creditBalance === "") {
            const creditMatch = text.match(/剩余额度[\s\S]{0,40}?(\d+(?:[.,]\d+)?)/)
              || text.match(/credits?\s+balance[\s\S]{0,40}?(\d+(?:[.,]\d+)?)/i);
            creditBalance = creditMatch?.[1] || "";
          }
        }
      }
    }

    // 2) 文本回退：抓「每月使用上限 ... N% ... 剩余」
    if (!monthlyLimitPercent) {
      const blockMatch = pageText.match(
        /每月使用上限[\s\S]{0,300}?(\d{1,3}(?:\.\d+)?)\s*%[\s\S]{0,80}?剩余/
      ) || pageText.match(
        /monthly\s+usage\s+limit[\s\S]{0,300}?(\d{1,3}(?:\.\d+)?)\s*%[\s\S]{0,80}?remaining/i
      ) || pageText.match(
        /每月使用上限[\s\S]{0,300}?(\d{1,3}(?:\.\d+)?)\s*%/
      );
      if (blockMatch) {
        monthlyLimitPercent = `${blockMatch[1]}%`;
        monthlyLimitLabel = "剩余";
        cardText = blockMatch[0];
        extractionMode = "text_fallback";
      }
    }

    // 3) 直接找大号百分比 + 邻近「剩余」
    if (!monthlyLimitPercent) {
      const percentNodes = Array.from(document.querySelectorAll("span, div, p"))
        .map((el) => ({ el, text: textOf(el) }))
        .filter((item) => /^\d{1,3}(?:\.\d+)?%$/.test(item.text));
      for (const item of percentNodes) {
        const parentText = textOf(item.el.closest("article") || item.el.parentElement);
        if (/每月使用上限|monthly\s+usage\s+limit|剩余|remaining/i.test(parentText)) {
          monthlyLimitPercent = item.text;
          monthlyLimitLabel = /剩余|remaining/i.test(parentText) ? "剩余" : "";
          cardText = parentText;
          extractionMode = "percent_node";
          const article = item.el.closest("article");
          const bars = Array.from((article || document).querySelectorAll("[style*='width']"));
          const preferred = bars.find((el) => /transition/i.test(el.getAttribute("class") || ""))
            || bars[bars.length - 1];
          progressWidth = String(preferred?.getAttribute("style") || "")
            .match(/width:\s*([^;]+)/i)?.[1]?.trim() || progressWidth;
          break;
        }
      }
    }

    if (creditBalance === "") {
      const creditMatch = pageText.match(/剩余额度[\s\S]{0,120}?\b(\d+(?:[.,]\d+)?)\b/)
        || pageText.match(/credits?\s+balance[\s\S]{0,120}?\b(\d+(?:[.,]\d+)?)\b/i);
      if (creditMatch) {
        creditBalance = creditMatch[1];
      }
    }

    if (!progressWidth && monthlyLimitPercent) {
      progressWidth = monthlyLimitPercent;
    }

    const noteMatch = pageText.match(/额度可让你[^\n。]*。?|Credits?\s+let\s+you[^\n.]+\.?/i);
    const sharedNote = noteMatch?.[0] || (
      /Codex 和工作共用同一用量限额|share\s+the\s+same\s+usage/i.test(pageText)
        ? "Codex 和工作共用同一用量限额。"
        : ""
    );

    // 必须以「每月使用上限百分比」为准；仅有剩余额度 0 不算就绪（避免过早返回）
    const found = Boolean(monthlyLimitPercent);
    return {
      found,
      partial: Boolean(creditBalance !== "" || sharedNote),
      extractionMode: found ? extractionMode : "usage_not_ready",
      monthlyLimitPercent,
      monthlyLimitLabel,
      progressWidth,
      creditBalance,
      sharedNote,
      pageSnippet: (cardText || pageText).slice(0, maxCardTextLength),
      title: document.title || "",
      url: window.location.href
    };
  }

  async function captureUsage(tabId) {
    const startedAt = Date.now();
    let result = null;
    let bestPartial = null;
    do {
      const execution = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractCodexUsagePageData,
        args: [MAX_CARD_TEXT_LENGTH]
      });
      result = execution?.[0]?.result || null;
      if (result?.found) {
        return result;
      }
      if (result?.partial) {
        bestPartial = result;
      }
      await delay(400);
    } while (Date.now() - startedAt <= USAGE_WAIT_MS);

    if (bestPartial?.creditBalance !== undefined && bestPartial?.creditBalance !== "") {
      return {
        ...bestPartial,
        found: false,
        extractionMode: bestPartial.extractionMode || "partial_only",
        monthlyLimitPercent: bestPartial.monthlyLimitPercent || "",
        pageSnippet: bestPartial.pageSnippet || ""
      };
    }
    throw new Error("页面已加载，但等待 Codex「每月使用上限」超时。");
  }

  async function completeJob(tab, mode, usage) {
    const monthlyLimitPercent = String(usage?.monthlyLimitPercent || "").trim();
    const creditBalance = String(usage?.creditBalance ?? "").trim();
    const message = [
      monthlyLimitPercent ? `每月使用上限剩余 ${monthlyLimitPercent}` : "未读到每月使用上限",
      creditBalance !== "" ? `剩余额度 ${creditBalance}` : ""
    ].filter(Boolean).join("；");
    const status = monthlyLimitPercent ? "success" : "warning";

    await updateJob({
      status,
      phase: "completed",
      progress: 100,
      message,
      mode,
      tabId: tab.id,
      windowId: tab.windowId,
      pageTitle: usage?.title || tab.title || "",
      pageUrl: usage?.url || tab.url || TARGET_URL,
      monthlyLimitPercent,
      monthlyLimitLabel: usage?.monthlyLimitLabel || "",
      progressWidth: usage?.progressWidth || "",
      creditBalance,
      sharedNote: usage?.sharedNote || "",
      pageSnippet: usage?.pageSnippet || "",
      extractionMode: usage?.extractionMode || "",
      usageCapturedAt: nowIso(),
      completedAt: nowIso(),
      error: ""
    }, createLog(`${message}。`, status));

    return { monthlyLimitPercent, creditBalance };
  }

  async function runJob(payload, refresh = false) {
    const current = await readJob();
    const jobId = payload?.jobId || current?.id || `button18-${Date.now()}`;
    const requestedWindowId = Number(payload?.windowId ?? current?.windowId);
    const refreshTabId = Number(payload?.tabId ?? current?.tabId);

    await replaceJob({
      ...(refresh ? current || {} : {}),
      id: jobId,
      status: "running",
      phase: "queued",
      progress: 5,
      message: refresh ? "Codex 用量刷新任务已启动。" : "Codex 用量读取任务已启动。",
      targetUrl: TARGET_URL,
      requestedAt: payload?.requestedAt || nowIso(),
      startedAt: nowIso(),
      windowId: Number.isInteger(requestedWindowId) ? requestedWindowId : null,
      tabId: refresh && Number.isInteger(refreshTabId) ? refreshTabId : null,
      mode: refresh ? "refresh" : "new_tab",
      monthlyLimitPercent: "",
      monthlyLimitLabel: "",
      progressWidth: "",
      creditBalance: "",
      sharedNote: "",
      pageSnippet: "",
      extractionMode: "",
      error: "",
      logs: [createLog(refresh ? "按钮18用量刷新任务已启动。" : "按钮18 Codex 用量任务已启动。")]
    });

    try {
      let tab;
      if (refresh) {
        if (!Number.isInteger(refreshTabId)) {
          throw new Error("按钮18用量页面标签页不存在。");
        }
        tab = await chrome.tabs.get(refreshTabId);
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await updateJob(
          { phase: "refreshing_page", progress: 30, message: "正在无缓存刷新用量页面..." },
          createLog("开始无缓存刷新 Codex 用量页面。")
        );
        if (isTargetUrl(tab.url)) {
          tab = await reloadTargetPageNoCache(tab.id);
        } else {
          await chrome.tabs.update(tab.id, { url: TARGET_URL, active: true });
          tab = await waitForTargetPage(tab.id);
        }
      } else {
        await updateJob(
          { phase: "creating_tab", progress: 15, message: "正在新建标签页..." },
          createLog("正在新建并激活 Codex 用量标签页。")
        );
        const createOptions = { url: "about:blank", active: true };
        if (Number.isInteger(requestedWindowId)) {
          createOptions.windowId = requestedWindowId;
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
          progress: 30,
          message: "正在打开 Codex 用量页面..."
        }, createLog(`标签页 ${tab.id} 已创建，准备跳转用量页面。`));
        await delay(80);
        await chrome.tabs.update(tab.id, { url: TARGET_URL, active: true });
        tab = await waitForTargetPage(tab.id);
      }

      await updateJob(
        { phase: "waiting_usage", progress: 65, message: "页面已加载，正在等待用量信息..." },
        createLog("Codex 用量页面加载完成，等待数据渲染。")
      );
      const usage = await captureUsage(tab.id);
      await updateJob(
        { phase: "reading_usage", progress: 88, message: "已定位用量卡片，正在整理结果..." },
        createLog(`已通过 ${usage.extractionMode || "页面"} 定位用量信息。`)
      );
      await completeJob(tab, refresh ? "refresh" : "new_tab", usage);
      return { ok: true, jobId, tabId: tab.id, usage };
    } catch (error) {
      await updateJob({
        status: "error",
        phase: "failed",
        progress: 100,
        message: error.message || String(error),
        error: error.message || String(error),
        completedAt: nowIso()
      }, createLog(error.message || String(error), "error"));
      throw error;
    }
  }

  function dispatchButton18Job(messageType, payload = {}) {
    if (activeJobPromise) {
      return Promise.resolve({ ok: false, error: "按钮18用量任务正在运行。" });
    }
    const jobPromise = runJob(payload, messageType === "BUTTON18_REFRESH");
    activeJobPromise = jobPromise;
    return jobPromise
      .catch((error) => ({ ok: false, error: error.message || String(error) }))
      .finally(() => {
        if (activeJobPromise === jobPromise) {
          activeJobPromise = null;
        }
      });
  }

  globalThis.__CRX_BUTTON18_WORKER__ = Object.freeze({
    start: (payload = {}) => dispatchButton18Job("BUTTON18_START", payload),
    refresh: (payload = {}) => dispatchButton18Job("BUTTON18_REFRESH", payload),
    isBusy: () => Boolean(activeJobPromise)
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BUTTON18_GET_JOB") {
      readJob().then((job) => sendResponse({ ok: true, job }));
      return true;
    }
    if (message?.type !== "BUTTON18_START" && message?.type !== "BUTTON18_REFRESH") {
      return false;
    }
    void dispatchButton18Job(message.type, message.payload || {}).then(sendResponse);
    return true;
  });
})();
