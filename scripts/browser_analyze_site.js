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
        const tops = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
        const headingOf = (el) => {
          const h = el.querySelector('h1,h2,h3,[class*="tit"]');
          return h ? (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30) : "";
        };
        return tops.slice(0, 24).map((el) => {
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

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scrollHeight: document.documentElement.scrollHeight,
      bodyClass: document.body.className || "",
      clickables,
      dialogs,
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
async function collectScrollLinked(page) {
  try {
    await page.evaluate(() => {
      window.__sl = [...document.querySelectorAll("*")].filter((e) => {
        const s = e.getAttribute("style") || "";
        const cls = (e.className || "").toString();
        return /(transform|right|left|top)\s*:/.test(s) && !/swiper-wrapper|swiper-slide/.test(cls);
      }).slice(0, 500);
    });
    const snap = () => page.evaluate(() => window.__sl.map((e) => {
      const s = e.getAttribute("style") || "";
      const g = (re) => { const m = s.match(re); return m ? m[1].trim() : ""; };
      const sec = e.closest('[class*="sec"],section');
      return {
        sec: sec ? ((sec.id || "") + " " + (sec.className || "").toString().slice(0, 14)).trim() : "",
        cls: (e.className || "").toString().slice(0, 24),
        transform: g(/transform:\s*([^;]+)/),
        right: g(/right:\s*([^;]+)/),
        top: g(/top:\s*([^;]+)/),
      };
    }));
    const snaps = [];
    for (const f of [0, 0.35, 0.7]) {
      await page.evaluate((y) => window.scrollTo(0, document.body.scrollHeight * y), f);
      await page.waitForTimeout(600);
      snaps.push(await snap());
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    const out = [];
    const n = (snaps[0] || []).length;
    for (let i = 0; i < n; i++) {
      const seq = snaps.map((s) => s[i]).filter(Boolean);
      if (seq.length < 2) continue;
      const prop = ["right", "transform", "top"].find((p) => new Set(seq.map((v) => v[p])).size > 1);
      if (prop) out.push({ sec: seq[0].sec, cls: seq[0].cls, prop, from: seq[0][prop], to: seq[seq.length - 1][prop] });
    }
    return out.slice(0, 20);
  } catch (e) { return []; }
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
  initial.scrollLinked = await collectScrollLinked(page);
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
        results.push({ url: pageUrl, error: error.message, initial: { title: "", clickables: [], dialogs: [], forms: [] }, screenshots: {}, network: { byType: {}, thirdParty: [] }, consoleErrors: [], clickStates: [] });
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
