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

const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MAX_CLICKS = 24;
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
      // 정규화 중복 제거 — pages.json에 /path 와 /path/ 가 함께 있으면 페이지 예산(maxPages)이 중복으로 소진돼
      // 뒤쪽의 실제 다른 페이지가 수집에서 밀려난다.
      const seen = new Set();
      const pages = [];
      for (const page of data.pages || []) {
        if (!page.url) continue;
        const norm = page.url.replace(/\/+$/, "").toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        pages.push(page.url);
        if (pages.length >= maxPages) break;
      }
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
        dataToggle: el.getAttribute("data-toggle") || el.getAttribute("data-bs-toggle") || "",
        dataTarget: el.getAttribute("data-target") || el.getAttribute("data-bs-target") || "",
      }))
      .filter((item) => {
        const href = item.href.toLowerCase();
        if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
        if (href.endsWith(".pdf") || href.endsWith(".zip")) return false;
        return item.text || item.onclick || item.role || item.ariaControls || href.startsWith("#") || href.startsWith("javascript:");
      });

    const longTextOf = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

    // 모달/레이어 전수 수집 — visible 필터를 걸기 전에 DOM에 존재하는 모든 모달 후보를 잡는다.
    // display:none 상태의 숨김 모달을 초기 인벤토리에서 놓치면(과거 "모달 0개" 오탐) 트리거 미클릭 시 완전 누락되므로,
    // 숨김 모달은 본문 전문 + 트리거 역매핑까지 실측해 hiddenDialogs로 보존한다.
    const allDialogEls = [...document.querySelectorAll([
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
      "[id*='modal']",
      "[id*='popup']",
      "[id*='layer']",
      "[class*='modal']",
      "[class*='popup']",
    ].join(","))]
      .filter((el, _, arr) => !arr.some((other) => other !== el && other.contains(el)))
      .filter((el) => longTextOf(el).length > 10);

    const dialogs = allDialogEls
      .filter(visible)
      .map((el) => ({
        selector: selectorOf(el),
        text: longTextOf(el).slice(0, 300),
        className: el.className || "",
        id: el.id || "",
      }));

    const hiddenDialogs = allDialogEls
      .filter((el) => !visible(el))
      .slice(0, 30)
      .map((el) => {
        const id = el.id || "";
        const mainClass = [...el.classList].find((cls) => /modal|popup|layer|pop/i.test(cls)) || el.classList[0] || "";
        let triggers = [];
        if (id) {
          triggers = [...document.querySelectorAll(
            `[aria-controls="${CSS.escape(id)}"],[data-target="#${CSS.escape(id)}"],[data-bs-target="#${CSS.escape(id)}"],a[href="#${CSS.escape(id)}"]`
          )];
        }
        const needle = id || mainClass;
        if (needle && !triggers.length) {
          [...document.querySelectorAll("[onclick],a[href^='javascript:']")].forEach((t) => {
            const code = `${t.getAttribute("onclick") || ""} ${t.getAttribute("href") || ""}`;
            if (code.includes(needle) && !el.contains(t)) triggers.push(t);
          });
        }
        return {
          selector: selectorOf(el),
          id,
          className: (el.className || "").toString().slice(0, 60),
          textLength: longTextOf(el).length,
          text: longTextOf(el).slice(0, 500),
          triggers: triggers.filter(visible).slice(0, 3).map((t) => ({ selector: selectorOf(t), text: textOf(t) })),
        };
      });

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

    // 디자인 런타임 실측 — computed 폰트/타입스케일/팔레트/라이브러리 스코프/모션 설정.
    // 정적 크롤러가 못 보는 "실제 렌더된" 값. 분석가의 폰트·라이브러리 판정 1차 정답 소스.
    const designSignals = (() => {
      const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
      const out = {};
      // 폰트(실측)
      out.fonts = safe(() => {
        const usage = {};
        document.querySelectorAll("p,span,h1,h2,h3,h4,h5,li,a,div,td,th,button").forEach((el) => {
          if ((el.textContent || "").trim().length > 2) {
            const f = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
            usage[f] = (usage[f] || 0) + 1;
          }
        });
        return {
          bodyComputed: getComputedStyle(document.body).fontFamily,
          usageTop: Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 8),
          faceFamilies: [...document.fonts].map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i).slice(0, 30),
        };
      }, null);
      // 타입 스케일(실측)
      out.typeScale = safe(() => {
        const sizes = {};
        document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,a,li,div,button").forEach((el) => {
          if ((el.textContent || "").trim().length > 2) {
            const fs = parseInt(getComputedStyle(el).fontSize, 10);
            if (fs) sizes[fs] = (sizes[fs] || 0) + 1;
          }
        });
        const headings = {};
        ["h1", "h2", "h3", "h4"].forEach((t) => {
          const el = document.querySelector(t);
          if (el) { const s = getComputedStyle(el); headings[t] = { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing, fontFamily: s.fontFamily.split(",")[0].replace(/["']/g, "") }; }
        });
        const fz = {};
        document.querySelectorAll('[class*="fz"]').forEach((el) => {
          ((el.className || "").toString().match(/fz\d+/g) || []).forEach((c) => { if (!fz[c]) fz[c] = getComputedStyle(el).fontSize; });
        });
        return { sizeFrequency: Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 14), headings, fzUtilities: fz };
      }, null);
      // 팔레트(실측)
      out.palette = safe(() => {
        const text = {}, bg = {};
        document.querySelectorAll("h1,h2,h3,h4,strong,b,em,button,a,p,span").forEach((el) => { const c = getComputedStyle(el).color; if (c) text[c] = (text[c] || 0) + 1; });
        document.querySelectorAll("section,div,header,footer,main,article").forEach((el) => { const b = getComputedStyle(el).backgroundColor; if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") bg[b] = (bg[b] || 0) + 1; });
        return { bodyBg: getComputedStyle(document.body).backgroundColor, textColors: Object.entries(text).sort((a, b) => b[1] - a[1]).slice(0, 8), bgColors: Object.entries(bg).sort((a, b) => b[1] - a[1]).slice(0, 8) };
      }, null);
      // 애니메이션 라이브러리 로드 스코프(페이지별)
      out.libs = safe(() => ({
        gsap: window.gsap ? (window.gsap.version || true) : false,
        ScrollTrigger: !!window.ScrollTrigger, AOS: !!window.AOS, Swiper: !!window.Swiper,
        Rellax: !!window.Rellax, anime: !!window.anime, scrollMonitor: !!window.scrollMonitor, Vimeo: !!window.Vimeo,
      }), null);
      // GSAP ScrollTrigger 설정
      out.scrollTrigger = safe(() => (window.ScrollTrigger && window.ScrollTrigger.getAll)
        ? window.ScrollTrigger.getAll().map((t) => ({ trigger: (t.trigger && t.trigger.className ? t.trigger.className.toString() : String(t.trigger)).slice(0, 40), start: t.vars && t.vars.start, end: t.vars && t.vars.end, scrub: t.vars && t.vars.scrub, pin: t.vars && t.vars.pin }))
        : [], []);
      // AOS 속성 집계
      out.aos = safe(() => {
        const els = [...document.querySelectorAll("[data-aos]")]; const types = {}, dur = {};
        els.forEach((e) => { const t = e.getAttribute("data-aos"); if (t) types[t] = (types[t] || 0) + 1; const d = e.getAttribute("data-aos-duration"); if (d) dur[d] = (dur[d] || 0) + 1; });
        return { total: els.length, types, durations: dur, globalDuration: window.aosDuration || null };
      }, null);
      // Swiper 인스턴스 설정
      out.swipers = safe(() => [...document.querySelectorAll(".swiper, .swiper-container")].map((el) => {
        const s = el.swiper; if (!s) return { cls: (el.className || "").toString().slice(0, 30), instantiated: false };
        const ap = s.params.autoplay;
        return { cls: (el.className || "").toString().slice(0, 30), slidesPerView: s.params.slidesPerView, spaceBetween: s.params.spaceBetween, autoplay: ap ? (ap.delay || true) : false, loop: s.params.loop, effect: s.params.effect, speed: s.params.speed };
      }), []);
      // 커스텀 스크롤 리빌 클래스(opacity:0 + transform/transition)
      out.revealRules = safe(() => {
        const found = [];
        for (const ss of document.styleSheets) {
          let rules; try { rules = ss.cssRules; } catch (e) { continue; }
          if (!rules) continue;
          for (const r of rules) {
            if (!r.style) continue;
            const css = r.style.cssText || "";
            if (/opacity:\s*0\b/.test(css) && (/transform:\s*translate|transform:\s*scale/.test(css) || /transition:/.test(css))) {
              found.push({ selector: (r.selectorText || "").slice(0, 60), css: css.slice(0, 200) });
            }
          }
          if (found.length > 20) break;
        }
        return found.slice(0, 20);
      }, []);
      return out;
    })();

    // 가로 풀높이 패널 행(확장 셀렉터/이미지 패널 아코디언) 탐지 —
    // 정적/클릭 분석이 "카드 그리드"로 오판하기 쉬운 패턴. 기하학적 시그니처로 검출.
    const interactionPatterns = (() => {
      const found = [];
      const seen = new Set();
      const headingOf = (el) => {
        let node = el;
        for (let i = 0; i < 4 && node; i++) {
          const h = node.querySelector && node.querySelector('h1,h2,h3,[class*="tit"]');
          if (h && (h.textContent || "").trim()) return (h.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
          node = node.parentElement;
        }
        return "";
      };
      document.querySelectorAll("ul,ol,div,section").forEach((el) => {
        if (found.length > 10) return;
        const kids = [...el.children].filter((child) => child.getBoundingClientRect().width > 40);
        if (kids.length < 4 || kids.length > 6) return;
        const rects = kids.map((child) => child.getBoundingClientRect());
        const tops = rects.map((rect) => rect.top);
        const sameRow = Math.max(...tops) - Math.min(...tops) < 40;
        const tallCount = rects.filter((rect) => rect.height > 280).length;
        const widths = rects.map((rect) => rect.width);
        const avgW = widths.reduce((sum, value) => sum + value, 0) / widths.length;
        const evenWidth = widths.every((value) => Math.abs(value - avgW) < avgW * 0.4) && avgW < 700;
        if (!(sameRow && tallCount >= 4 && evenWidth)) return;
        const key = (el.className || "").toString() + kids.length;
        if (seen.has(key)) return;
        seen.add(key);
        const cs0 = getComputedStyle(kids[0]);
        const trans = cs0.transition || "";
        const expandHint = /\b(width|flex|transform)\b/.test(trans) || cs0.cursor === "pointer" || cs0.flexGrow !== "0";
        found.push({
          type: expandHint ? "가로 확장/셀렉터 패널(hover·click 펼침 추정)" : "가로 풀높이 패널 행(슬라이더/셀렉터 후보)",
          selector: selectorOf(el),
          container: (el.className || "").toString().slice(0, 36) || el.tagName,
          panelCount: kids.length,
          panelWidth: Math.round(avgW),
          panelHeight: Math.round(Math.max(...rects.map((rect) => rect.height))),
          childTransition: trans.slice(0, 50),
          cursor: cs0.cursor,
          flexGrow: cs0.flexGrow,
          heading: headingOf(el),
          panelTitles: kids
            .map((child) => (child.textContent || "").replace(/\s+/g, " ").trim().slice(0, 16))
            .filter(Boolean)
            .slice(0, 6),
        });
      });
      return found;
    })();

    // 자가진단 위젯(예/아니오 토글 설문·카운트업 타이머) 탐지 —
    // <form>/<input> 이 아니라 button 토글·JS 카운터로 구현돼 form 기반 탐지가 놓치는 패턴(afneyeclinic survey=0 오탐 사례).
    // visible 필터를 적용하지 않는다: reveal(opacity:0)·모달 내부(display:none) 위젯도 DOM에 존재하므로 구조 실측이 가능하고,
    // 모달을 클릭으로 열기 전이라도 내부 self-test를 인벤토리하기 위함이다.
    const selfTestWidgets = (() => {
      try {
        const AFFIRM = /^(예|네|yes|y|있다|있음|해당|해당된다|o)$/i;
        const DENY = /^(아니오|아니요|no|n|없다|없음|아님|x)$/i;
        const out = { surveys: [], timers: [] };

        // 1) 토글그룹 설문: 한 컨테이너에 '예/아니오(긍정/부정) 버튼 쌍'이 2개 이상이면 설문으로 판정.
        const pairContainers = [...document.querySelectorAll("*")].filter((el) => {
          const btns = [...el.children].filter((c) => /^(button|a|span|div|label)$/i.test(c.tagName) && (c.textContent || "").trim().length <= 6);
          if (btns.length !== 2) return false;
          const t0 = (btns[0].textContent || "").trim(), t1 = (btns[1].textContent || "").trim();
          return (AFFIRM.test(t0) && DENY.test(t1)) || (DENY.test(t0) && AFFIRM.test(t1));
        });
        const seenSurvey = new Set();
        pairContainers.forEach((pc) => {
          // 토글 쌍이 각자 래퍼(.check-q 등)로 감싸진 경우가 흔하므로, 중간 레벨이 1개여도 멈추지 말고
          // '2개 이상을 포함하는 가장 가까운 공통 조상'에 도달할 때까지 상향한다.
          let root = pc;
          for (let i = 0; i < 12 && root.parentElement; i++) {
            root = root.parentElement;
            const cnt = [...root.querySelectorAll("*")].filter((e) => pairContainers.includes(e)).length;
            if (cnt >= 2) break;
          }
          const key = selectorOf(root);
          if (seenSurvey.has(key)) return;
          const toggles = [...root.querySelectorAll("*")].filter((e) => pairContainers.includes(e));
          if (toggles.length < 2) return;
          seenSurvey.add(key);
          const questions = toggles.map((tg) => {
            const parentTxt = ((tg.parentElement && tg.parentElement.textContent) || "").replace(/\s+/g, " ").trim();
            return parentTxt.replace(/(예|아니오|네|아니요|yes|no)/gi, "").trim().slice(0, 60);
          }).filter(Boolean);
          const resultEl = root.querySelector('[class*="result"], [class*="judge"], [class*="output"]');
          out.surveys.push({
            container: key.slice(0, 50),
            questionCount: toggles.length,
            questions: questions.slice(0, 12),
            display: "동시 노출(전체 문항 표시)",   // 토글 쌍 다수가 동시에 DOM에 존재 = 한 화면 노출
            hasProgressBar: !!root.querySelector('[class*="progress"], [class*="gauge"], [role="progressbar"]'),
            sequential: !!root.querySelector('[class*="step"], [data-step], [class*="next-q"], [class*="slide"]'),
            hasResultEl: !!resultEl,
            resultText: resultEl ? (resultEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100) : "",
          });
        });

        // 2) 카운트업/타이머 위젯: 숫자 카운터 + '시작' 류 트리거 + setInterval 존재.
        // 리스트 번호(li "01","02"…)·표 셀 오탐을 막기 위해: li/dt/dd/th/ol/ul 제외, 선행0 다중자릿수(리스트 인덱스) 제외,
        // 트리거는 3단계 이내 근접 조상에서만 탐색, counter 셀렉터 중복 제거.
        const hasInterval = /setInterval|requestAnimationFrame/.test(document.documentElement.innerHTML);
        const seenTimer = new Set();
        document.querySelectorAll('[class*="count"], [class*="timer"], [class*="num"], [id*="count"], [id*="timer"]').forEach((el) => {
          if (out.timers.length > 6) return;
          if (/^(li|dt|dd|th|ol|ul)$/i.test(el.tagName)) return;
          const txt = (el.textContent || "").trim();
          if (!/^\d{1,3}$/.test(txt) || /^0\d/.test(txt)) return;
          let scope = el;
          for (let i = 0; i < 3 && scope.parentElement; i++) scope = scope.parentElement;
          const trigger = [...scope.querySelectorAll("button, a, span, div")].find((b) => {
            const bt = (b.textContent || "").trim();
            return bt.length <= 8 && /시작|start|측정|begin|go/i.test(bt);
          });
          if (!trigger) return;
          const key = selectorOf(el);
          if (seenTimer.has(key)) return;
          seenTimer.add(key);
          out.timers.push({
            counter: key.slice(0, 50),
            initial: txt,
            trigger: (trigger.textContent || "").trim().slice(0, 12),
            usesInterval: hasInterval,
            context: (scope.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
          });
        });

        return out;
      } catch (e) {
        return { surveys: [], timers: [], error: String(e && e.message || e) };
      }
    })();

    // 섹션별 인터랙션 인벤토리 — page-global 신호(Swiper·AOS·reveal)를 '섹션 단위'로 귀속.
    // 누락/오귀속 방지: Swiper 역할을 클래스명으로 추측(main_view=히어로 식 오판)하지 말고 '어느 섹션에 있는지·슬라이드 몇 장인지'로 확정,
    // AOS·reveal을 섹션별로 집계해 "어느 섹션이 모션 집중인지"(sec03 방향리빌 21개 등)를 보존한다.
    const sectionInteractions = (() => {
      try {
        const all = [...document.querySelectorAll('section,[class*="sec"],[id^="st"],[class*="section"]')]
          .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 120);
        let tops = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
        // 폴백: sec/section 클래스 규약을 안 쓰는 사이트에서 인벤토리가 통째로 비는 것을 방지 —
        // main(없으면 body) 직계 자식 중 충분히 큰 블록을 섹션으로 간주한다.
        if (tops.length < 2) {
          const rootEl = document.querySelector("main") || document.body;
          tops = [...rootEl.children].filter((el) =>
            !/^(HEADER|FOOTER|NAV|SCRIPT|STYLE|LINK)$/.test(el.tagName) &&
            el.getBoundingClientRect().height > 200);
        }
        const headingOf = (el) => {
          const h = el.querySelector('h1,h2,h3,[class*="tit"]');
          return h ? (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30) : "";
        };
        return tops.slice(0, 30).map((el) => {
          const aos = {};
          el.querySelectorAll("[data-aos]").forEach((e) => { const t = e.getAttribute("data-aos"); if (t) aos[t] = (aos[t] || 0) + 1; });
          const swipers = [...el.querySelectorAll(".swiper, .swiper-container")]
            .filter((sw) => { const p = sw.parentElement && sw.parentElement.closest(".swiper, .swiper-container"); return !p; })
            .map((sw) => {
              const s = sw.swiper;
              const realSlides = sw.querySelectorAll(".swiper-slide:not(.swiper-slide-duplicate)").length;
              const cls = (sw.className || "").toString().split(/\s+/).filter((c) => c && !/^swiper/.test(c)).slice(0, 2).join(" ") || "swiper";
              return { cls, slides: realSlides, spv: s ? s.params.slidesPerView : null, effect: s ? s.params.effect : null, autoplay: s && s.params.autoplay ? (s.params.autoplay.delay || true) : false };
            });
          return {
            id: el.id || "",
            cls: (el.className || "").toString().slice(0, 24),
            heading: headingOf(el),
            afxReveal: el.querySelectorAll(".afx-reveal").length,
            afxFade: el.querySelectorAll(".afx-fade").length,
            aos,
            swipers,
            bigSize: el.querySelectorAll(".big_size").length,
            expandPanels: el.querySelectorAll(".sys_con").length,
          };
        });
      } catch (e) { return []; }
    })();

    // 상태 지문 — changedEnough가 url/bodyClass/dialog 수만 보면 탭·아코디언(클래스 토글형 콘텐츠 교체)을
    // "무변화"로 오판하므로, visible 텍스트량·active류 클래스 수·다이얼로그 본문을 함께 비교한다.
    const stateFingerprint = {
      visibleTextLength: (document.body.innerText || "").replace(/\s+/g, "").length,
      activeClassCount: document.querySelectorAll(".active,.on,.open,.show,.current,[aria-selected='true']").length,
      visibleDialogTexts: dialogs.map((d) => d.text.slice(0, 60)).join("|").slice(0, 400),
    };

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scrollHeight: document.documentElement.scrollHeight,
      bodyClass: document.body.className || "",
      clickables,
      dialogs,
      hiddenDialogs,
      stateFingerprint,
      forms,
      designSignals,
      interactionPatterns,
      sectionInteractions,
      selfTestWidgets,
      storage: {
        localStorage: Object.keys(localStorage || {}).slice(0, 30),
        sessionStorage: Object.keys(sessionStorage || {}).slice(0, 30),
      },
    };
  });
}

// 스크롤 연동 요소 검출 — 여러 스크롤 위치에서 inline 스타일(transform/right/left/top)이 변하는 요소를 찾는다.
// 단일 스냅샷(collectPageSignals)이 구조적으로 놓치는 패럴랙스/스크롤 드리프트(.big_size 가로 이동 등)를 포착한다.
// 후보를 위치마다 재수집·키 병합하므로, 스크롤 후에야 inline 스타일을 받기 시작하는 요소도 놓치지 않는다.
async function collectScrollLinked(page) {
  try {
    const snapshotAt = () => page.evaluate(() => {
      const out = {};
      let taken = 0;
      for (const e of document.querySelectorAll("*")) {
        if (taken > 300) break;
        const s = e.getAttribute("style") || "";
        if (!/(transform|right|left|top)\s*:/.test(s)) continue;
        const cls = (e.className || "").toString();
        // 리빌 완료(aos)·슬라이더 내부 이동은 스크롤 연동 모션이 아니므로 제외
        if (/swiper-wrapper|swiper-slide|aos-init|aos-animate/.test(cls) || e.hasAttribute("data-aos")) continue;
        const sec = e.closest('[class*="sec"],section');
        const secKey = sec ? `${sec.id || ""} ${(sec.className || "").toString().slice(0, 14)}`.trim() : "";
        const key = `${e.tagName}.${cls.split(/\s+/).slice(0, 2).join(".")}@${secKey}`;
        if (out[key]) continue;
        const g = (re) => { const m = s.match(re); return m ? m[1].trim() : ""; };
        out[key] = {
          sec: secKey,
          cls: cls.slice(0, 24),
          transform: g(/transform:\s*([^;]+)/),
          right: g(/right:\s*([^;]+)/),
          left: g(/left:\s*([^;]+)/),
          top: g(/top:\s*([^;]+)/),
        };
        taken += 1;
      }
      return out;
    });
    const snaps = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, document.body.scrollHeight - innerHeight) * y), f);
      await page.waitForTimeout(500);
      snaps.push(await snapshotAt());
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(400);
    const keys = new Set();
    snaps.forEach((s) => Object.keys(s).forEach((k) => keys.add(k)));
    const out = [];
    for (const key of keys) {
      if (out.length >= 20) break;
      const seq = snaps.map((s) => s[key]).filter(Boolean);
      if (seq.length < 2) continue;
      const prop = ["right", "left", "top", "transform"].find((p) => new Set(seq.map((v) => v[p])).size > 1);
      if (prop) out.push({ sec: seq[0].sec, cls: seq[0].cls, prop, from: seq[0][prop], to: seq[seq.length - 1][prop] });
    }
    return out;
  } catch (e) { return []; }
}

// Swiper 상태 순회 — 슬라이드 N장을 slideTo로 전부 순회하며, 슬라이드에 연동되어 가시성이 바뀌는
// "외부 콘텐츠 패널"(예: 장비소개 .equip_content 13종)을 상태별로 전문 캡처한다.
// 정적·1패스 수집이 active 1개만 담는 문제(누락 유형 A)의 근본 해결.
async function traverseSwipers(page) {
  try {
    return await page.evaluate(async () => {
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" &&
          Number(style.opacity || "1") > 0.05 && rect.width > 0 && rect.height > 0;
      };
      const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
      const results = [];
      const swipers = [...document.querySelectorAll(".swiper, .swiper-container")]
        .filter((el) => el.swiper && !(el.parentElement && el.parentElement.closest(".swiper, .swiper-container")));
      // 순회 안정화: 모든 autoplay 정지 — 순회 중 다른 스와이퍼가 돌면 연동 오판·상태 오염이 생긴다
      swipers.forEach((el) => { try { if (el.swiper.autoplay) el.swiper.autoplay.stop(); } catch (e) {} });
      let stateBudget = 48; // 페이지당 총 상태 캡처 상한(런타임 폭주 방지)
      for (const el of swipers.slice(0, 6)) {
        const s = el.swiper;
        const slides = el.querySelectorAll(".swiper-slide:not(.swiper-slide-duplicate)").length;
        if (slides < 2 || stateBudget < 2) continue;
        // 외부 연동 패널 후보: 모든 swiper 바깥의 콘텐츠성 요소
        // (다른 swiper 내부는 그 swiper의 자체 순회가 커버 — 자동재생 fade가 노이즈로 잡히는 것 방지)
        const candidates = [...document.querySelectorAll(
          "[class*='cont'],[class*='panel'],[class*='desc'],[class*='info'],[class*='detail'],[class*='txt'],[class*='item']"
        )].filter((c) => !c.closest(".swiper, .swiper-container") && clean(c.textContent).length > 20).slice(0, 400);
        const snapVis = () => candidates.map((c) => visible(c));
        const snapText = () => candidates.map((c) => clean(c.innerText).slice(0, 260));
        // 시간 구동 노이즈 사전 제거: 슬라이드를 움직이지 않은 두 샘플 사이에 가시성/텍스트가 변한 요소
        // (티커, AOS 리빌 진행 중 등)는 슬라이드 연동으로 오판하지 않는다.
        const vis0 = snapVis(); const text0 = snapText();
        await new Promise((resolve) => setTimeout(resolve, 450));
        const vis1 = snapVis(); const text1 = snapText();
        const timeDriven = candidates.map((_, idx) => vis0[idx] !== vis1[idx] || text0[idx] !== text1[idx]);
        const n = Math.min(slides, 16, stateBudget);
        stateBudget -= n;
        const visMatrix = [];
        const textMatrix = [];
        const fullTexts = new Array(candidates.length).fill("");
        const states = [];
        for (let i = 0; i < n; i += 1) {
          try { (s.slideToLoop || s.slideTo).call(s, i, 0); } catch (e) { try { s.slideTo(i, 0); } catch (_) {} }
          await new Promise((resolve) => setTimeout(resolve, 300));
          const vis = snapVis();
          vis.forEach((v, idx) => { if (v && !fullTexts[idx]) fullTexts[idx] = clean(candidates[idx].innerText).slice(0, 400); });
          visMatrix.push(vis);
          textMatrix.push(snapText());
          const active = el.querySelector(".swiper-slide-active");
          states.push({ index: i, activeSlideText: active ? clean(active.innerText).slice(0, 160) : "" });
        }
        try { (s.slideToLoop || s.slideTo).call(s, 0, 0); } catch (e) {}
        const linkedPanels = [];
        // (a) 노출 전환형: 슬라이드에 따라 가시성이 변한 패널(상태별 show/hide) — 바깥 요소 우선
        candidates.forEach((c, idx) => {
          if (timeDriven[idx]) return;
          const seq = visMatrix.map((row) => row[idx]);
          if (new Set(seq).size < 2) return;
          // 절반 넘는 상태에서 계속 보이면 슬라이드 연동이 아니라 일회성 리빌(AOS 등)로 판단
          if (seq.filter(Boolean).length > Math.max(1, Math.ceil(n / 2))) return;
          if (linkedPanels.some((p) => p.el.contains(c))) return; // 중첩 자손 제거
          linkedPanels.push({
            el: c,
            mode: "show-hide",
            cls: (c.className || "").toString().slice(0, 40),
            visibleAtStates: seq.map((v, stateIdx) => (v ? stateIdx : -1)).filter((v) => v >= 0).slice(0, 6),
            text: fullTexts[idx],
          });
        });
        // (b) 내용 교체형: 요소는 그대로인데 슬라이드에 따라 innerText가 교체 주입되는 패널
        // (예: slideChange 핸들러가 .equip_content .u1/.u2/.u3을 배열로 스왑 — 가시성 diff로는 절대 안 잡힘)
        const swapIdx = [];
        candidates.forEach((c, idx) => {
          if (timeDriven[idx]) return;
          if (new Set(textMatrix.map((row) => row[idx])).size < 2) return;
          swapIdx.push(idx);
        });
        // 조상·자손이 함께 변하면 가장 안쪽 요소만 남긴다(조상은 거대 텍스트 중복)
        const innermost = swapIdx.filter((idx) =>
          !swapIdx.some((other) => other !== idx && candidates[idx].contains(candidates[other])));
        innermost.slice(0, 10).forEach((idx) => {
          const c = candidates[idx];
          if (linkedPanels.some((p) => p.el === c)) return;
          const stateTexts = [];
          textMatrix.forEach((row, stateIdx) => {
            const t = row[idx];
            if (t && !stateTexts.some((st) => st.text === t)) stateTexts.push({ state: stateIdx, text: t });
          });
          linkedPanels.push({
            el: c,
            mode: "content-swap",
            cls: (c.className || "").toString().slice(0, 40),
            stateTexts: stateTexts.slice(0, 16),
          });
        });
        const cls = (el.className || "").toString().split(/\s+/).filter((c) => c && !/^swiper/.test(c)).slice(0, 2).join(" ") || "swiper";
        results.push({
          cls,
          slides,
          statesCaptured: n,
          states,
          linkedPanels: linkedPanels.slice(0, 24).map(({ el: _unused, ...rest }) => rest),
        });
      }
      return results;
    });
  } catch (e) { return []; }
}

function changedEnough(before, after) {
  if (before.url !== after.url) return true;
  if (before.bodyClass !== after.bodyClass) return true;
  if ((before.dialogs || []).length !== (after.dialogs || []).length) return true;
  const beforeExpanded = (before.clickables || []).filter((item) => item.ariaExpanded === "true").length;
  const afterExpanded = (after.clickables || []).filter((item) => item.ariaExpanded === "true").length;
  if (beforeExpanded !== afterExpanded) return true;
  // 클래스 토글형 콘텐츠 교체(탭·아코디언) — url/dialog 수가 안 변해도 상태 지문으로 감지
  const bf = before.stateFingerprint || {};
  const af = after.stateFingerprint || {};
  if (Math.abs((af.visibleTextLength || 0) - (bf.visibleTextLength || 0)) > 120) return true;
  if ((af.activeClassCount || 0) !== (bf.activeClassCount || 0)) return true;
  if ((af.visibleDialogTexts || "") !== (bf.visibleDialogTexts || "")) return true;
  return false;
}

// 클릭 후보 우선순위화 — DOM 순서 상위 N개(헤더 내비 링크가 예산 소진 → 본문 모달/탭 미클릭)가
// 모달 누락의 최대 원인이었다. 순수 페이지 이동 링크(크롤러가 이미 커버)는 제외하고,
// 숨김 모달 트리거 > onclick/js: > aria/data 토글 > tab/button > #앵커 순으로 예산을 배분한다.
function prioritizeClickCandidates(initial, baseUrl, maxClicks) {
  const triggerSelectors = new Set();
  const triggerTexts = new Set();
  (initial.hiddenDialogs || []).forEach((d) => (d.triggers || []).forEach((t) => {
    if (t.selector) triggerSelectors.add(t.selector);
    if (t.text) triggerTexts.add(t.text);
  }));
  const seen = new Set();
  const scored = [];
  for (const c of initial.clickables || []) {
    const href = (c.href || "").trim();
    const key = [c.text, href, c.onclick, c.ariaControls, c.dataTarget].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
      let isNav = false;
      try {
        const u = new URL(href, baseUrl);
        isNav = !c.onclick && !c.ariaControls && !c.dataToggle && !u.hash;
      } catch (_) {}
      if (isNav) continue; // 페이지 이동 링크 — 페이지 단위 수집이 커버
    }
    let score = 0;
    if (triggerSelectors.has(c.selector) || (c.text && triggerTexts.has(c.text))) score += 50;
    if (c.onclick || /^javascript:/i.test(href)) score += 30;
    if (c.ariaControls || c.dataToggle || c.dataTarget) score += 25;
    if (c.role === "tab" || c.role === "button" || c.tag === "button") score += 20;
    if (c.ariaExpanded) score += 15;
    if (href.startsWith("#") && href.length > 1) score += 10;
    // 슬라이더 내비(bullet/화살표)는 traverseSwipers가 전수 순회하므로 클릭 예산에서 후순위
    if (/swiper-pagination|swiper-button|slick-/.test(c.selector)) score -= 25;
    scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return { selected: scored.slice(0, maxClicks), dropped: scored.slice(maxClicks) };
}

// 가로 확장 패널 실측 — interactionPatterns 후보에 실제 hover하여 폭 변화(확장 아코디언 여부)와
// 펼침 시 드러나는 콘텐츠를 캡처한다. "카드 그리드 오판"을 기하 추정이 아닌 실측으로 확정.
async function exploreHoverPanels(page, patterns, pageDir) {
  const results = [];
  const targets = (patterns || []).slice(0, 3);
  for (let pi = 0; pi < targets.length; pi += 1) {
    const pattern = targets[pi];
    if (!pattern.selector) continue;
    try {
      const container = page.locator(pattern.selector).first();
      await container.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      const kids = container.locator("> *");
      const count = Math.min(await kids.count(), 6);
      const panels = [];
      let screenshot = "";
      for (let i = 0; i < count; i += 1) {
        const child = kids.nth(i);
        const before = await child.boundingBox();
        if (!before || before.width < 40) continue;
        await child.hover({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(600);
        const after = await child.boundingBox();
        const expanded = !!(after && after.width > before.width * 1.12);
        let expandedText = "";
        if (expanded) {
          expandedText = ((await child.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 300);
          if (!screenshot) {
            screenshot = path.join(pageDir, `hover-panel-${pi + 1}.png`);
            await page.screenshot({ path: screenshot }).catch(() => {});
          }
        }
        panels.push({
          index: i,
          widthBefore: Math.round(before.width),
          widthAfter: after ? Math.round(after.width) : 0,
          expanded,
          expandedText,
        });
      }
      await page.mouse.move(0, 0).catch(() => {});
      results.push({
        container: pattern.container,
        heading: pattern.heading || "",
        hoverExpands: panels.some((p) => p.expanded),
        panels,
        screenshot: screenshot ? path.relative(path.dirname(pageDir), screenshot).split(path.sep).join("/") : "",
      });
    } catch (error) {
      results.push({ container: pattern.container, error: error.message });
    }
  }
  return results;
}

// 커버리지 자가진단 — "무엇을 못 봤는가"를 산출물에 남겨 누락이 침묵 속에 발생하지 않게 한다.
// QA는 이 수치(미오픈 모달·미순회 Swiper·미탐 클릭 후보)로 재수집 필요를 판단한다.
function buildCoverage(initial, clickPlan, clickStates, swiperStates, hoverPanels, swipersFoundTotal) {
  const openedDialogSelectors = new Set();
  const openedDialogTexts = [];
  clickStates.forEach((st) => (st.visibleDialogs || []).forEach((d) => {
    openedDialogSelectors.add(d.selector);
    if (d.text) openedDialogTexts.push(d.text.slice(0, 60));
  }));
  // 열림 판정은 selector 일치 + 본문 접두 일치 병행 — 모달이 열리며 상태 클래스가 붙으면 selector가 달라진다
  const wasOpened = (d) => openedDialogSelectors.has(d.selector) ||
    (!!d.text && openedDialogTexts.some((t) => t.length > 20 && d.text.startsWith(t.slice(0, 40))));
  const hidden = initial.hiddenDialogs || [];
  const swipersFound = swipersFoundTotal != null
    ? swipersFoundTotal
    : (initial.sectionInteractions || []).reduce((sum, s) => sum + (s.swipers || []).filter((w) => (w.slides || 0) > 1).length, 0);
  return {
    clickablesFound: (initial.clickables || []).length,
    clickCandidates: clickPlan.selected.length,
    clicksExplored: clickStates.length,
    clicksChanged: clickStates.filter((st) => st.changed).length,
    hiddenDialogsFound: hidden.length,
    hiddenDialogsWithTrigger: hidden.filter((d) => (d.triggers || []).length).length,
    dialogsOpenedByClick: openedDialogSelectors.size,
    dialogsUnopened: hidden
      .filter((d) => !wasOpened(d))
      .slice(0, 15)
      .map((d) => ({ selector: d.selector, textLength: d.textLength, hasTrigger: (d.triggers || []).length > 0 })),
    swipersFound,
    swipersTraversed: (swiperStates || []).length,
    swiperStatesCaptured: (swiperStates || []).reduce((sum, s) => sum + (s.statesCaptured || 0), 0),
    hoverPanelGroupsFound: (initial.interactionPatterns || []).length,
    hoverPanelGroupsVerified: (hoverPanels || []).filter((h) => !h.error).length,
    unexploredCandidates: clickPlan.dropped.slice(0, 15).map((c) => c.text || c.onclick || c.selector),
  };
}

async function exploreClicks(context, url, candidates, pageDir) {
  const results = [];

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
      // 진입 팝업(지연 노출)이 before 스냅샷 이후에 뜨면 모든 클릭이 "모달 열림"으로 오검출되므로 안정화 대기
      await page.waitForTimeout(900);
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
      // 클릭으로 새로 열린 다이얼로그 — 존재 여부만이 아니라 본문을 남긴다(분석가 창작 방지)
      const beforeDialogSelectors = new Set((before.dialogs || []).map((d) => d.selector));
      const newDialogs = (after.dialogs || []).filter((d) => !beforeDialogSelectors.has(d.selector));
      results.push({
        candidate,
        changed,
        afterUrl: after.url,
        bodyClass: after.bodyClass,
        visibleDialogs: after.dialogs,
        newDialogs,
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
    const ds = page.initial.designSignals;
    if (ds) {
      lines.push("");
      lines.push("### 디자인 런타임 실측 (★ 폰트·라이브러리·모션 1차 정답)");
      if (ds.fonts) {
        const top = (ds.fonts.usageTop || []).slice(0, 3).map(([f, n]) => `${f}(${n})`).join(", ");
        lines.push(`- **폰트(실측):** 본문 \`${(ds.fonts.bodyComputed || "").split(",")[0]}\` · 상위 ${top}`);
      }
      if (ds.typeScale && ds.typeScale.fzUtilities && Object.keys(ds.typeScale.fzUtilities).length) {
        lines.push(`- **타입스케일(fz유틸):** ${Object.entries(ds.typeScale.fzUtilities).map(([k, v]) => v).join(" / ")}`);
      }
      if (ds.palette) lines.push(`- **배경:** ${ds.palette.bodyBg} · 텍스트색 ${(ds.palette.textColors || []).slice(0, 3).map(([c]) => c).join(", ")}`);
      if (ds.libs) {
        const on = Object.entries(ds.libs).filter(([, v]) => v).map(([k]) => k);
        lines.push(`- **라이브러리 로드:** ${on.length ? on.join(", ") : "(없음 — 경량/정적)"}`);
      }
      if (ds.scrollTrigger && ds.scrollTrigger.length) {
        ds.scrollTrigger.forEach((t) => lines.push(`- **GSAP ScrollTrigger:** \`${t.trigger}\` start=${t.start} end=${t.end} scrub=${t.scrub}`));
      }
      if (ds.swipers && ds.swipers.length) {
        ds.swipers.filter((s) => s.instantiated !== false).forEach((s) => lines.push(`- **Swiper:** \`${s.cls}\` spv=${s.slidesPerView} gap=${s.spaceBetween} autoplay=${s.autoplay} loop=${s.loop} effect=${s.effect} speed=${s.speed}`));
      }
      if (ds.aos && ds.aos.total) lines.push(`- **AOS:** total=${ds.aos.total} types=${JSON.stringify(ds.aos.types)} dur=${JSON.stringify(ds.aos.durations)} global=${ds.aos.globalDuration}`);
      if (ds.revealRules && ds.revealRules.length) {
        lines.push("- **리빌 클래스(CSS):**");
        ds.revealRules.slice(0, 4).forEach((r) => lines.push(`  - \`${r.selector}\` → \`${r.css}\``));
      }
    }
    const si = page.initial.sectionInteractions || [];
    if (si.length) {
      lines.push("");
      lines.push("### 섹션별 인터랙션 인벤토리 (★ 섹션 귀속 — 역할 추측 금지)");
      lines.push("> Swiper 역할은 **클래스명이 아니라 소속 섹션·슬라이드 수**로 확정한다(예: `main_view`를 '히어로'로 추측 금지 — 실제 소속 섹션을 보라). AOS·reveal은 섹션별 집계 — 모션 집중 섹션을 보존한다. **Swiper 슬라이드 N장이면 슬라이드별 콘텐츠가 외부 영역에 교체 주입될 수 있으니(예: 장비 .equip_content) N개 상태를 모두 캡처할 것.**");
      lines.push("| 섹션 | 헤딩 | reveal | AOS(방향×수) | Swiper(슬라이드) | big_size | 확장패널 |");
      lines.push("|------|------|--------|--------------|------------------|----------|----------|");
      si.forEach((s) => {
        const aos = Object.entries(s.aos).map(([k, v]) => `${k}×${v}`).join("·") || "—";
        const sw = s.swipers.length ? s.swipers.map((w) => `${w.cls}(${w.slides}장${w.effect ? "," + w.effect : ""})`).join(", ") : "—";
        const reveal = (s.afxReveal + s.afxFade) || "—";
        lines.push(`| \`${s.id || s.cls}\` | ${s.heading || "—"} | ${reveal} | ${aos} | ${sw} | ${s.bigSize || "—"} | ${s.expandPanels || "—"} |`);
      });
    }
    const sl = page.initial.scrollLinked || [];
    if (sl.length) {
      lines.push("");
      lines.push("### 스크롤 연동 요소 (★ 패럴랙스/드리프트 — 단일 스냅샷으로는 안 보임)");
      lines.push("> 여러 스크롤 위치에서 inline 스타일이 변한 요소 = **스크롤 진행에 연동된 모션**(가로 패럴랙스 워드마크 등). 정적·단일 상태 수집이 구조적으로 놓치므로, 형태·이동량을 그대로 명세할 것.");
      sl.forEach((o) => lines.push(`- \`${o.cls || "(el)"}\`${o.sec ? ` · 섹션 ${o.sec}` : ""} · **${o.prop}** \`${o.from}\` → \`${o.to}\``));
    }
    const patterns = page.initial.interactionPatterns || [];
    if (patterns.length) {
      lines.push("");
      lines.push("### 인터랙션 패턴 (가로 풀높이 패널 행 — 확장 셀렉터/슬라이더 후보)");
      lines.push("> ⚠️ 같은 행에 나란히 선 풀높이 패널. **정적 카드 그리드로 오판 금지** — 확장(hover/click 펼침)·슬라이드 여부를 확인하고 형태·모션을 그대로 명세할 것.");
      for (const pattern of patterns) {
        lines.push(`- **${pattern.type}** \`${pattern.container}\` · 패널 ${pattern.panelCount}개 (${pattern.panelWidth}×${pattern.panelHeight}px) · transition \`${pattern.childTransition}\` · cursor ${pattern.cursor} · flex-grow ${pattern.flexGrow}`);
        if (pattern.heading) lines.push(`  - 섹션: ${pattern.heading}`);
        if (pattern.panelTitles && pattern.panelTitles.length) lines.push(`  - 패널: ${pattern.panelTitles.join(" / ")}`);
      }
    }
    const stw = page.initial.selfTestWidgets;
    if (stw && ((stw.surveys && stw.surveys.length) || (stw.timers && stw.timers.length))) {
      lines.push("");
      lines.push("### 자가진단 위젯 (★ 인터랙션 내부 동작 실측 — 분석가는 이 값을 추정보다 우선)");
      lines.push("> 아래는 DOM 실측값이다. **상태머신·진행바·결과 임계값을 임의 창작하지 말 것** — 여기 없는 동작은 \"미확인(추정)\"으로 표기한다.");
      (stw.surveys || []).forEach((s) => {
        lines.push(`- **예/아니오 토글 설문** \`${s.container}\` · ${s.questionCount}문항 · ${s.display} · 진행바 ${s.hasProgressBar ? "있음" : "**없음(실측)**"} · 순차분기 ${s.sequential ? "있음" : "**없음(실측)**"} · 결과영역 ${s.hasResultEl ? "있음" : "없음"}`);
        if (s.questions && s.questions.length) s.questions.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`));
        if (s.resultText) lines.push(`  - 결과 문구: ${s.resultText}`);
      });
      (stw.timers || []).forEach((t) => {
        lines.push(`- **카운트업 타이머** \`${t.counter}\` · 초기값 \`${t.initial}\` · 트리거 "${t.trigger}" · setInterval ${t.usesInterval ? "사용" : "미확인"}`);
        if (t.context) lines.push(`  - 맥락/판정: ${t.context}`);
      });
    }
    const hiddenDialogs = page.initial.hiddenDialogs || [];
    if (hiddenDialogs.length) {
      lines.push("");
      lines.push("### 숨김 모달/레이어 인벤토리 (★ display:none 포함 전수 — 클릭 전에도 본문 실측)");
      lines.push("> 초기 상태에서 숨겨진 모달·레이어를 DOM에서 전수 수집했다. **\"모달 0개\"로 단정 금지** — 클릭으로 열리지 않았어도 본문·트리거가 아래에 실측돼 있으니 이것을 콘텐츠 근거로 사용하라.");
      hiddenDialogs.forEach((d) => {
        const triggers = (d.triggers || []).map((t) => `"${t.text || t.selector}"`).join(", ") || "미확인";
        lines.push(`- \`${d.id ? `#${d.id}` : d.selector}\` (본문 ${d.textLength}자) · 트리거: ${triggers}`);
        if (d.text) lines.push(`  - 본문: ${d.text.slice(0, 240)}`);
      });
    }
    const swiperStates = page.swiperStates || [];
    if (swiperStates.length) {
      lines.push("");
      lines.push("### Swiper 상태 순회 (★ 슬라이드 N장 전수 — active 1개 스냅샷 아님)");
      lines.push("> 각 슬라이드를 slideTo로 순회하며 캡처했다. `연동 패널` = 슬라이드에 따라 **외부 영역에 교체 주입되는 콘텐츠**(장비 상세 등). **이 목록이 곧 해당 섹션의 전체 콘텐츠 인벤토리다 — 1개만 반영하면 누락.**");
      swiperStates.forEach((s) => {
        lines.push(`- **\`${s.cls}\`** — ${s.slides}장 중 ${s.statesCaptured}개 상태 순회 · 연동 패널 ${(s.linkedPanels || []).length}개`);
        (s.states || []).forEach((st) => {
          if (st.activeSlideText) lines.push(`  - 슬라이드 ${st.index + 1}: ${st.activeSlideText.slice(0, 120)}`);
        });
        (s.linkedPanels || []).forEach((p) => {
          if (p.mode === "content-swap") {
            lines.push(`  - 연동 패널(내용 교체) \`${p.cls}\` — 슬라이드마다 텍스트가 교체 주입됨. 상태별 전문:`);
            (p.stateTexts || []).forEach((st) => lines.push(`    - 상태 ${st.state + 1}: ${st.text}`));
          } else {
            lines.push(`  - 연동 패널(노출 전환) \`${p.cls}\` (상태 ${(p.visibleAtStates || []).map((v) => v + 1).join(",")}): ${p.text ? p.text.slice(0, 220) : ""}`);
          }
        });
      });
    }
    const hoverPanels = page.hoverPanels || [];
    if (hoverPanels.length) {
      lines.push("");
      lines.push("### 호버 확장 패널 실측 (★ 카드 그리드 오판 방지)");
      hoverPanels.forEach((h) => {
        if (h.error) { lines.push(`- \`${h.container}\` — 실측 실패: ${h.error}`); return; }
        lines.push(`- \`${h.container}\`${h.heading ? ` (${h.heading})` : ""} — hover 확장 ${h.hoverExpands ? "**확인(실측)**" : "무반응(클릭형/정적 추정)"}${h.screenshot ? ` · screenshot \`${h.screenshot}\`` : ""}`);
        (h.panels || []).filter((p) => p.expanded).forEach((p) => {
          lines.push(`  - 패널 ${p.index + 1}: ${p.widthBefore}px → ${p.widthAfter}px${p.expandedText ? ` · "${p.expandedText.slice(0, 150)}"` : ""}`);
        });
      });
    }
    const changedStates = page.clickStates.filter((item) => item.changed);
    if (changedStates.length) {
      lines.push("");
      lines.push("### 클릭 후 변화");
      for (const state of changedStates.slice(0, 15)) {
        const label = state.candidate.text || state.candidate.onclick || state.candidate.selector;
        lines.push(`- "${label}" → URL: ${state.afterUrl}`);
        if (state.visibleDialogs && state.visibleDialogs.length) {
          lines.push(`  - visible dialog: ${state.visibleDialogs.map((dialog) => dialog.text || dialog.selector).join(" / ").slice(0, 300)}`);
        }
        if (state.newDialogs && state.newDialogs.length) {
          state.newDialogs.forEach((d) => lines.push(`  - 열린 모달 본문: ${(d.text || "").slice(0, 220)}`));
        }
        if (state.screenshot) {
          lines.push(`  - screenshot: \`${state.screenshot}\``);
        }
      }
    }
    const cov = page.coverage;
    if (cov) {
      lines.push("");
      lines.push("### 커버리지 자가진단 (★ QA 필수 확인 — 미탐이 남으면 재수집/추가 탐색)");
      lines.push(`- 클릭: 후보 ${cov.clickablesFound}개 → 우선순위 선별 ${cov.clickCandidates}개 → 탐색 ${cov.clicksExplored}개 (변화 감지 ${cov.clicksChanged}개)`);
      lines.push(`- 숨김 모달: ${cov.hiddenDialogsFound}개 발견(트리거 확인 ${cov.hiddenDialogsWithTrigger}개) · 클릭으로 열림 ${cov.dialogsOpenedByClick}개 — 미오픈이어도 본문은 위 인벤토리에 실측됨`);
      lines.push(`- Swiper: ${cov.swipersFound}개 중 ${cov.swipersTraversed}개 순회 (총 ${cov.swiperStatesCaptured}개 상태)`);
      lines.push(`- 확장 패널 후보: ${cov.hoverPanelGroupsFound}개 중 ${cov.hoverPanelGroupsVerified}개 hover 실측`);
      if ((cov.unexploredCandidates || []).length) {
        lines.push(`- ⚠️ **미탐 클릭 후보 ${cov.unexploredCandidates.length}개+** (\`--max-clicks\` 상향 재실행 권장): ${cov.unexploredCandidates.join(" / ").slice(0, 400)}`);
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
  initial.scrollLinked = await collectScrollLinked(page);
  const swiperStates = await traverseSwipers(page);
  // 커버리지의 발견/순회 분모 일치용 — 문서 전체의 top-level·2장 이상 swiper 수(미인스턴스화 포함)
  const swipersFoundTotal = await page.evaluate(() =>
    [...document.querySelectorAll(".swiper, .swiper-container")]
      .filter((el) => !(el.parentElement && el.parentElement.closest(".swiper, .swiper-container")) &&
        el.querySelectorAll(".swiper-slide:not(.swiper-slide-duplicate)").length > 1).length
  ).catch(() => null);
  const hoverPanels = await exploreHoverPanels(page, initial.interactionPatterns, stateDir);
  const clickPlan = options.clicks
    ? prioritizeClickCandidates(initial, options.baseUrl, options.maxClicks)
    : { selected: [], dropped: [] };
  const clickStates = options.clicks
    ? await exploreClicks(context, url, clickPlan.selected, stateDir)
    : [];
  const coverage = buildCoverage(initial, clickPlan, clickStates, swiperStates, hoverPanels, swipersFoundTotal);

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
    swiperStates,
    hoverPanels,
    coverage,
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
        results.push({ url: pageUrl, error: error.message, initial: { title: "", clickables: [], dialogs: [], hiddenDialogs: [], forms: [] }, screenshots: {}, network: { byType: {}, thirdParty: [] }, consoleErrors: [], clickStates: [], swiperStates: [], hoverPanels: [], coverage: null });
      }
    }
  } finally {
    await browser.close().catch(() => {});
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
