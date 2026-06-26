"""
런타임 인터랙션·디자인 실측 추출 (Playwright)
Usage: python3 extract_runtime.py <site_dir> [max_pages]

analyze_site.py(정적 크롤러)가 보지 못하는 "브라우저 런타임 값"을 페이지별로 추출한다:
  - 실측 폰트(computed font-family) / 타입 스케일 / 팔레트
  - 애니메이션 라이브러리 로드 여부(페이지별 스코프) + 런타임 config
  - GSAP ScrollTrigger / AOS / Swiper 인스턴스 설정값
  - 커스텀 스크롤 리빌 클래스(opacity/transform/transition) 정의
  - 헤더 스크롤 동작 / 위젯 인벤토리(SVG 해부도·설문·표·스텝·stat·영상)

출력:
  - <site_dir>/runtime_extract.json  (머신리더블, 분석가 입력)
  - <site_dir>/runtime_extract.md    (사람 가독 요약)

설계 원칙:
  - 페이지별 try/except로 실패 격리(한 페이지 실패가 전체를 막지 않음)
  - 섹션별 try/catch(JS)로 부분 추출 보장
  - 어느 사이트에도 동작하도록 범용 셀렉터 사용(특정 테마 클래스에 의존하지 않음)
"""
import sys
import os
import json
import re
from collections import Counter
from playwright.sync_api import sync_playwright

MAX_PAGES = 8
PC_VIEWPORT = {"width": 1920, "height": 1080}

# 페이지 컨텍스트에서 실행되는 런타임 추출 스크립트.
# 마지막 표현식(객체)이 반환된다. 모든 섹션은 개별 try/catch로 보호.
EXTRACT_JS = r"""
() => {
  const out = { url: location.pathname, title: document.title };
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

  // ---- 1. 폰트(실측) ----
  out.fonts = safe(() => {
    const usage = {};
    document.querySelectorAll('p,span,h1,h2,h3,h4,h5,li,a,div,td,th,button').forEach(e => {
      if ((e.textContent || '').trim().length > 2) {
        const f = getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim();
        usage[f] = (usage[f] || 0) + 1;
      }
    });
    const faces = [...document.fonts].map(f => f.family)
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 30);
    return {
      bodyComputed: getComputedStyle(document.body).fontFamily,
      usageTop: Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 8),
      faceFamilies: faces,
    };
  }, null);

  // ---- 2. 타입 스케일(실측) ----
  out.typeScale = safe(() => {
    const sizes = {};
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,div,button').forEach(e => {
      if ((e.textContent || '').trim().length > 2) {
        const fs = parseInt(getComputedStyle(e).fontSize, 10);
        if (fs) sizes[fs] = (sizes[fs] || 0) + 1;
      }
    });
    const headings = {};
    ['h1', 'h2', 'h3', 'h4'].forEach(t => {
      const el = document.querySelector(t);
      if (el) {
        const s = getComputedStyle(el);
        headings[t] = { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight,
                        letterSpacing: s.letterSpacing, fontFamily: s.fontFamily.split(',')[0].replace(/["']/g, '') };
      }
    });
    // .fzNN 유틸리티(있을 경우)
    const fz = {};
    document.querySelectorAll('[class*="fz"]').forEach(e => {
      (e.className.toString().match(/fz\d+/g) || []).forEach(c => { if (!fz[c]) fz[c] = getComputedStyle(e).fontSize; });
    });
    return {
      sizeFrequency: Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 14),
      headings, fzUtilities: fz,
    };
  }, null);

  // ---- 3. 팔레트(실측) ----
  out.palette = safe(() => {
    const text = {}, bg = {};
    document.querySelectorAll('h1,h2,h3,h4,strong,b,em,button,a,p,span').forEach(e => {
      const c = getComputedStyle(e).color; if (c) text[c] = (text[c] || 0) + 1;
    });
    document.querySelectorAll('section,div,header,footer,main,article').forEach(e => {
      const b = getComputedStyle(e).backgroundColor;
      if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') bg[b] = (bg[b] || 0) + 1;
    });
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      textColors: Object.entries(text).sort((a, b) => b[1] - a[1]).slice(0, 8),
      bgColors: Object.entries(bg).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, null);

  // ---- 4. 애니메이션 라이브러리 로드 스코프(페이지별) ----
  out.libs = safe(() => ({
    gsap: window.gsap ? (window.gsap.version || true) : false,
    ScrollTrigger: !!(window.ScrollTrigger),
    AOS: !!window.AOS,
    Swiper: !!window.Swiper,
    Rellax: !!window.Rellax,
    anime: !!window.anime,
    scrollMonitor: !!window.scrollMonitor,
    simpleParallax: !!window.simpleParallax,
    Vimeo: !!window.Vimeo,
  }), null);

  // ---- 5. GSAP ScrollTrigger 설정 ----
  out.scrollTrigger = safe(() => {
    if (!(window.ScrollTrigger && window.ScrollTrigger.getAll)) return [];
    return window.ScrollTrigger.getAll().map(t => ({
      trigger: (t.trigger && t.trigger.className ? t.trigger.className.toString() : String(t.trigger)).slice(0, 40),
      start: t.vars && t.vars.start, end: t.vars && t.vars.end,
      scrub: t.vars && t.vars.scrub, pin: t.vars && t.vars.pin,
    }));
  }, []);

  // ---- 6. AOS 속성 집계 ----
  out.aos = safe(() => {
    const els = [...document.querySelectorAll('[data-aos]')];
    const types = {}, dur = {}, delay = {}, ease = {};
    els.forEach(e => {
      const t = e.getAttribute('data-aos'); if (t) types[t] = (types[t] || 0) + 1;
      const d = e.getAttribute('data-aos-duration'); if (d) dur[d] = (dur[d] || 0) + 1;
      const dl = e.getAttribute('data-aos-delay'); if (dl) delay[dl] = (delay[dl] || 0) + 1;
      const ea = e.getAttribute('data-aos-easing'); if (ea) ease[ea] = (ease[ea] || 0) + 1;
    });
    return { total: els.length, types, durations: dur, delays: delay, easings: ease,
             globalDuration: window.aosDuration || null };
  }, null);

  // ---- 7. Swiper 인스턴스 설정 ----
  out.swipers = safe(() => [...document.querySelectorAll('.swiper, .swiper-container')].map(el => {
    const s = el.swiper;
    if (!s) return { cls: el.className.toString().slice(0, 30), instantiated: false };
    const ap = s.params.autoplay;
    return {
      cls: el.className.toString().slice(0, 30),
      slidesPerView: s.params.slidesPerView, spaceBetween: s.params.spaceBetween,
      autoplay: ap ? (ap.delay || true) : false, loop: s.params.loop,
      effect: s.params.effect, speed: s.params.speed, direction: s.params.direction,
    };
  }), []);

  // ---- 8. 커스텀 스크롤 리빌 클래스(opacity+transform+transition) ----
  out.revealRules = safe(() => {
    const found = [];
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        if (!r.style) continue;
        const css = r.style.cssText || '';
        const hasOpacity0 = /opacity:\s*0\b/.test(css);
        const hasTransform = /transform:\s*translate|transform:\s*scale/.test(css);
        const hasTransition = /transition:/.test(css);
        // 리빌 후보: opacity:0 + (transform 또는 transition) 동반
        if (hasOpacity0 && (hasTransform || hasTransition)) {
          found.push({ selector: (r.selectorText || '').slice(0, 60), css: css.slice(0, 200) });
        }
      }
      if (found.length > 25) break;
    }
    return found.slice(0, 25);
  }, []);

  // ---- 9. 헤더 스크롤 동작 ----
  out.header = safe(() => {
    const cands = [...document.querySelectorAll('header, [class*="header"], [id*="header"], nav')];
    const fixed = cands.find(e => ['fixed', 'sticky'].includes(getComputedStyle(e).position));
    const h = fixed || cands[0];
    if (!h) return null;
    return {
      tag: h.tagName, cls: h.className.toString().slice(0, 40),
      position: getComputedStyle(h).position,
      background: getComputedStyle(h).backgroundColor,
      transition: getComputedStyle(h).transition.slice(0, 60),
    };
  }, null);

  // ---- 10. 위젯 인벤토리 ----
  out.widgets = safe(() => ({
    svg: document.querySelectorAll('svg').length,
    canvas: document.querySelectorAll('canvas').length,
    tables: document.querySelectorAll('table').length,
    forms: document.querySelectorAll('form').length,
    inputs: document.querySelectorAll('input,textarea,select').length,
    videos: document.querySelectorAll('video').length,
    vimeo: document.querySelectorAll('iframe[src*="vimeo"]').length,
    youtube: document.querySelectorAll('iframe[src*="youtube"],iframe[src*="youtu.be"]').length,
    naverMap: document.querySelectorAll('iframe[src*="naver"],[id*="map"],[class*="map"]').length,
    tabs: document.querySelectorAll('[role="tab"],[class*="tab-"],[class*="_tab"]').length,
    accordion: document.querySelectorAll('details,[class*="accordion"],[class*="faq"]').length,
    steps: document.querySelectorAll('[class*="step"]').length,
    stats: document.querySelectorAll('[class*="stat"],[class*="count"]').length,
    survey: document.querySelectorAll('[class*="survey"],[class*="quiz"],[class*="test"]').length,
    sliders: document.querySelectorAll('.swiper,.slick-slider,.carousel,.owl-carousel').length,
    buttons: document.querySelectorAll('button,[class*="btn"]').length,
    telLinks: document.querySelectorAll('a[href^="tel:"]').length,
    extLinks: document.querySelectorAll('a[target="_blank"]').length,
  }), null);

  return out;
}
"""

# 스크롤 후 body/html 클래스 변화(스크롤 상태 토글) 추출
SCROLL_STATE_JS = r"""
() => {
  const safe = (fn, f) => { try { return fn(); } catch (e) { return f; } };
  return safe(() => {
    const before = { body: document.body.className, html: document.documentElement.className };
    window.scrollTo(0, 700);
    const after = { body: document.body.className, html: document.documentElement.className };
    window.scrollTo(0, 0);
    return { before, after,
             changed: before.body !== after.body || before.html !== after.html };
  }, null);
}
"""


def slugify(url: str) -> str:
    s = re.sub(r"^https?://[^/]+", "", url).strip("/")
    if not s:
        return "index"
    s = re.sub(r"[^a-zA-Z0-9\-_]+", "_", s)
    return s[:80] or "index"


def pick_pages(pages_json_path: str, limit: int = MAX_PAGES):
    with open(pages_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    pages = data.get("pages") if isinstance(data, dict) else data
    if not pages:
        return []
    seen, urls = set(), []
    for p in pages:
        u = p.get("url") or p.get("URL")
        if not u:
            continue
        norm = u.rstrip("/") or "/"  # trailing-slash 변형 중복 제거
        if norm in seen:
            continue
        seen.add(norm)
        urls.append(u)
        if len(urls) >= limit:
            break
    return urls


def extract(site_dir: str, max_pages: int = MAX_PAGES) -> dict:
    pages_json = os.path.join(site_dir, "pages.json")
    if not os.path.exists(pages_json):
        return {"pages": [], "errors": [f"pages.json missing: {pages_json}"]}

    urls = pick_pages(pages_json, max_pages)
    if not urls:
        return {"pages": [], "errors": ["no urls in pages.json"]}

    results, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport=PC_VIEWPORT)
        for url in urls:
            try:
                page = ctx.new_page()
                # networkidle은 일부 사이트에서 타임아웃 → load 후 고정 대기로 폴백
                try:
                    page.goto(url, wait_until="networkidle", timeout=20000)
                except Exception:
                    page.goto(url, wait_until="load", timeout=20000)
                page.wait_for_timeout(1800)  # 라이브러리 init·폰트 로드 대기
                data = page.evaluate(EXTRACT_JS)
                scroll = None
                try:
                    scroll = page.evaluate(SCROLL_STATE_JS)
                except Exception:
                    pass
                data["scrollState"] = scroll
                results.append(data)
                print(f"  ✓ runtime {slugify(url)}")
                page.close()
            except Exception as e:
                errors.append(f"{url}: {e}")
                print(f"  ✗ runtime {url}: {e}")
                try:
                    page.close()
                except Exception:
                    pass
        ctx.close()
        browser.close()

    return {"pages": results, "errors": errors, "pages_extracted": len(results)}


def _color_union(results, key):
    """페이지 전반의 색상 빈도 통합."""
    c = Counter()
    for r in results:
        pal = r.get("palette") or {}
        for color, n in (pal.get(key) or []):
            c[color] += n
    return c.most_common(10)


def summarize_md(site_dir: str, result: dict) -> str:
    results = result.get("pages", [])
    lines = ["# Runtime 실측 추출 — 런타임 인터랙션·디자인", ""]
    lines.append(f"**추출 페이지:** {len(results)} · **에러:** {len(result.get('errors', []))}")
    lines.append("")
    lines.append("> analyze_site.py(정적)가 보지 못하는 브라우저 런타임 값. 분석가는 본 데이터를 추론보다 우선한다.")
    lines.append("")

    # 라이브러리 스코프 매트릭스
    lines.append("## 1. 애니메이션 라이브러리 로드 스코프 (페이지별)")
    lib_keys = ["gsap", "ScrollTrigger", "AOS", "Swiper", "Rellax", "anime", "scrollMonitor", "Vimeo"]
    lines.append("| 페이지 | " + " | ".join(lib_keys) + " |")
    lines.append("|" + "---|" * (len(lib_keys) + 1))
    for r in results:
        libs = r.get("libs") or {}
        row = [r.get("url", "?")]
        for k in lib_keys:
            row.append("✅" if libs.get(k) else "·")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")

    # 폰트 매트릭스
    lines.append("## 2. 실측 폰트 (페이지별 본문 1순위)")
    lines.append("| 페이지 | 본문 1순위 | 상위 폰트 | 배경 |")
    lines.append("|---|---|---|---|")
    for r in results:
        fonts = r.get("fonts") or {}
        top = fonts.get("usageTop") or []
        first = top[0][0] if top else "?"
        topstr = ", ".join(f"{f}({n})" for f, n in top[:3])
        bg = (r.get("palette") or {}).get("bodyBg", "?")
        lines.append(f"| {r.get('url','?')} | **{first}** | {topstr} | {bg} |")
    lines.append("")

    # 위젯 인벤토리
    lines.append("## 3. 위젯 인벤토리 (페이지별)")
    lines.append("| 페이지 | svg | tables | forms | vimeo | steps | stats | survey | sliders | tabs |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        w = r.get("widgets") or {}
        lines.append("| " + " | ".join(str(x) for x in [
            r.get("url", "?"), w.get("svg", 0), w.get("tables", 0), w.get("forms", 0),
            w.get("vimeo", 0), w.get("steps", 0), w.get("stats", 0), w.get("survey", 0),
            w.get("sliders", 0), w.get("tabs", 0)]) + " |")
    lines.append("")

    # GSAP / Swiper / AOS 설정
    lines.append("## 4. 스크롤·슬라이더 런타임 설정")
    for r in results:
        st = r.get("scrollTrigger") or []
        sw = r.get("swipers") or []
        aos = r.get("aos") or {}
        if st or sw or (aos and aos.get("total")):
            lines.append(f"### {r.get('url','?')}")
            if st:
                lines.append("- **GSAP ScrollTrigger:**")
                for t in st:
                    lines.append(f"  - `{t.get('trigger')}` start=`{t.get('start')}` end=`{t.get('end')}` scrub=`{t.get('scrub')}` pin=`{t.get('pin')}`")
            if sw:
                lines.append("- **Swiper:**")
                for s in sw:
                    if s.get("instantiated") is False:
                        continue
                    lines.append(f"  - `{s.get('cls')}` spv={s.get('slidesPerView')} gap={s.get('spaceBetween')} autoplay={s.get('autoplay')} loop={s.get('loop')} effect={s.get('effect')} speed={s.get('speed')}")
            if aos and aos.get("total"):
                lines.append(f"- **AOS:** total={aos.get('total')} types={aos.get('types')} dur={aos.get('durations')} easing={aos.get('easings')} global={aos.get('globalDuration')}")
            lines.append("")

    # 커스텀 리빌 클래스(페이지별 — 스크롤 모션의 핵심 정의)
    lines.append("## 5. 커스텀 스크롤 리빌 클래스 (CSS 정의)")
    for r in results:
        rr = r.get("revealRules") or []
        if rr:
            lines.append(f"### {r.get('url','?')}")
            for rule in rr[:8]:
                lines.append(f"- `{rule.get('selector')}` → `{rule.get('css')}`")
            lines.append("")

    # 통합 팔레트
    lines.append("## 6. 통합 팔레트 (전 페이지 빈도)")
    lines.append("- **텍스트:** " + ", ".join(f"{c}({n})" for c, n in _color_union(results, "textColors")))
    lines.append("- **배경:** " + ", ".join(f"{c}({n})" for c, n in _color_union(results, "bgColors")))
    lines.append("")

    # 헤더 스크롤 상태
    lines.append("## 7. 헤더·스크롤 상태")
    for r in results:
        h = r.get("header") or {}
        sc = r.get("scrollState") or {}
        if h:
            changed = "토글有" if (sc and sc.get("changed")) else "토글無"
            lines.append(f"- {r.get('url','?')}: `{h.get('cls')}` position={h.get('position')} transition={h.get('transition')} · 스크롤상태 {changed}")
    lines.append("")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 extract_runtime.py <site_dir> [max_pages]", file=sys.stderr)
        sys.exit(2)
    site_dir = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else MAX_PAGES

    result = extract(site_dir, max_pages)

    json_path = os.path.join(site_dir, "runtime_extract.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    md_path = os.path.join(site_dir, "runtime_extract.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(summarize_md(site_dir, result))

    print(json.dumps({
        "runtime_json": json_path,
        "runtime_md": md_path,
        "pages_extracted": result.get("pages_extracted", 0),
        "errors": result.get("errors", []),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
