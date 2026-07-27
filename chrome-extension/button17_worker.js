(() => {
  const JOB_STORAGE_KEY = "button17.job";
  const TARGET_URL = "https://chatgpt.com/?promo_campaign=plus-1-month-free#pricing";
  const SESSION_TARGET_URL = "https://chatgpt.com/api/auth/session";
  const CHECKOUT_TARGET_URL = "https://chatgpt.com/backend-api/payments/checkout";
  const STRIPE_API_BASE_URL = "https://api.stripe.com/v1/payment_pages/";
  const PAY_OPENAI_BASE_URL = "https://pay.openai.com/c/pay/";
  const PAGE_TIMEOUT_MS = 30000;
  const PRICING_WAIT_MS = 20000;
  const NO_PLUS_SETTLE_MS = 5000;
  const SESSION_REQUEST_TIMEOUT_MS = 20000;
  const MOMO_REQUEST_TIMEOUT_MS = 20000;
  const RECOVERY_MAX_ATTEMPTS = 2;
  const RECOVERY_SETTLE_MS = 800;
  const MAX_CARD_TEXT_LENGTH = 12000;
  const MAX_JOB_LOGS = 100;
  let activeJobPromise = null;
  let activeRecoveryPromise = null;
  let activeAtPromise = null;
  let activeMomoPromise = null;
  let queuedRecoverySignal = null;

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
      return url.origin === "https://chatgpt.com"
        && url.searchParams.get("promo_campaign") === "plus-1-month-free";
    } catch (_error) {
      return false;
    }
  }

  function isZeroPrice(value) {
    const numericText = String(value || "").match(/[\d.,]+/)?.[0] || "";
    const digits = numericText.replace(/\D/g, "");
    return Boolean(digits) && /^0+$/.test(digits);
  }

  function isVndCurrency(...parts) {
    const text = parts.map((part) => String(part || "")).join(" ");
    if (/\bVND\b/i.test(text) || /₫/.test(text) || /越南盾/.test(text)) {
      return true;
    }
    // 仅出现其它明确币种时视为非 VND
    if (/\b(?:USD|JPY|EUR|GBP|CNY|KRW|THB|IDR|PHP|MYR|SGD|AUD|CAD|HKD|TWD|INR)\b/i.test(text)
      || /[¥$€£₹₩]/.test(text)) {
      return false;
    }
    return false;
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

    throw new Error(`等待 ChatGPT 定价页面超时，最后地址：${lastUrl || "未知"}`);
  }

  function reloadTargetPageNoCache(tabId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(
        () => finish(new Error("无缓存刷新 ChatGPT 定价页面超时。")),
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

  function extractPlusPricingPageData(maxCardTextLength) {
    const normalizeText = (value) => String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
    const textOf = (element) => normalizeText(element?.innerText || element?.textContent || "");
    const firstMatch = (values, pattern) => values.find((value) => pattern.test(value)) || "";
    const stripPriceLabel = (value) => normalizeText(value)
      .replace(/^(?:原价|折扣价|优惠价|当前价|original\s+price|discount(?:ed)?\s+price|current\s+price)\s*[:：]?\s*/i, "");
    const isCurrentPlanCta = (value) => /你当前的套餐|当前套餐|your\s+current\s+plan|current\s+plan/i.test(String(value || ""));
    const readPlanCta = (column, planType) => {
      const button = column?.querySelector(`[data-testid="select-plan-button-${planType}-upgrade"]`)
        || column?.querySelector(`[data-testid^="select-plan-button-${planType}"]`)
        || column?.querySelector("button");
      const text = textOf(button);
      const disabled = Boolean(
        button?.disabled
        || button?.getAttribute("disabled") != null
        || button?.getAttribute("data-visually-disabled") != null
        || button?.getAttribute("aria-disabled") === "true"
      );
      return {
        text,
        disabled,
        isCurrent: isCurrentPlanCta(text)
      };
    };
    const readVisiblePlans = () => Array.from(document.querySelectorAll("[data-pricing-plan-type]"))
      .map((marker) => {
        const planType = String(marker.getAttribute("data-pricing-plan-type") || "").trim().toLowerCase();
        const column = marker.closest("[data-pricing-column-content]") || marker.parentElement;
        const heading = column?.querySelector("[data-pricing-column-plan-heading]");
        const cost = column?.querySelector(`[data-testid="${planType}-pricing-column-cost"]`)
          || column?.querySelector('[data-testid$="-pricing-column-cost"]');
        const accessiblePrice = Array.from(cost?.querySelectorAll(".sr-only, [class~='sr-only']") || [])
          .map(textOf)
          .find(Boolean) || "";
        const billingPeriod = Array.from(cost?.querySelectorAll("p") || [])
          .map(textOf)
          .filter(Boolean)
          .join(" ");
        const cta = readPlanCta(column, planType);
        return {
          type: planType,
          name: textOf(heading?.querySelector("span") || heading) || planType,
          price: stripPriceLabel(accessiblePrice),
          currency: billingPeriod.match(/\b[A-Z]{3}\b/)?.[0] || "",
          billingPeriod,
          badge: textOf(column?.querySelector('[data-testid="pricing-column-badge"]')),
          ctaText: cta.text,
          isCurrentPlan: cta.isCurrent
        };
      })
      .filter((plan) => plan.type || plan.name);

    const planMarker = document.querySelector('[data-pricing-plan-type="plus"]');
    const plusColumn = document.querySelector('[data-testid="plus-pricing-modal-column"]')
      || planMarker?.closest('[data-pricing-column-content]')
      || planMarker?.parentElement;
    const costBlock = plusColumn?.querySelector('[data-testid="plus-pricing-column-cost"]')
      || document.querySelector('[data-testid="plus-pricing-column-cost"]');

    if (!plusColumn || !costBlock) {
      const pageText = textOf(document.body);
      const plusIndex = pageText.search(/(?:^|\n)Plus(?:\n|$)/i);
      const afterPlus = plusIndex >= 0 ? pageText.slice(plusIndex) : "";
      const nextPlanIndex = afterPlus.search(/\n(?:Pro|Business|Team|Enterprise)\n/i);
      const fallbackText = nextPlanIndex > 0 ? afterPlus.slice(0, nextPlanIndex) : afterPlus.slice(0, maxCardTextLength);
      const prices = fallbackText.match(/(?:[A-Z]{3}\s*)?[\u20ab$€£¥₹₩]\s*[\d.,]+|[A-Z]{3}\s*[\d.,]+/g) || [];
      const hasPromotion = /首月|优惠|offer|free|折扣|discount/i.test(fallbackText);
      const originalPrice = hasPromotion && prices.length > 1 ? stripPriceLabel(prices[0]) : "";
      const currentPrice = stripPriceLabel(hasPromotion && prices.length > 1 ? prices[1] : prices[0] || "");
      const billingPeriod = firstMatch(
        fallbackText.split("\n").map(normalizeText).filter(Boolean),
        /(?:\/\s*(?:月|month)|首月|monthly|per month|截至|until)/i
      );
      const fallbackFound = Boolean(fallbackText && prices.length);
      const pricingGrid = document.querySelector('[data-testid="pricing-modal-plan-grid"]');
      const seeAllPlansButton = document.querySelector('[data-testid="see-all-plans-button-container"] button');
      const availablePlans = readVisiblePlans();
      const plusCta = readPlanCta(
        document.querySelector('[data-testid="plus-pricing-modal-column"]'),
        "plus"
      );
      const alreadyOnPlus = plusCta.isCurrent
        || availablePlans.some((plan) => plan.type === "plus" && plan.isCurrentPlan)
        || isCurrentPlanCta(fallbackText);

      return {
        found: fallbackFound || alreadyOnPlus,
        plusAvailable: fallbackFound || alreadyOnPlus,
        alreadyOnPlus,
        currentPlanCta: plusCta.text || (alreadyOnPlus ? "你当前的套餐" : ""),
        pricingReady: Boolean(pricingGrid),
        canExpandPlans: Boolean(seeAllPlansButton),
        availablePlans,
        extractionMode: fallbackFound ? "text_fallback" : alreadyOnPlus ? "text_fallback_current_plus" : "pricing_dom_no_plus",
        planName: "Plus",
        currentPrice,
        originalPrice: originalPrice && originalPrice !== currentPrice ? originalPrice : "",
        currency: billingPeriod.match(/\b[A-Z]{3}\b/)?.[0] || "",
        billingPeriod,
        promotion: firstMatch(fallbackText.split("\n"), /优惠|offer|free|折扣|discount/i),
        terms: firstMatch(fallbackText.split("\n"), /恢复为每月|优惠价格适用|renews|then\s+.*month|截至/i),
        cardText: (fallbackFound || alreadyOnPlus ? fallbackText : textOf(pricingGrid)).slice(0, maxCardTextLength),
        title: document.title || "",
        url: window.location.href
      };
    }

    const accessiblePrices = Array.from(costBlock.querySelectorAll(".sr-only, [class~='sr-only']"))
      .map(textOf)
      .filter(Boolean);
    const originalLabeled = firstMatch(accessiblePrices, /原价|original\s+price/i);
    const currentLabeled = firstMatch(accessiblePrices, /折扣价|优惠价|当前价|discount(?:ed)?\s+price|current\s+price/i);
    const lineThroughPrice = textOf(costBlock.querySelector(".line-through, [class*='line-through']"));
    const priceCandidates = accessiblePrices.map(stripPriceLabel).filter(Boolean);
    const originalPrice = stripPriceLabel(originalLabeled || lineThroughPrice);
    let currentPrice = stripPriceLabel(currentLabeled);

    if (!currentPrice) {
      currentPrice = priceCandidates.find((price) => price !== originalPrice) || priceCandidates[0] || "";
    }

    const billingLines = Array.from(costBlock.querySelectorAll("p"))
      .map(textOf)
      .filter(Boolean);
    const billingPeriod = billingLines.join(" ");
    const promotion = textOf(plusColumn.querySelector('[data-testid="pricing-column-badge"]'));
    const termsLink = plusColumn.querySelector('a[href*="promotions-referrals"]');
    const terms = textOf(termsLink?.parentElement || plusColumn.querySelector("[type='highlight']"));
    const planName = textOf(
      plusColumn.querySelector('[data-pricing-column-plan-heading] span')
      || plusColumn.querySelector('[data-pricing-column-plan-heading]')
    ) || "Plus";
    const currency = billingPeriod.match(/\b[A-Z]{3}\b/)?.[0]
      || `${currentPrice} ${originalPrice}`.match(/\b[A-Z]{3}\b/)?.[0]
      || "";
    const cardText = textOf(plusColumn);
    const plusCta = readPlanCta(plusColumn, "plus");
    const alreadyOnPlus = plusCta.isCurrent;

    return {
      found: Boolean(currentPrice || originalPrice || alreadyOnPlus),
      plusAvailable: true,
      alreadyOnPlus,
      currentPlanCta: plusCta.text,
      pricingReady: true,
      canExpandPlans: false,
      availablePlans: readVisiblePlans(),
      extractionMode: alreadyOnPlus ? "pricing_dom_current_plus" : "pricing_dom",
      planName,
      currentPrice: currentPrice || originalPrice,
      originalPrice: originalPrice && originalPrice !== currentPrice ? originalPrice : "",
      currency,
      billingPeriod,
      promotion,
      terms,
      cardText: cardText.slice(0, maxCardTextLength),
      title: document.title || "",
      url: window.location.href
    };
  }

  function clickSeeAllPlansButton() {
    const button = document.querySelector('[data-testid="see-all-plans-button-container"] button');
    if (!button) {
      return { clicked: false, text: "" };
    }
    const text = String(button.innerText || button.textContent || "").trim();
    button.click();
    return { clicked: true, text };
  }

  async function capturePricing(tabId) {
    const startedAt = Date.now();
    let result = null;
    let expandedPlans = false;
    let noPlusReadyAt = 0;

    do {
      const execution = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPlusPricingPageData,
        args: [MAX_CARD_TEXT_LENGTH]
      });
      result = execution?.[0]?.result || null;
      if (result?.found) {
        return result;
      }
      if (result?.canExpandPlans && !expandedPlans) {
        const clickResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: clickSeeAllPlansButton
        });
        const clicked = clickResult?.[0]?.result;
        expandedPlans = Boolean(clicked?.clicked);
        if (expandedPlans) {
          await updateJob(
            { phase: "expanding_plans", progress: 74, message: "当前未展示 Plus，正在展开全部套餐..." },
            createLog(`已点击“${clicked.text || "查看全部套餐"}”，继续查找 Plus 卡片。`)
          );
          noPlusReadyAt = 0;
          await delay(800);
          continue;
        }
      }
      if (result?.pricingReady) {
        noPlusReadyAt ||= Date.now();
        if (Date.now() - noPlusReadyAt >= NO_PLUS_SETTLE_MS) {
          return {
            ...result,
            found: false,
            plusAvailable: false,
            plansExpanded: expandedPlans
          };
        }
      }
      await delay(500);
    } while (Date.now() - startedAt <= PRICING_WAIT_MS);

    if (result?.pricingReady) {
      return {
        ...result,
        found: false,
        plusAvailable: false,
        plansExpanded: expandedPlans
      };
    }
    throw new Error("页面已加载，但等待 Plus 套餐价格卡超时。");
  }

  async function completeJob(tab, mode, pricing) {
    if (pricing?.plusAvailable === false) {
      const availablePlans = Array.isArray(pricing.availablePlans) ? pricing.availablePlans : [];
      const plansSummary = availablePlans
        .map((plan) => [plan.name, plan.price, plan.billingPeriod].filter(Boolean).join(" "))
        .join("；") || "未识别到可见套餐";
      await updateJob({
        status: "warning",
        phase: "completed",
        progress: 100,
        message: `当前页面未展示 Plus。可见套餐：${plansSummary}`,
        mode,
        tabId: tab.id,
        windowId: tab.windowId,
        pageTitle: pricing?.title || tab.title || "",
        pageUrl: pricing?.url || tab.url || TARGET_URL,
        planName: "Plus",
        plusAvailable: false,
        alreadyOnPlus: false,
        currentPlanCta: "",
        plusPriceZero: false,
        currencyIsVnd: false,
        currentPrice: "",
        originalPrice: "",
        currency: "",
        billingPeriod: "",
        promotion: "",
        terms: "",
        availablePlans,
        plansExpanded: Boolean(pricing.plansExpanded),
        cardText: pricing?.cardText || "",
        extractionMode: pricing?.extractionMode || "pricing_dom_no_plus",
        priceCapturedAt: nowIso(),
        completedAt: nowIso(),
        error: ""
      }, createLog(`Plus 当前未展示；可见套餐：${plansSummary}。`, "warning"));
      return { plusPriceZero: false, alreadyOnPlus: false, currencyIsVnd: false };
    }

    const currentPrice = String(pricing?.currentPrice || "").trim();
    const originalPrice = String(pricing?.originalPrice || "").trim();
    const currency = String(pricing?.currency || "").trim();
    const billingPeriod = String(pricing?.billingPeriod || "").trim();
    const alreadyOnPlus = Boolean(pricing?.alreadyOnPlus);
    // 已订阅 Plus 时页面常显示 ¥0/优惠价，不能当作可试用 0 元
    const plusPriceZero = alreadyOnPlus ? false : isZeroPrice(currentPrice);
    const currencyIsVnd = isVndCurrency(currency, billingPeriod, currentPrice, originalPrice, pricing?.cardText);
    const priceSummary = originalPrice
      ? `${currentPrice}（原价 ${originalPrice}）`
      : currentPrice;
    let message = alreadyOnPlus
      ? `账号已是 Plus 套餐（${pricing?.currentPlanCta || "你当前的套餐"}）${priceSummary ? `；页面价：${priceSummary}` : ""}`
      : `Plus 套餐价格读取完成：${priceSummary}`;
    if (!alreadyOnPlus && plusPriceZero && !currencyIsVnd) {
      message = `${message}；币种非 VND（${currency || billingPeriod || "未知"}），禁止 AT/MoMo 检测`;
    } else if (!alreadyOnPlus && plusPriceZero && currencyIsVnd) {
      message = `${message}；币种 VND，将自动提取 AT 并检测支付通道`;
    }
    const logLevel = alreadyOnPlus || (!currencyIsVnd && plusPriceZero) ? "warning" : "success";

    await updateJob({
      status: alreadyOnPlus || (plusPriceZero && !currencyIsVnd) ? "warning" : "success",
      phase: "completed",
      progress: 100,
      message,
      mode,
      tabId: tab.id,
      windowId: tab.windowId,
      pageTitle: pricing?.title || tab.title || "",
      pageUrl: pricing?.url || tab.url || TARGET_URL,
      planName: pricing?.planName || "Plus",
      plusAvailable: true,
      alreadyOnPlus,
      currentPlanCta: pricing?.currentPlanCta || "",
      plusPriceZero,
      currencyIsVnd,
      currentPrice,
      originalPrice,
      currency,
      billingPeriod,
      promotion: pricing?.promotion || "",
      terms: pricing?.terms || "",
      availablePlans: pricing?.availablePlans || [],
      cardText: pricing?.cardText || "",
      extractionMode: pricing?.extractionMode || "",
      priceCapturedAt: nowIso(),
      completedAt: nowIso(),
      error: ""
    }, createLog(`${message}。`, logLevel));

    return { plusPriceZero, alreadyOnPlus, currencyIsVnd };
  }

  async function waitForButton17Idle(timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (!activeJobPromise && !activeRecoveryPromise && !activeAtPromise && !activeMomoPromise) {
        return true;
      }
      await delay(50);
    }
    return !activeJobPromise && !activeRecoveryPromise && !activeAtPromise && !activeMomoPromise;
  }

  async function autoProbeAfterZeroVnd(trigger = "zero_price_auto") {
    // 等价格任务释放锁，避免 activeJobPromise 挡住 AT/MoMo
    await waitForButton17Idle();
    const job = await readJob();
    if (!job?.plusAvailable || !job?.plusPriceZero || !job?.currencyIsVnd || job?.alreadyOnPlus) {
      return { ok: false, skipped: true, reason: "not_zero_vnd" };
    }
    const atResult = await dispatchAccessTokenFetch(trigger);
    if (!atResult?.ok) {
      return atResult;
    }
    await waitForButton17Idle();
    const latest = await readJob();
    if (!latest?.currencyIsVnd || !latest?.plusPriceZero || latest?.alreadyOnPlus || !latest?.accountAccessToken) {
      return atResult;
    }
    return dispatchMomoCheck();
  }

  async function fetchCurrentAccountAccessToken(trigger = "manual") {
    const current = await readJob();
    if (!current?.plusAvailable || !current?.plusPriceZero) {
      throw new Error("仅 Plus 当前价格为 0 时可提取当前账号 AT。");
    }
    if (!current?.currencyIsVnd) {
      throw new Error(`当前币种非 VND（${current?.currency || current?.billingPeriod || "未知"}），禁止提取 AT。`);
    }
    if (current?.alreadyOnPlus) {
      throw new Error("账号已是 Plus 套餐，禁止提取 AT。");
    }

    await updateJob({
      accountAccessToken: "",
      accountEmail: "",
      accountAtStatus: "loading",
      accountAtTrigger: trigger,
      accountAtFetchedAt: "",
      accountAtError: "",
      momoStatus: "idle",
      momoMessage: "",
      momoDecision: "",
      momoHasChannel: null,
      momoMethods: [],
      momoOneClickEligible: null,
      momoActualTrial: null,
      momoOfferApplied: null,
      momoOfferEvidence: "",
      momoCheckoutSuffix: "",
      momoStripeMode: "",
      momoCurrency: "",
      momoAmountDue: null,
      momoError: "",
      momoStartedAt: "",
      momoCheckedAt: ""
    }, createLog(`${trigger === "zero_price_auto" ? "检测到 Plus 价格为 0，自动" : "手动"} GET Session 并提取当前账号 AT。`));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SESSION_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(SESSION_TARGET_URL, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Session GET HTTP ${response.status}：${responseText.slice(0, 200)}`);
      }

      let session;
      try {
        session = JSON.parse(responseText);
      } catch (error) {
        throw new Error(`Session GET 返回内容不是有效 JSON：${error.message || String(error)}`);
      }

      const accessToken = typeof session?.accessToken === "string" ? session.accessToken.trim() : "";
      if (!accessToken) {
        throw new Error("Session GET 响应中未发现 accessToken。");
      }

      const userEmail = typeof session?.user?.email === "string" ? session.user.email.trim() : "";
      const fetchedAt = nowIso();
      await updateJob({
        accountAccessToken: accessToken,
        accountEmail: userEmail,
        accountAtStatus: "success",
        accountAtFetchedAt: fetchedAt,
        accountAtError: ""
      }, createLog(`当前账号 AT 已提取${userEmail ? `：${userEmail}` : ""}。`, "success"));

      return {
        ok: true,
        accessToken,
        userEmail,
        fetchedAt
      };
    } catch (error) {
      const message = error?.name === "AbortError"
        ? `Session GET 请求超时（${SESSION_REQUEST_TIMEOUT_MS}ms）。`
        : error.message || String(error);
      await updateJob({
        accountAtStatus: "error",
        accountAtError: message
      }, createLog(message, "error"));
      throw new Error(message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function dispatchAccessTokenFetch(trigger = "manual") {
    if (activeAtPromise) {
      return Promise.resolve({ ok: false, error: "当前账号 AT 正在提取。" });
    }

    const atPromise = fetchCurrentAccountAccessToken(trigger);
    activeAtPromise = atPromise;
    return atPromise.finally(() => {
      if (activeAtPromise === atPromise) {
        activeAtPromise = null;
      }
    });
  }

  function checkoutBody() {
    // 对齐 20260727A HAR / 20260727b 脚本：带 promo，不强制 trial_period_days
    return {
      entry_point: "all_plans_pricing_modal",
      plan_name: "chatgptplusplan",
      billing_details: {
        country: "VN",
        currency: "VND"
      },
      promo_campaign: {
        promo_campaign_id: "plus-1-month-free",
        is_coupon_from_query_param: false
      }
    };
  }

  function parseJwtPayload(accessToken) {
    try {
      const parts = String(accessToken || "").split(".");
      if (parts.length !== 3) {
        return null;
      }
      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch (_error) {
      return null;
    }
  }

  function isFreePlanFromToken(accessToken) {
    const payload = parseJwtPayload(accessToken);
    const auth = payload?.["https://api.openai.com/auth"] || {};
    const plan = String(auth.chatgpt_plan_type || auth.plan_type || "").trim().toLowerCase();
    return {
      plan: plan || "unknown",
      email: String(payload?.["https://api.openai.com/profile"]?.email || "").trim(),
      isFree: !plan || plan === "free" || plan === "chatgptfreeplan" || plan === "freeplan"
    };
  }

  async function fetchTextWithTimeout(url, options, timeoutMs = MOMO_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}：${text.slice(0, 200)}`);
      }
      return text;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`请求超时（${timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function parseJsonText(text, label) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${label} 返回内容不是有效 JSON：${error.message || String(error)}`);
    }
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  function findStripePublishableKey(payload) {
    const direct = firstString(
      payload?.stripe_publishable_key,
      payload?.publishable_key,
      payload?.publishableKey,
      payload?.stripePublishableKey,
      payload?.key
    );
    const match = `${direct}\n${JSON.stringify(payload || {})}`.match(/pk_(?:live|test)_[A-Za-z0-9]+/);
    return match?.[0] || "";
  }

  function trialMarker(payload, nestedKey = "") {
    const candidates = [payload];
    if (nestedKey && payload?.[nestedKey] && typeof payload[nestedKey] === "object") {
      candidates.push(payload[nestedKey]);
    }
    return candidates.some((candidate) => {
      const subscription = candidate?.subscription_data;
      const trialDays = subscription?.trial_period_days ?? candidate?.trial_period_days;
      const trialEnd = subscription?.trial_end ?? candidate?.trial_end;
      return Number(trialDays || 0) > 0 || Boolean(trialEnd);
    });
  }

  function extractPaymentMethods(payload) {
    const topLevel = payload?.payment_method_types;
    const nested = payload?.elements_options?.payment_method_types;
    const ordered = payload?.ordered_payment_method_types;
    const methods = Array.isArray(topLevel)
      ? topLevel
      : Array.isArray(nested)
        ? nested
        : Array.isArray(ordered)
          ? ordered
          : null;
    return methods
      ? [...new Set(methods.map((method) => String(method).toLowerCase()).filter(Boolean))].sort()
      : null;
  }

  function stripeField(payload, key) {
    return payload?.elements_options?.[key] ?? payload?.[key] ?? null;
  }

  function stripeAmountDue(payload) {
    const value = payload?.total_summary?.due
      ?? payload?.amount_total
      ?? stripeField(payload, "amount")
      ?? payload?.invoice?.amount_due;
    return value == null ? null : Number(value) || 0;
  }

  async function resolveStripePublishableKey(checkout, checkoutId) {
    const fromCheckout = findStripePublishableKey(checkout);
    if (fromCheckout) {
      return fromCheckout;
    }
    const pageText = await fetchTextWithTimeout(`${PAY_OPENAI_BASE_URL}${encodeURIComponent(checkoutId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "text/html" }
    });
    const match = pageText.match(/pk_(?:live|test)_[A-Za-z0-9]+/);
    if (!match) {
      throw new Error("Checkout 响应和支付页面均未返回 Stripe publishable key。");
    }
    return match[0];
  }

  async function checkMomoPaymentChannel() {
    const current = await readJob();
    const accessToken = String(current?.accountAccessToken || "").trim();
    if (!current?.plusAvailable || !current?.plusPriceZero || !accessToken) {
      throw new Error("请先完成零价 Plus 检测和当前账号 AT 提取。");
    }
    if (!current?.currencyIsVnd) {
      throw new Error(`当前币种非 VND（${current?.currency || current?.billingPeriod || "未知"}），禁止检测支付通道。`);
    }
    if (current?.alreadyOnPlus) {
      throw new Error("账号已是 Plus 套餐，跳过 Checkout / MoMo 检测。");
    }

    const planInfo = isFreePlanFromToken(accessToken);
    if (!planInfo.isFree) {
      const message = `JWT 套餐为 ${planInfo.plan}，仅 free 才继续 Checkout。`;
      await updateJob({
        momoStatus: "warning",
        momoMessage: message,
        momoDecision: "skip_non_free",
        momoHasChannel: null,
        momoMethods: [],
        momoError: message,
        momoCheckedAt: nowIso()
      }, createLog(message, "warning"));
      return { ok: false, decision: "skip_non_free", methods: [], plan: planInfo.plan };
    }

    await updateJob({
      momoStatus: "running",
      momoMessage: "正在创建未确认 Checkout（HAR 对齐 body）...",
      momoDecision: "",
      momoHasChannel: null,
      momoMethods: [],
      momoOneClickEligible: null,
      momoActualTrial: null,
      momoOfferApplied: null,
      momoOfferEvidence: "",
      momoCheckoutSuffix: "",
      momoStripeMode: "",
      momoCurrency: "",
      momoAmountDue: null,
      momoError: "",
      momoStartedAt: nowIso(),
      momoCheckedAt: "",
      accountPlanFromJwt: planInfo.plan,
      accountEmail: current.accountEmail || planInfo.email || ""
    }, createLog(`JWT plan=${planInfo.plan}，开始 VN/VND + promo Checkout 并检测支付通道。`));

    try {
      const checkoutText = await fetchTextWithTimeout(CHECKOUT_TARGET_URL, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Origin: "https://chatgpt.com",
          Referer: "https://chatgpt.com/?promo_campaign=plus-1-month-free",
          "oai-language": "zh-CN",
          "OAI-Device-Id": crypto.randomUUID(),
          "x-openai-target-path": "/backend-api/payments/checkout",
          "x-openai-target-route": "/backend-api/payments/checkout"
        },
        body: JSON.stringify(checkoutBody())
      });
      const checkout = parseJsonText(checkoutText, "Checkout");
      const checkoutId = firstString(checkout?.checkout_session_id, checkout?.session_id, checkout?.id);
      if (!checkoutId.startsWith("cs_")) {
        throw new Error("Checkout 响应缺少有效的 Session ID。");
      }

      const oneClickEligible = checkout?.one_click_trial_eligible;
      const isNewStripeCustomer = checkout?.is_new_stripe_customer;
      const trialInCheckout = trialMarker(checkout, "checkout_session");

      await updateJob({
        momoMessage: "Checkout 已创建，正在读取 Stripe 支付通道...",
        momoCheckoutSuffix: checkoutId.slice(-8),
        momoOneClickEligible: oneClickEligible ?? null
      }, createLog(
        `Checkout 已创建（eligible=${oneClickEligible}, new_customer=${isNewStripeCustomer}），开始 Stripe init。`
      ));

      const stripeKey = await resolveStripePublishableKey(checkout, checkoutId);
      // 对齐 HAR 的 payment_pages/.../init 表单
      const form = new URLSearchParams();
      form.set("browser_locale", "zh-CN");
      form.set("browser_timezone", "Asia/Shanghai");
      form.set("elements_session_client[client_betas][0]", "custom_checkout_server_updates_1");
      form.set("elements_session_client[client_betas][1]", "custom_checkout_manual_approval_1");
      form.set("elements_session_client[elements_init_source]", "custom_checkout");
      form.set("elements_session_client[referrer_host]", "chatgpt.com");
      form.set("elements_session_client[stripe_js_id]", crypto.randomUUID());
      form.set("elements_session_client[locale]", "zh-CN");
      form.set("elements_session_client[is_aggregation_expected]", "false");
      form.set("elements_options_client[saved_payment_method][enable_save]", "auto");
      form.set("elements_options_client[saved_payment_method][enable_redisplay]", "auto");
      form.set("key", stripeKey);
      form.set(
        "_stripe_version",
        "2025-03-31.basil; checkout_server_update_beta=v1; checkout_manual_approval_preview=v1"
      );

      const initText = await fetchTextWithTimeout(`${STRIPE_API_BASE_URL}${encodeURIComponent(checkoutId)}/init`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://js.stripe.com",
          Referer: "https://js.stripe.com/"
        },
        body: form.toString()
      });
      const init = parseJsonText(initText, "Stripe init");
      const methods = extractPaymentMethods(init);
      const hasMomo = methods ? methods.includes("momo") : null;
      const actualTrial = trialInCheckout || trialMarker(init, "elements_options");
      const stripeMode = stripeField(init, "mode");
      const amountDue = stripeAmountDue(init);
      const zeroAmountDue = amountDue === 0;
      // amount_due=0 可能是 promo 折扣，不等于真 trial
      const offerEvidence = actualTrial
        ? "trial_marker"
        : zeroAmountDue
          ? "promo_or_amount_due_zero"
          : "not_confirmed";
      const offerApplied = actualTrial || zeroAmountDue;
      const decision = stripeMode && stripeMode !== "subscription"
        ? "unexpected_mode"
        : hasMomo == null
          ? "payment_methods_unknown"
          : hasMomo
            ? actualTrial
              ? "ready"
              : zeroAmountDue
                ? "momo_with_promo_zero"
                : "momo_ready_offer_unconfirmed"
            : "momo_not_enabled";
      const methodsText = methods?.join(", ") || "无";
      const message = decision === "ready"
        ? `已检测到 MoMo，且存在 trial 标记：${methodsText}`
        : decision === "momo_with_promo_zero"
          ? `已检测到 MoMo；amount_due=0（可能是 promo，非 trial）：${methodsText}`
          : decision === "momo_ready_offer_unconfirmed"
            ? `已检测到 MoMo，但未确认 0 元/trial：${methodsText}`
            : decision === "momo_not_enabled"
              ? `当前 Checkout 未启用 MoMo：${methodsText}`
              : decision === "unexpected_mode"
                ? `Stripe Session 模式异常：${stripeMode || "未知"}`
                : "Stripe init 未返回明确的支付方式列表。";
      const status = ["ready", "momo_with_promo_zero", "momo_ready_offer_unconfirmed"].includes(decision)
        ? "success"
        : "warning";
      const checkedAt = nowIso();
      await updateJob({
        momoStatus: status,
        momoMessage: message,
        momoDecision: decision,
        momoHasChannel: hasMomo,
        momoMethods: methods || [],
        momoOneClickEligible: oneClickEligible ?? null,
        momoIsNewStripeCustomer: isNewStripeCustomer ?? null,
        momoActualTrial: actualTrial,
        momoOfferApplied: offerApplied,
        momoOfferEvidence: offerEvidence,
        momoStripeMode: stripeMode || "",
        momoCurrency: stripeField(init, "currency") || "",
        momoAmountDue: amountDue,
        momoCheckedAt: checkedAt,
        momoError: ""
      }, createLog(message, status));
      return { ok: true, hasMomo, decision, methods: methods || [], checkedAt };
    } catch (error) {
      const message = error.message || String(error);
      await updateJob({
        momoStatus: "error",
        momoMessage: message,
        momoDecision: "check_failed",
        momoError: message,
        momoCheckedAt: nowIso()
      }, createLog(`MoMo 支付通道检测失败：${message}`, "error"));
      throw new Error(message);
    }
  }

  function dispatchMomoCheck() {
    if (activeJobPromise || activeRecoveryPromise || activeAtPromise || activeMomoPromise) {
      return Promise.resolve({ ok: false, error: "按钮17任务正在运行。" });
    }
    const momoPromise = checkMomoPaymentChannel();
    activeMomoPromise = momoPromise;
    return momoPromise.finally(() => {
      if (activeMomoPromise === momoPromise) {
        activeMomoPromise = null;
      }
    });
  }

  async function runNavigationRecovery(source, details = {}) {
    const tabId = Number(details.tabId);
    const signalUrl = String(details.url || "");
    if (!Number.isInteger(tabId) || !isTargetUrl(signalUrl)) {
      return { ok: false, ignored: true, reason: "not_target_page" };
    }

    const current = await readJob();
    if (!current || Number(current.tabId) !== tabId) {
      return { ok: false, ignored: true, reason: "not_current_job_tab" };
    }
    if (current.status !== "error" || current.phase !== "failed") {
      return { ok: false, ignored: true, reason: "job_not_waiting_recovery" };
    }

    const previousAttempts = Math.max(0, Number(current.recoveryAttempt) || 0);
    if (previousAttempts >= RECOVERY_MAX_ATTEMPTS) {
      return { ok: false, ignored: true, reason: "recovery_exhausted" };
    }

    const attempt = previousAttempts + 1;
    await updateJob({
      status: "running",
      phase: "rechecking_pricing",
      progress: 70,
      message: `页面已成功返回定价页，正在进行第 ${attempt} 次价格补查...`,
      recoveryStatus: "running",
      recoveryAttempt: attempt,
      recoveryTrigger: source,
      recoverySignalAt: nowIso(),
      recoveryStartedAt: nowIso(),
      recoveryError: "",
      error: ""
    }, createLog(`收到 ${source} 成功跳转信号，开始第 ${attempt} 次价格补查。`));

    try {
      let tab = await chrome.tabs.get(tabId);
      if (!isTargetUrl(tab?.url)) {
        throw new Error(`补查时标签页已离开定价页：${tab?.url || "未知"}`);
      }
      if (tab.status !== "complete") {
        tab = await waitForTargetPage(tabId);
      }

      await delay(RECOVERY_SETTLE_MS);
      const pricing = await capturePricing(tabId);
      await updateJob({
        phase: "reading_pricing",
        progress: 90,
        message: `第 ${attempt} 次补查已定位价格，正在整理结果...`
      }, createLog(`第 ${attempt} 次补查已通过 ${pricing.extractionMode || "页面"} 定位价格。`));
      const completion = await completeJob(tab, "navigation_recovery", pricing);
      await updateJob({
        recoveryStatus: "completed",
        recoveryCompletedAt: nowIso(),
        recoveryError: ""
      }, createLog(`第 ${attempt} 次价格补查完成。`, "success"));
      if (completion.plusPriceZero && completion.currencyIsVnd && !completion.alreadyOnPlus) {
        void autoProbeAfterZeroVnd("zero_price_auto").catch(() => {});
      }
      return { ok: true, recovered: true, attempt, tabId, pricing };
    } catch (error) {
      const message = error.message || String(error);
      const exhausted = attempt >= RECOVERY_MAX_ATTEMPTS;
      await updateJob({
        status: "error",
        phase: "failed",
        progress: 100,
        message: exhausted
          ? `价格补查已达到 ${RECOVERY_MAX_ATTEMPTS} 次：${message}`
          : `第 ${attempt} 次价格补查失败，等待下一次页面成功信号：${message}`,
        recoveryStatus: exhausted ? "exhausted" : "waiting_navigation",
        recoveryError: message,
        error: message,
        completedAt: nowIso()
      }, createLog(`第 ${attempt} 次价格补查失败：${message}`, "error"));
      return { ok: false, recovered: false, attempt, exhausted, error: message };
    }
  }

  function dispatchNavigationRecovery(source, details = {}) {
    if (activeRecoveryPromise) {
      queuedRecoverySignal = { source, details };
      return Promise.resolve({ ok: false, queued: true, reason: "recovery_busy" });
    }
    if (activeJobPromise || activeAtPromise || activeMomoPromise) {
      return Promise.resolve({ ok: false, ignored: true, reason: "button17_busy" });
    }

    const recoveryPromise = runNavigationRecovery(source, details);
    activeRecoveryPromise = recoveryPromise;
    return recoveryPromise.finally(() => {
      if (activeRecoveryPromise === recoveryPromise) {
        activeRecoveryPromise = null;
      }
      const queued = queuedRecoverySignal;
      queuedRecoverySignal = null;
      if (queued) {
        void dispatchNavigationRecovery(queued.source, queued.details);
      }
    });
  }

  async function runJob(payload, refresh = false) {
    const current = await readJob();
    const jobId = payload?.jobId || current?.id || `button17-${Date.now()}`;
    const requestedWindowId = Number(payload?.windowId ?? current?.windowId);
    const refreshTabId = Number(payload?.tabId ?? current?.tabId);

    await replaceJob({
      ...(refresh ? current || {} : {}),
      id: jobId,
      status: "running",
      phase: "queued",
      progress: 5,
      message: refresh ? "价格刷新任务已启动。" : "Plus 价格读取任务已启动。",
      targetUrl: TARGET_URL,
      requestedAt: payload?.requestedAt || nowIso(),
      startedAt: nowIso(),
      windowId: Number.isInteger(requestedWindowId) ? requestedWindowId : null,
      tabId: refresh && Number.isInteger(refreshTabId) ? refreshTabId : null,
      mode: refresh ? "refresh" : "new_tab",
      plusAvailable: null,
      alreadyOnPlus: false,
      currentPlanCta: "",
      plusPriceZero: false,
      currencyIsVnd: false,
      accountAccessToken: "",
      accountEmail: "",
      accountAtStatus: "idle",
      accountAtTrigger: "",
      accountAtFetchedAt: "",
      accountAtError: "",
      momoStatus: "idle",
      momoMessage: "",
      momoDecision: "",
      momoHasChannel: null,
      momoMethods: [],
      momoError: "",
      momoStartedAt: "",
      momoCheckedAt: "",
      recoveryStatus: "idle",
      recoveryAttempt: 0,
      recoveryTrigger: "",
      recoverySignalAt: "",
      recoveryStartedAt: "",
      recoveryCompletedAt: "",
      recoveryError: "",
      error: "",
      logs: [createLog(refresh ? "按钮17价格刷新任务已启动。" : "按钮17 Plus 价格任务已启动。")]
    });

    try {
      let tab;
      if (refresh) {
        if (!Number.isInteger(refreshTabId)) {
          throw new Error("按钮17定价页面标签页不存在。");
        }
        tab = await chrome.tabs.get(refreshTabId);
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await updateJob(
          { phase: "refreshing_page", progress: 30, message: "正在无缓存刷新定价页面..." },
          createLog("开始无缓存刷新 ChatGPT 定价页面。")
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
          createLog("正在新建并激活 ChatGPT 定价标签页。")
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
          message: "正在打开 ChatGPT Plus 定价页面..."
        }, createLog(`标签页 ${tab.id} 已创建，准备跳转定价页面。`));
        await delay(80);
        await chrome.tabs.update(tab.id, { url: TARGET_URL, active: true });
        tab = await waitForTargetPage(tab.id);
      }

      await updateJob(
        { phase: "waiting_pricing", progress: 65, message: "页面已加载，正在等待 Plus 价格卡..." },
        createLog("ChatGPT 页面加载完成，等待 Plus 定价卡动态渲染。")
      );
      const pricing = await capturePricing(tab.id);
      await updateJob(
        { phase: "reading_pricing", progress: 88, message: "已定位 Plus 卡片，正在整理价格..." },
        createLog(`已通过 ${pricing.extractionMode || "页面"} 定位 Plus 价格。`)
      );
      const completion = await completeJob(tab, refresh ? "refresh" : "new_tab", pricing);
      if (completion.plusPriceZero && completion.currencyIsVnd && !completion.alreadyOnPlus) {
        void autoProbeAfterZeroVnd("zero_price_auto").catch(() => {});
      }
      return { ok: true, jobId, tabId: tab.id, pricing };
    } catch (error) {
      const currentJob = await readJob();
      const canRecover = Number.isInteger(currentJob?.tabId);
      await updateJob({
        status: "error",
        phase: "failed",
        message: canRecover
          ? `${error.message || String(error)}；等待页面成功返回定价页后自动补查。`
          : error.message || String(error),
        error: error.message || String(error),
        recoveryStatus: canRecover ? "waiting_navigation" : "unavailable",
        completedAt: nowIso()
      }, createLog(error.message || String(error), "error"));
      throw error;
    }
  }

  function dispatchButton17Job(messageType, payload = {}) {
    if (activeJobPromise || activeRecoveryPromise || activeMomoPromise) {
      return Promise.resolve({ ok: false, error: "按钮17价格任务正在运行。" });
    }

    const jobPromise = runJob(payload, messageType === "BUTTON17_REFRESH");
    activeJobPromise = jobPromise;
    return jobPromise
      .catch((error) => ({ ok: false, error: error.message || String(error) }))
      .finally(() => {
        if (activeJobPromise === jobPromise) {
          activeJobPromise = null;
        }
      });
  }

  globalThis.__CRX_BUTTON17_WORKER__ = Object.freeze({
    start: (payload = {}) => dispatchButton17Job("BUTTON17_START", payload),
    refresh: (payload = {}) => dispatchButton17Job("BUTTON17_REFRESH", payload),
    fetchCurrentAt: () => dispatchAccessTokenFetch("manual"),
    checkMomo: () => dispatchMomoCheck(),
    handleNavigationSignal: (source, details = {}) => dispatchNavigationRecovery(source, details),
    isBusy: () => Boolean(activeJobPromise || activeRecoveryPromise || activeAtPromise || activeMomoPromise)
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BUTTON17_GET_JOB") {
      readJob().then((job) => sendResponse({ ok: true, job }));
      return true;
    }
    if (message?.type === "BUTTON17_FETCH_CURRENT_AT") {
      if (activeJobPromise || activeRecoveryPromise || activeAtPromise || activeMomoPromise) {
        sendResponse({ ok: false, error: "按钮17任务正在运行。" });
        return true;
      }
      dispatchAccessTokenFetch("manual")
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }
    if (message?.type === "BUTTON17_CHECK_MOMO") {
      if (activeJobPromise || activeRecoveryPromise || activeAtPromise || activeMomoPromise) {
        sendResponse({ ok: false, error: "按钮17任务正在运行。" });
        return true;
      }
      dispatchMomoCheck()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }
    if (message?.type !== "BUTTON17_START" && message?.type !== "BUTTON17_REFRESH") {
      return false;
    }
    if (activeRecoveryPromise || activeAtPromise || activeMomoPromise) {
      sendResponse({ ok: false, error: activeRecoveryPromise
        ? "按钮17正在进行价格补查。"
        : activeAtPromise
          ? "当前账号 AT 正在提取。"
          : "MoMo 支付通道正在检测。" });
      return true;
    }
    void dispatchButton17Job(message.type, message.payload || {}).then(sendResponse);
    return true;
  });
})();
