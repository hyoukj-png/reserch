#!/usr/bin/env node
/*
 * Runtime browser analysis pass.
 *
 * This complements scripts/analyze_site.py by executing the site in Chromium,
 * capturing screenshots, network signals, and click-triggered UI states.
 */

const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { chromium } = require("playwright");
const { buildArtifacts } = require("./tokenize");

const MAX_STYLE_SAMPLES = 4000;

const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MAX_CLICKS = 14;
const BASE_DIR = path.resolve(__dirname, "..");
const OUTPUT_BASE = path.join(BASE_DIR, "output");

function usage() {
  console.log(`Usage: node scripts/browser_analyze_site.js <url> [options]

Options:
  --site-name <name>       Output folder name. Defaults to URL-derived name.
  --max-pages <n>          Max pages to inspect. Default: ${DEFAULT_MAX_PAGES}
  --max-clicks <n>         Max interactive elements to click per page. Default: ${DEFAULT_MAX_CLICKS}
  --no-mobile              Skip mobile screenshots.
  --no-clicks              Skip click-state exploration.
`);
}

function parseArgs(argv) {
  const args = {
    url: "",
    siteName: "",
    maxPages: DEFAULT_MAX_PAGES,
    maxClicks: DEFAULT_MAX_CLICKS,
    mobile: true,
    clicks: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (!args.url && !item.startsWith("--")) {
      args.url = item;
    } else if (item === "--site-name") {
      args.siteName = argv[++i] || "";
    } else if (item === "--max-pages") {
      args.maxPages = Number(argv[++i] || DEFAULT_MAX_PAGES);
    } else if (item === "--max-clicks") {
      args.maxClicks = Number(argv[++i] || DEFAULT_MAX_CLICKS);
    } else if (item === "--no-mobile") {
      args.mobile = false;
    } else if (item === "--no-clicks") {
      args.clicks = false;
    } else if (item === "--help" || item === "-h") {
      usage();
      process.exit(0);
    }
  }

  if (!args.url) {
    usage();
    process.exit(1);
  }
  if (!/^https?:\/\//i.test(args.url)) {
    args.url = `https://${args.url}`;
  }
  if (!args.siteName) {
    args.siteName = getSiteName(args.url);
  }
  args.maxPages = Number.isFinite(args.maxPages) && args.maxPages > 0 ? args.maxPages : DEFAULT_MAX_PAGES;
  args.maxClicks = Number.isFinite(args.maxClicks) && args.maxClicks >= 0 ? args.maxClicks : DEFAULT_MAX_CLICKS;
  return args;
}

function getSiteName(url) {
  return url.replace(/^https?:\/\//i, "").replace(/[/.]/g, "_").slice(0, 30).replace(/^_+|_+$/g, "");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(input, fallback = "page") {
  const parsed = new URL(input);
  const raw = `${parsed.pathname || "/"}${parsed.search || ""}`;
  const slug = raw
    .replace(/^\/$/, "home")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
  return slug || fallback;
}

function loadPages(outputDir, baseUrl, maxPages) {
  const pagesJson = path.join(outputDir, "pages.json");
  if (fs.existsSync(pagesJson)) {
    try {
      const data = JSON.parse(fs.readFileSync(pagesJson, "utf8"));
      const pages = (data.pages || [])
        .map((page) => page.url)
        .filter(Boolean)
        .slice(0, maxPages);
      if (pages.length) return pages;
    } catch (error) {
      console.warn(`pages.json 읽기 실패, URL 단일 분석으로 진행: ${error.message}`);
    }
  }
  return [baseUrl];
}

async function gotoStable(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
}

async function collectPageSignals(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0.05 &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);

    const selectorOf = (el) => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
      if (testId) return `[data-testid="${CSS.escape(testId)}"], [data-test="${CSS.escape(testId)}"]`;
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        const classes = [...node.classList].filter(Boolean).slice(0, 2);
        if (classes.length) part += `.${classes.map((cls) => CSS.escape(cls)).join(".")}`;
        const parent = node.parentElement;
        if (parent) {
          const sameTag = [...parent.children].filter((child) => child.tagName === node.tagName);
          if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(" > ");
    };

    const interactiveSelector = [
      "button",
      "a[href]",
      "[role='button']",
      "[role='tab']",
      "[aria-controls]",
      "[aria-expanded]",
      "[onclick]",
      "[data-toggle]",
      "[data-bs-toggle]",
      "[data-target]",
      "[data-bs-target]",
      ".swiper-button-next",
      ".swiper-button-prev",
      ".slick-next",
      ".slick-prev",
    ].join(",");

    const clickables = [...document.querySelectorAll(interactiveSelector)]
      .filter(visible)
      .map((el, index) => ({
        index,
        selector: selectorOf(el),
        tag: el.tagName.toLowerCase(),
        text: textOf(el),
        href: el.getAttribute("href") || "",
        role: el.getAttribute("role") || "",
        ariaExpanded: el.getAttribute("aria-expanded") || "",
        ariaControls: el.getAttribute("aria-controls") || "",
        onclick: el.getAttribute("onclick") || "",
      }))
      .filter((item) => {
        const href = item.href.toLowerCase();
        if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
        if (href.endsWith(".pdf") || href.endsWith(".zip")) return false;
        return item.text || item.onclick || item.role || item.ariaControls || href.startsWith("#") || href.startsWith("javascript:");
      });

    const dialogs = [...document.querySelectorAll([
      "dialog",
      "[role='dialog']",
      "[aria-modal='true']",
      ".modal",
      ".popup",
      ".layer",
      ".layer-pop",
      ".layer_popup",
      ".modals",
      ".modal-wrap",
      ".modal_pop",
    ].join(","))]
      .filter(visible)
      .map((el) => ({
        selector: selectorOf(el),
        text: textOf(el),
        className: el.className || "",
        id: el.id || "",
      }));

    const forms = [...document.forms].map((form) => ({
      action: form.getAttribute("action") || "",
      method: (form.getAttribute("method") || "GET").toUpperCase(),
      fields: [...form.querySelectorAll("input, textarea, select")].map((field) => ({
        tag: field.tagName.toLowerCase(),
        type: field.getAttribute("type") || "",
        name: field.getAttribute("name") || "",
        placeholder: field.getAttribute("placeholder") || "",
      })),
    }));

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scrollHeight: document.documentElement.scrollHeight,
      bodyClass: document.body.className || "",
      clickables,
      dialogs,
      forms,
      storage: {
        localStorage: Object.keys(localStorage || {}).slice(0, 30),
        sessionStorage: Object.keys(sessionStorage || {}).slice(0, 30),
      },
    };
  });
}

async function collectComputedStyles(page, cap) {
  return page.evaluate((maxSamples) => {
    const INTERACTIVE_TAGS = new Set(["A", "BUTTON"]);
    const INTERACTIVE_CLASS_RE = /\b(btn|button|cta|primary|action|link)\b/i;
    const isInteractive = (el) => {
      if (INTERACTIVE_TAGS.has(el.tagName)) return true;
      const role = el.getAttribute("role") || "";
      if (["button", "link", "menuitem", "tab"].includes(role)) return true;
      return INTERACTIVE_CLASS_RE.test(el.className || "");
    };
    const visible = (el, st, rect) =>
      st.visibility !== "hidden" && st.display !== "none" &&
      Number(st.opacity || "1") > 0.05 && rect.width > 0 && rect.height > 0;

    const all = document.querySelectorAll("*");
    const step = Math.max(1, Math.floor(all.length / maxSamples));
    const out = [];
    for (let i = 0; i < all.length && out.length < maxSamples; i += step) {
      const el = all[i];
      let st, rect;
      try { st = getComputedStyle(el); rect = el.getBoundingClientRect(); } catch (_) { continue; }
      if (!visible(el, st, rect)) continue;
      out.push({
        interactive: isInteractive(el),
        color: st.color,
        backgroundColor: st.backgroundColor,
        borderColor: st.borderTopColor,
        backgroundImage: st.backgroundImage && st.backgroundImage !== "none" ? st.backgroundImage.slice(0, 200) : "",
        fontFamily: st.fontFamily,
        fontWeight: st.fontWeight,
        fontSize: st.fontSize,
        lineHeight: st.lineHeight,
        letterSpacing: st.letterSpacing,
        paddingTop: st.paddingTop, paddingRight: st.paddingRight,
        paddingBottom: st.paddingBottom, paddingLeft: st.paddingLeft,
        marginTop: st.marginTop, marginBottom: st.marginBottom,
        gap: st.gap || st.columnGap || "",
        borderRadius: st.borderRadius,
        boxShadow: st.boxShadow && st.boxShadow !== "none" ? st.boxShadow.slice(0, 240) : "",
        transitionDuration: st.transitionDuration,
        transitionTimingFunction: st.transitionTimingFunction,
        animationDuration: st.animationDuration,
        animationName: st.animationName,
        animationTimingFunction: st.animationTimingFunction,
      });
    }
    return out;
  }, cap);
}

function changedEnough(before, after) {
  if (before.url !== after.url) return true;
  if (before.bodyClass !== after.bodyClass) return true;
  if ((before.dialogs || []).length !== (after.dialogs || []).length) return true;
  const beforeExpanded = (before.clickables || []).filter((item) => item.ariaExpanded === "true").length;
  const afterExpanded = (after.clickables || []).filter((item) => item.ariaExpanded === "true").length;
  return beforeExpanded !== afterExpanded;
}

async function exploreClicks(context, url, initialSignals, pageDir, maxClicks) {
  const results = [];
  const candidates = (initialSignals.clickables || []).slice(0, maxClicks);

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (["error", "warning"].includes(msg.type())) {
        consoleErrors.push(`${msg.type()}: ${msg.text()}`.slice(0, 300));
      }
    });

    try {
      await gotoStable(page, url);
      const before = await collectPageSignals(page);
      const locator = page.locator(candidate.selector).first();
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
      await locator.click({ timeout: 5000, trial: false }).catch(async () => {
        await locator.click({ timeout: 5000, force: true });
      });
      await page.waitForTimeout(700);
      const after = await collectPageSignals(page);
      const changed = changedEnough(before, after);
      let screenshot = "";
      if (changed) {
        screenshot = path.join(pageDir, `state-${String(i + 1).padStart(2, "0")}.png`);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      }
      results.push({
        candidate,
        changed,
        afterUrl: after.url,
        bodyClass: after.bodyClass,
        visibleDialogs: after.dialogs,
        consoleErrors,
        screenshot: screenshot ? path.relative(path.dirname(pageDir), screenshot).split(path.sep).join("/") : "",
      });
    } catch (error) {
      results.push({
        candidate,
        changed: false,
        error: error.message,
        consoleErrors,
      });
    } finally {
      await page.close().catch(() => {});
    }
  }

  return results;
}

function summarizeRequests(requests) {
  const byType = {};
  const thirdParty = new Set();
  for (const req of requests) {
    byType[req.resourceType] = (byType[req.resourceType] || 0) + 1;
    if (req.thirdParty) thirdParty.add(req.host);
  }
  return { byType, thirdParty: [...thirdParty].sort().slice(0, 40) };
}

function markdownReport({ baseUrl, pages, generatedAt }) {
  const lines = [
    "# 런타임 브라우저 분석",
    "",
    `**분석 대상:** ${baseUrl}`,
    `**분석 일시:** ${generatedAt}`,
    `**분석 페이지:** ${pages.length}개`,
    "",
    "> 이 파일은 Playwright Chromium에서 실제 JS를 실행한 뒤 수집한 동적 상태입니다. 정적 HTML 분석이 놓치는 모달, 탭, 모바일 메뉴, 클릭 후 DOM 변화를 확인하는 보조 근거로 사용하세요.",
    "",
    "## 페이지별 요약",
    "",
    "| # | URL | 클릭 후보 | 변화 감지 | 모달/다이얼로그 | 콘솔 오류 |",
    "|---|-----|----------|----------|----------------|-----------|",
  ];

  pages.forEach((page, index) => {
    const changed = page.clickStates.filter((item) => item.changed).length;
    const dialogs = page.initial.dialogs.length + page.clickStates.reduce((sum, item) => sum + (item.visibleDialogs || []).length, 0);
    const consoleErrors = page.consoleErrors.length + page.clickStates.reduce((sum, item) => sum + (item.consoleErrors || []).length, 0);
    lines.push(`| ${index + 1} | ${page.url} | ${page.initial.clickables.length} | ${changed} | ${dialogs} | ${consoleErrors} |`);
  });

  for (const page of pages) {
    lines.push("");
    lines.push(`## ${page.initial.title || page.url}`);
    lines.push("");
    lines.push(`**URL:** ${page.url}`);
    lines.push(`**PC 스크린샷:** \`${page.screenshots.pc || ""}\``);
    if (page.screenshots.mobile) lines.push(`**Mobile 스크린샷:** \`${page.screenshots.mobile}\``);
    lines.push(`**스크롤 높이:** ${page.initial.scrollHeight}px`);
    lines.push(`**네트워크:** ${JSON.stringify(page.network.byType)}`);
    if (page.network.thirdParty.length) {
      lines.push(`**외부 호스트:** ${page.network.thirdParty.join(", ")}`);
    }
    if (page.initial.forms.length) {
      lines.push("");
      lines.push("### Forms");
      for (const form of page.initial.forms.slice(0, 8)) {
        lines.push(`- \`${form.method}\` ${form.action || "(no action)"} — ${form.fields.length}개 필드`);
      }
    }
    const changedStates = page.clickStates.filter((item) => item.changed);
    if (changedStates.length) {
      lines.push("");
      lines.push("### 클릭 후 변화");
      for (const state of changedStates.slice(0, 10)) {
        const label = state.candidate.text || state.candidate.onclick || state.candidate.selector;
        lines.push(`- "${label}" → URL: ${state.afterUrl}`);
        if (state.visibleDialogs && state.visibleDialogs.length) {
          lines.push(`  - visible dialog: ${state.visibleDialogs.map((dialog) => dialog.text || dialog.selector).join(" / ")}`);
        }
        if (state.screenshot) {
          lines.push(`  - screenshot: \`${state.screenshot}\``);
        }
      }
    }
    if (page.consoleErrors.length) {
      lines.push("");
      lines.push("### Console Errors");
      for (const error of page.consoleErrors.slice(0, 10)) {
        lines.push(`- ${error}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function inspectPage(browser, url, outputDir, options) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  const baseHost = new URL(options.baseUrl).host;
  const pageSlug = safeName(url);
  const stateDir = path.join(outputDir, "runtime", pageSlug);
  ensureDir(stateDir);

  page.on("requestfinished", async (request) => {
    try {
      const reqUrl = new URL(request.url());
      requests.push({
        url: request.url(),
        host: reqUrl.host,
        thirdParty: reqUrl.host !== baseHost,
        method: request.method(),
        resourceType: request.resourceType(),
      });
    } catch (_) {}
  });
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleErrors.push(`${msg.type()}: ${msg.text()}`.slice(0, 300));
    }
  });

  const screenshots = {
    pc: path.join("screenshots", "pc", `${pageSlug}.png`),
    mobile: "",
  };

  await gotoStable(page, url);
  await page.screenshot({ path: path.join(outputDir, screenshots.pc), fullPage: true });
  const initial = await collectPageSignals(page);
  const styleSamples = await collectComputedStyles(page, MAX_STYLE_SAMPLES).catch(() => []);
  const clickStates = options.clicks
    ? await exploreClicks(context, url, initial, stateDir, options.maxClicks)
    : [];

  await page.close().catch(() => {});
  await context.close().catch(() => {});

  if (options.mobile) {
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const mobilePage = await mobileContext.newPage();
    screenshots.mobile = path.join("screenshots", "mobile", `${pageSlug}.png`);
    await gotoStable(mobilePage, url);
    await mobilePage.screenshot({ path: path.join(outputDir, screenshots.mobile), fullPage: true });
    await mobileContext.close().catch(() => {});
  }

  return {
    url,
    initial,
    screenshots,
    network: summarizeRequests(requests),
    consoleErrors,
    clickStates,
    styleSamples,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const outputDir = path.join(OUTPUT_BASE, args.siteName);
  ensureDir(path.join(outputDir, "runtime"));
  ensureDir(path.join(outputDir, "screenshots", "pc"));
  ensureDir(path.join(outputDir, "screenshots", "mobile"));

  const pages = loadPages(outputDir, args.url, args.maxPages);
  const generatedAt = new Date().toISOString();

  console.log("=".repeat(60));
  console.log("Runtime browser analysis");
  console.log(`Target: ${args.url}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Pages: ${pages.length}`);
  console.log("=".repeat(60));

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const pageUrl of pages) {
      console.log(`Inspecting ${pageUrl}`);
      try {
        results.push(await inspectPage(browser, pageUrl, outputDir, {
          baseUrl: args.url,
          mobile: args.mobile,
          clicks: args.clicks,
          maxClicks: args.maxClicks,
        }));
      } catch (error) {
        console.warn(`  failed: ${error.message}`);
        results.push({ url: pageUrl, error: error.message, initial: { title: "", clickables: [], dialogs: [], forms: [] }, screenshots: {}, network: { byType: {}, thirdParty: [] }, consoleErrors: [], clickStates: [], styleSamples: [] });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // 토큰화: 페이지별 computedStyle 샘플을 합쳐 구조화 토큰 산출물 생성
  const allSamples = [];
  for (const r of results) {
    if (Array.isArray(r.styleSamples)) allSamples.push(...r.styleSamples);
    delete r.styleSamples; // runtime-analysis.json 비대화 방지
  }

  const data = {
    generated_at: generatedAt,
    base_url: args.url,
    max_pages: args.maxPages,
    max_clicks: args.maxClicks,
    pages: results,
  };

  fs.writeFileSync(path.join(outputDir, "runtime", "runtime-analysis.json"), JSON.stringify(data, null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "09-runtime-interactions.md"), markdownReport({
    baseUrl: args.url,
    pages: results,
    generatedAt,
  }), "utf8");

  console.log("Saved runtime/runtime-analysis.json");
  console.log("Saved 09-runtime-interactions.md");

  if (allSamples.length) {
    try {
      const { tokens, files } = buildArtifacts(allSamples, args.url);
      const tokensDir = path.join(outputDir, "tokens");
      ensureDir(tokensDir);
      for (const [name, content] of Object.entries(files)) {
        // 한국어 리포트는 output 루트로, 기계가독 토큰은 tokens/ 하위로
        const dest = name.endsWith(".md")
          ? path.join(outputDir, name)
          : path.join(tokensDir, name);
        fs.writeFileSync(dest, content, "utf8");
      }
      console.log(`Tokenized ${allSamples.length} style samples → score ${tokens.score.grade} (${tokens.score.overall}/100)`);
      console.log("Saved tokens/{raw,dtcg}.json, tokens/tokens.tailwind.js, tokens/tokens.css, 10-design-tokens-structured.md");
    } catch (error) {
      console.warn(`tokenize 실패(스킵): ${error.message}`);
    }
  } else {
    console.warn("computedStyle 샘플 없음 — 토큰화 스킵");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
