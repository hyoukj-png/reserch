"""
웹사이트 리뉴얼 분석 통합 스크립트
Usage: python analyze_site.py https://example.com
"""

import sys
import os
import re
import time
import json
import hashlib
import unicodedata
import argparse
from datetime import datetime
from urllib.parse import urljoin, urlparse, parse_qs
from collections import deque

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("❌ 필수 패키지 누락. 설치 중...")
    os.system("pip install requests beautifulsoup4 lxml")
    import requests
    from bs4 import BeautifulSoup

# trafilatura는 선택 의존성 — 없으면 BS4 fallback-only 로 동작
try:
    import trafilatura as _trafilatura
except ImportError:
    _trafilatura = None


# ============================================================
# 설정
# ============================================================
MAX_DEPTH = 3
MAX_PAGES = 200
REQUEST_DELAY = 0.5  # 초
TIMEOUT = 15
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_BASE = os.path.join(BASE_DIR, "output")

SAVE_INDIVIDUAL_PAGES = True   # --no-pages로 비활성화 가능
MAX_PAGE_TEXT_LENGTH = 0       # 0 = 무제한
PAGE_FILENAME_MAX_LENGTH = 100
SLUGIFY_NON_ASCII = True       # 비ASCII 파일명 영숫자 변환

# v1.2: 본문 추출 품질
USE_TRAFILATURA = True         # --no-trafilatura 로 비활성화 가능
DETECT_BOILERPLATE = True      # --no-boilerplate 로 비활성화 가능
MIN_MAIN_LENGTH = 120          # trafilatura 결과가 이보다 짧으면 BS4 fallback
BOILERPLATE_THRESHOLD = 0.6    # 전 페이지 중 60% 이상 반복 라인 = boilerplate

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
}


def get_site_name(url: str) -> str:
    """URL에서 사이트 이름 추출"""
    name = re.sub(r"https?://", "", url)
    name = re.sub(r"[/.]", "_", name)
    return name[:30].strip("_")


def ensure_dirs(site_name: str) -> str:
    """출력 디렉토리 생성"""
    base = os.path.join(OUTPUT_BASE, site_name)
    dirs = [
        base,
        os.path.join(base, "screenshots", "pc"),
        os.path.join(base, "screenshots", "mobile"),
        os.path.join(base, "assets", "images"),
        os.path.join(base, "pages"),
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
    return base


def save_md(base_dir: str, filename: str, content: str):
    """마크다운 파일 저장"""
    filepath = os.path.join(base_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  ✅ {filename} 저장 완료")


# ============================================================
# Phase 1: 사이트 접속 & 기본 확인
# ============================================================
def phase1_check_access(url: str) -> dict:
    print("\n" + "=" * 60)
    print("📡 Phase 1: 사이트 접속 & 유효성 확인")
    print("=" * 60)

    result = {"url": url, "accessible": False}

    # 1-1. URL 접속
    try:
        start = time.time()
        res = requests.get(url, timeout=TIMEOUT, headers=HEADERS, allow_redirects=True)
        elapsed = round((time.time() - start) * 1000)

        result["accessible"] = True
        result["status_code"] = res.status_code
        result["response_time_ms"] = elapsed
        result["final_url"] = res.url
        result["https"] = res.url.startswith("https")
        result["html"] = res.text

        # 서버 기술 힌트
        server_hints = {}
        for h in ["Server", "X-Powered-By", "X-Generator", "X-WordPress-Version"]:
            if h in res.headers:
                server_hints[h] = res.headers[h]
        result["server_hints"] = server_hints

        print(f"  ✅ 접속 성공 | 상태: {res.status_code} | 응답: {elapsed}ms")
        print(f"  📍 최종 URL: {res.url}")
        print(f"  🔒 HTTPS: {'✅' if result['https'] else '❌'}")
        for k, v in server_hints.items():
            print(f"  📌 {k}: {v}")

    except Exception as e:
        print(f"  ❌ 접속 실패: {e}")
        return result

    # 1-2. robots.txt 확인
    robots_url = url.rstrip("/") + "/robots.txt"
    try:
        robots_res = requests.get(robots_url, timeout=10, headers=HEADERS)
        if robots_res.status_code == 200:
            result["robots_txt"] = robots_res.text[:3000]
            disallowed = re.findall(r"Disallow:\s*(.+)", robots_res.text)
            result["disallowed_paths"] = [d.strip() for d in disallowed if d.strip()]
            print(f"  📄 robots.txt 발견 | Disallow 경로: {len(result['disallowed_paths'])}개")
        else:
            result["robots_txt"] = None
            result["disallowed_paths"] = []
            print("  ℹ️ robots.txt 없음")
    except Exception as e:
        result["robots_txt"] = None
        result["disallowed_paths"] = []
        print(f"  ⚠️ robots.txt 확인 실패: {e}")

    # 1-3. 로그인 필요 여부 감지
    soup = BeautifulSoup(result["html"], "html.parser")
    login_indicators = [
        soup.find("input", {"type": "password"}),
        soup.find("form", {"action": lambda x: x and "login" in x.lower() if x else False}),
    ]
    result["login_required"] = any(login_indicators)
    if result["login_required"]:
        print("  ⚠️ 로그인 페이지 감지됨 — 공개 페이지만 분석합니다")
    else:
        print("  ✅ 공개 접근 가능")

    return result


# ============================================================
# Phase 2: 기술 스택 탐지
# ============================================================
def phase2_detect_tech(url: str, html: str) -> dict:
    print("\n" + "=" * 60)
    print("🔍 Phase 2: 기술 스택 자동 탐지")
    print("=" * 60)

    soup = BeautifulSoup(html, "html.parser")
    tech_stack = {}

    # Meta generator
    generator = soup.find("meta", {"name": "generator"})
    if generator and generator.get("content"):
        tech_stack["CMS"] = generator["content"]
        print(f"  🏷️ Generator: {tech_stack['CMS']}")

    # Script src + HTML 통합 검색
    scripts = [s.get("src", "") for s in soup.find_all("script") if s.get("src")]
    search_text = " ".join(scripts) + " " + html[:50000]

    framework_patterns = {
        "Next.js": r"_next/static|__NEXT_DATA__|next/dist",
        "Nuxt.js": r"_nuxt/|__nuxt|nuxt\.js",
        "React": r"react\.min\.js|react-dom|/static/js/main\.",
        "Vue.js": r"vue\.min\.js|vue\.runtime|vue@\d",
        "Angular": r"angular\.min\.js|ng-version|zone\.js",
        "Svelte": r"svelte|\.svelte\.",
        "Astro": r"astro|_astro/",
        "WordPress": r"wp-content|wp-includes|wordpress",
        "Shopify": r"cdn\.shopify\.com|Shopify\.",
        "Webflow": r"webflow\.com|\.webflow\.",
        "Wix": r"wix\.com|wixsite",
        "Ghost": r"ghost\.io|content\.ghost",
        "Gatsby": r"gatsby|page-data\.json",
    }

    css_patterns = {
        "Tailwind CSS": r"tailwind|tw-",
        "Bootstrap": r"bootstrap\.min\.css|bootstrap\.bundle|col-md-|col-lg-",
        "MUI (Material UI)": r"MuiButton|\.MuiBox|material-ui",
        "Ant Design": r"ant-design|antd\.min|\.ant-btn",
        "Chakra UI": r"chakra-ui|@chakra",
        "Foundation": r"foundation\.min\.css",
    }

    analytics_patterns = {
        "Google Analytics 4": r"gtag\(|G-[A-Z0-9]+|google-analytics",
        "Google Tag Manager": r"googletagmanager\.com|GTM-[A-Z0-9]+",
        "Hotjar": r"hotjar\.com|hjid:",
        "Meta Pixel": r"connect\.facebook\.net|fbq\(",
        "Clarity": r"clarity\.ms",
    }

    js_lib_patterns = {
        "jQuery": r"jquery\.min\.js|jquery\.js",
        "GSAP": r"gsap\.min\.js|gsap",
        "AOS": r"aos\.js|AOS\.init",
        "Swiper": r"swiper\.min\.js|swiper-bundle",
        "Lottie": r"lottie|bodymovin",
    }

    categories = {
        "프레임워크": framework_patterns,
        "CSS 프레임워크": css_patterns,
        "분석 도구": analytics_patterns,
        "JS 라이브러리": js_lib_patterns,
    }

    for category, patterns in categories.items():
        detected = [name for name, pattern in patterns.items() if re.search(pattern, search_text, re.I)]
        if detected:
            tech_stack[category] = detected
            print(f"  ✅ {category}: {', '.join(detected)}")

    # 폰트 감지
    font_links = soup.find_all("link", href=re.compile(r"fonts\.googleapis|fonts\.gstatic|use\.typekit", re.I))
    if font_links:
        fonts = []
        for fl in font_links:
            href = fl.get("href", "")
            font_match = re.findall(r"family=([^&:]+)", href)
            fonts.extend([f.replace("+", " ") for f in font_match])
        if fonts:
            tech_stack["외부 폰트"] = fonts
            print(f"  🔤 외부 폰트: {', '.join(fonts)}")

    return tech_stack


# ============================================================
# Phase 3: 페이지 전체 탐색
# ============================================================
def phase3_crawl_pages(url: str, disallowed: list) -> list:
    print("\n" + "=" * 60)
    print("🗺️ Phase 3: 페이지 전체 탐색")
    print("=" * 60)

    domain = urlparse(url).netloc
    all_pages = set()
    pages_data = []

    # Step 1: sitemap.xml 파싱
    sitemap_paths = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]
    for path in sitemap_paths:
        try:
            sm_res = requests.get(url.rstrip("/") + path, timeout=10, headers=HEADERS)
            if sm_res.status_code == 200 and "<?xml" in sm_res.text[:100]:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(sm_res.text)
                ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
                urls_found = [loc.text for loc in root.findall(".//sm:loc", ns) if loc.text]
                all_pages.update(urls_found)
                print(f"  📄 sitemap.xml 발견: {len(urls_found)}개 URL")
                break
        except Exception:
            pass

    if not all_pages:
        print("  ℹ️ sitemap.xml 없음 — 링크 크롤링으로 진행")

    # Step 2: 재귀 링크 크롤링
    visited = set()
    queue = deque([(url, 0)])

    while queue and len(visited) < MAX_PAGES:
        current_url, depth = queue.popleft()
        if current_url in visited or depth > MAX_DEPTH:
            continue

        # Disallowed 경로 체크
        parsed = urlparse(current_url)
        if any(parsed.path.startswith(d) for d in disallowed):
            continue

        try:
            res = requests.get(current_url, timeout=TIMEOUT, headers=HEADERS)
            visited.add(current_url)
            all_pages.add(current_url)

            if depth < MAX_DEPTH and res.status_code == 200:
                soup = BeautifulSoup(res.text, "html.parser")
                for a in soup.find_all("a", href=True):
                    href = urljoin(current_url, a["href"])
                    href_parsed = urlparse(href)
                    # 같은 도메인만, 정적 파일 제외
                    if (href_parsed.netloc == domain
                            and not re.search(r"\.(jpg|png|gif|pdf|zip|css|js|ico|svg|woff|ttf)$", href, re.I)
                            and href not in visited
                            and "#" not in href):
                        queue.append((href, depth + 1))

            time.sleep(REQUEST_DELAY)
            if len(visited) % 10 == 0:
                print(f"  📊 크롤링 진행: {len(visited)}개 페이지 방문...")

        except Exception as e:
            visited.add(current_url)  # 실패해도 다시 시도하지 않음

    print(f"  ✅ 총 {len(all_pages)}개 페이지 발견")

    # 페이지별 메타 정보 수집
    print("  📝 메타 정보 수집 중...")
    for page_url in list(all_pages)[:MAX_PAGES]:
        try:
            res = requests.get(page_url, timeout=TIMEOUT, headers=HEADERS)
            soup = BeautifulSoup(res.text, "html.parser")

            desc_tag = soup.find("meta", {"name": "description"})
            pages_data.append({
                "url": page_url,
                "status": res.status_code,
                "title": soup.title.text.strip() if soup.title else "",
                "description": desc_tag.get("content", "") if desc_tag else "",
                "h1": [h.text.strip() for h in soup.find_all("h1")][:3],
                "h2": [h.text.strip() for h in soup.find_all("h2")][:5],
                "load_time_ms": round(res.elapsed.total_seconds() * 1000),
                "html": res.text,
            })
            time.sleep(REQUEST_DELAY)
        except Exception:
            pass

    print(f"  ✅ {len(pages_data)}개 페이지 메타 정보 수집 완료")
    return pages_data


# ============================================================
# v1.2: 본문 추출 파이프라인 (noise strip → main detect → boilerplate 정제)
# ============================================================

# blacklist: class/id 에 이 패턴이 포함된 요소는 본문 추출 시 제거
_NOISE_BLACKLIST_PATTERNS = [
    r"\b(gnb|lnb|snb|nav|menu|navigation)\b",
    r"\b(header|top-?bar|topbar|site-?header)\b",
    r"\b(footer|site-?footer|copyright)\b",
    r"\b(sidebar|side-?bar|widget)\b",
    r"\b(breadcrumb|bread-?crumb)\b",
    r"\b(popup|modal|overlay|lightbox)\b",
    r"\b(cookie|gdpr|consent)\b",
    r"\b(floating|fixed-?btn|quick-?menu|fab)\b",
    r"\b(share|sns|social)\b",
    r"\b(pagination|page-?nav|prev-?next)\b",
    r"\b(skip|a11y|sr-only|screen-reader)\b",
    r"\b(ad|ads|advertisement)\b",
]
_NOISE_RE = re.compile("|".join(_NOISE_BLACKLIST_PATTERNS), re.I)
# Hero/main-visual 은 blacklist 매치되어도 보존 (화이트리스트)
_HERO_RE = re.compile(r"\b(hero|visual|main-?visual|key-?visual|mv|kv)\b", re.I)

# 본문에서 단독으로 나올 때 제거할 페이지네이션/UI 라벨
PAGINATION_LABELS = {
    "이전글", "다음글", "목록", "페이지 정보", "본문",
    "검색", "프린트", "공유하기", "위로", "TOP", "Next", "Prev",
}


def strip_noise(soup):
    """본문 추출 전 nav/header/footer 및 blacklist 영역을 제거한다."""
    # 스크립트·스타일·미디어 컨테이너
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()

    # 의미 태그: nav/header/footer 는 전체 제거
    for tag in soup(["nav", "header", "footer"]):
        tag.decompose()

    # aside 는 sidebar/widget/advert 클래스일 때만 제거 (callout 보존)
    for el in soup.find_all("aside"):
        cls = " ".join(el.get("class", []))
        if re.search(r"sidebar|widget|advert", cls, re.I):
            el.decompose()

    # ARIA role 기반
    for role in ["navigation", "banner", "contentinfo", "search"]:
        for el in soup.find_all(attrs={"role": role}):
            el.decompose()

    # class/id 패턴 blacklist (단, Hero 화이트리스트는 보존)
    for el in soup.find_all(class_=_NOISE_RE):
        cls = " ".join(el.get("class", []))
        if _HERO_RE.search(cls):
            continue
        el.decompose()
    for el in soup.find_all(id=_NOISE_RE):
        if _HERO_RE.search(el.get("id", "")):
            continue
        el.decompose()

    return soup


def _highest_density_block(root):
    """텍스트 밀도 기반 본문 후보 탐지 (fallback).
    밀도 = text_len / (descendant_tags + 1), 링크 비율 30% 이하 요소만 후보."""
    candidates = []
    for el in root.find_all(["div", "section", "article"]):
        text = el.get_text(strip=True)
        if len(text) < 200:
            continue
        link_text = "".join(a.get_text(strip=True) for a in el.find_all("a"))
        if len(link_text) / max(len(text), 1) > 0.3:
            continue
        density = len(text) / (len(el.find_all()) + 1)
        candidates.append((density, el))
    return max(candidates, key=lambda x: x[0])[1] if candidates else root


def find_main_content(soup):
    """의미 셀렉터 우선, 없으면 텍스트 밀도 fallback."""
    for selector in [
        "main", "article", '[role="main"]',
        "#content", "#contents", "#main", "#container",
        ".content", ".contents", ".contents_area",
        ".main", ".main-content", "#wrap .inner",
    ]:
        el = soup.select_one(selector)
        if el and len(el.get_text(strip=True)) > 100:
            return el
    return _highest_density_block(soup.body) if soup.body else None


def extract_main_text(html, url=""):
    """trafilatura 로 본문만 추출. 없거나 실패하면 빈 문자열."""
    if _trafilatura is None:
        return ""
    try:
        text = _trafilatura.extract(
            html,
            url=url or None,
            include_comments=False,
            include_tables=True,
            include_images=False,
            include_links=False,
            favor_precision=True,
            deduplicate=True,
        )
        return text or ""
    except Exception:
        return ""


def extract_main_text_with_fallback(html, url="", use_trafilatura=True):
    """trafilatura 우선, 결과가 너무 짧거나 없으면 BS4 + strip_noise fallback."""
    if use_trafilatura:
        text = extract_main_text(html, url)
        if text and len(text) >= MIN_MAIN_LENGTH:
            return text

    soup = BeautifulSoup(html, "html.parser")
    soup = strip_noise(soup)
    main_el = find_main_content(soup)
    return main_el.get_text(separator="\n", strip=True) if main_el else ""


def detect_boilerplate(all_texts, threshold=0.6, titles=None):
    """전 페이지 중 threshold 이상 반복되는 라인 = 공용 boilerplate.
    페이지 3개 미만이면 스킵. 페이지 제목과 동일 라인은 제외."""
    from collections import Counter
    if len(all_texts) < 3:
        return set()
    counts = Counter()
    for text in all_texts:
        lines = {ln.strip() for ln in (text or "").split("\n") if len(ln.strip()) >= 4}
        for ln in lines:
            counts[ln] += 1
    min_n = max(2, int(len(all_texts) * threshold))
    bp = {ln for ln, c in counts.items() if c >= min_n}
    if titles:
        bp -= set(titles)
    return bp


def clean_extracted_text(text, boilerplate=None):
    """본문 정제: 페이지네이션 라벨/boilerplate/중복 라인 제거.
    본문 첫 줄과 너무 짧은 라인은 보존 원칙에 따라 처리."""
    if not text:
        return ""
    boilerplate = boilerplate or set()
    cleaned, prev = [], None
    for i, raw in enumerate(text.split("\n")):
        ln = raw.strip()
        if i == 0 and len(ln) >= 2:
            cleaned.append(ln)
            prev = ln
            continue
        if len(ln) < 2:
            continue
        if ln in PAGINATION_LABELS or ln in boilerplate:
            continue
        if ln == prev:
            continue
        cleaned.append(ln)
        prev = ln
    return "\n".join(cleaned)


# ============================================================
# Phase 4: 콘텐츠 수집 (v1.2 — 3-pass 구조)
# ============================================================
def build_page_record(page: dict, base_url: str, use_trafilatura: bool = True) -> dict:
    """Pass 1: 개별 페이지에서 구조 섹션 + 본문 후보를 추출하여 표준화된 레코드로 반환.
    본문 정제(boilerplate 제거)는 Pass 3 에서 전체 페이지 기준으로 수행."""
    html = page.get("html", "") or ""
    record = {
        "url": page["url"],
        "title": page.get("title", "") or "",
        "description": page.get("description", "") or "",
        "status": page.get("status", ""),
        "load_time_ms": page.get("load_time_ms", ""),
        "depth": url_depth(page["url"], base_url),
        "html": html,
        # 구조 섹션
        "nav_text": "",
        "breadcrumb_text": "",
        "footer_text": "",
        "buttons": [],
        "forms": [],
        "images": [],         # (alt, src_absolute)
        "internal_links": [],
        "external_links": [],
        "headings": {},
        # 메타
        "lang": "",
        "canonical": "",
        "og_image": "",
        # 본문
        "main_text_candidate": "",
        "clean_main_text": "",
        "word_count": 0,
    }

    if not html:
        return record

    soup_meta = BeautifulSoup(html, "html.parser")

    # frontmatter 메타
    html_tag = soup_meta.find("html")
    record["lang"] = html_tag.get("lang", "") if html_tag else ""
    canon = soup_meta.find("link", rel="canonical")
    record["canonical"] = canon.get("href", "") if canon else ""
    og = soup_meta.find("meta", property="og:image")
    record["og_image"] = og.get("content", "") if og else ""

    # 구조 섹션 수집은 원본 HTML 기준 (nav/footer 존재 여부 표시용)
    soup_struct = BeautifulSoup(html, "html.parser")
    for tag in soup_struct(["script", "style", "noscript"]):
        tag.decompose()

    nav_el = soup_struct.find("nav")
    record["nav_text"] = nav_el.get_text(separator=" | ", strip=True) if nav_el else ""

    bc_el = soup_struct.find(attrs={"aria-label": re.compile(r"breadcrumb", re.I)}) or \
            soup_struct.find(class_=re.compile(r"breadcrumb", re.I))
    record["breadcrumb_text"] = bc_el.get_text(separator=" > ", strip=True) if bc_el else ""

    footer_el = soup_struct.find("footer")
    record["footer_text"] = footer_el.get_text(separator="\n", strip=True) if footer_el else ""

    # 버튼 / CTA (원본 HTML 기준)
    record["buttons"] = [
        btn.get_text(strip=True)
        for btn in soup_struct.find_all(["button", "a"])
        if btn.get_text(strip=True) and len(btn.get_text(strip=True)) < 50
    ][:20]

    # 폼
    for form in soup_struct.find_all("form"):
        inputs = form.find_all(["input", "textarea", "select"])
        record["forms"].append({
            "action": form.get("action", ""),
            "method": form.get("method", "GET").upper(),
            "fields": len(inputs),
            "field_names": [i.get("name", i.get("placeholder", "")) for i in inputs][:10],
        })

    # 이미지
    for img in soup_struct.find_all("img"):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
        if not src:
            continue
        record["images"].append({
            "alt": img.get("alt", ""),
            "url": urljoin(page["url"], src),
            "type": "img",
        })
    if record["og_image"]:
        record["images"].append({
            "alt": "OG Image",
            "url": record["og_image"],
            "type": "og",
        })

    # 링크 (내부/외부)
    base_domain = urlparse(base_url).netloc
    for a in soup_struct.find_all("a", href=True):
        href = a["href"].strip()
        text = a.get_text(strip=True)[:80]
        if not href or href.startswith("#") or href.startswith("javascript"):
            continue
        full = urljoin(page["url"], href)
        parsed = urlparse(full)
        if parsed.netloc == base_domain:
            record["internal_links"].append((text, parsed.path))
        elif parsed.scheme in ("http", "https"):
            record["external_links"].append((text, full))

    # Headings
    for level in range(1, 5):
        items = [h.get_text(strip=True) for h in soup_struct.find_all(f"h{level}")]
        if items:
            record["headings"][f"H{level}"] = items[:10]

    # 본문 후보 (trafilatura + fallback)
    record["main_text_candidate"] = extract_main_text_with_fallback(
        html, page["url"], use_trafilatura=use_trafilatura
    )

    return record


def phase4_collect_content(pages_data: list, base_url: str, output_dir: str,
                           save_pages: bool = True,
                           use_trafilatura: bool = True,
                           detect_boilerplate_flag: bool = True) -> dict:
    """3-pass 구조:
    Pass 1 — 모든 페이지에서 표준화 레코드 생성
    Pass 2 — 전 페이지 기준 boilerplate 감지
    Pass 3 — 본문 정제 + .md 저장
    """
    print("\n" + "=" * 60)
    print("📝 Phase 4: 콘텐츠 전체 수집 (v1.2 3-pass)")
    print("=" * 60)

    if use_trafilatura and _trafilatura is None:
        print("  ⚠️ trafilatura 미설치 — BS4 fallback 모드로 진행합니다.")

    # --- Pass 1: 페이지별 표준화 레코드 생성 ---
    print("  📄 Pass 1: 레코드 생성 중...")
    records = []
    for page in pages_data:
        try:
            rec = build_page_record(page, base_url, use_trafilatura=use_trafilatura)
            records.append(rec)
        except Exception as e:
            print(f"    ⚠️ 레코드 생성 실패 ({page.get('url', '?')}): {e}")

    # --- Pass 2: 전 페이지 기준 boilerplate 감지 ---
    if detect_boilerplate_flag:
        print("  🔍 Pass 2: boilerplate 감지 중...")
        all_candidates = [r["main_text_candidate"] for r in records]
        titles = {r["title"] for r in records if r["title"]}
        boilerplate = detect_boilerplate(all_candidates, BOILERPLATE_THRESHOLD, titles)
        print(f"     감지된 boilerplate 라인: {len(boilerplate)}개")
    else:
        boilerplate = set()

    # --- Pass 3: 본문 정제 + 저장 ---
    print("  🧹 Pass 3: 본문 정제 + 저장 중...")
    content_inventory = []
    all_images = []
    downloaded = set()

    for rec in records:
        # 본문 정제
        rec["clean_main_text"] = clean_extracted_text(rec["main_text_candidate"], boilerplate)
        rec["word_count"] = len(rec["clean_main_text"].split())

        # 04-content-inventory.md 미리보기용 sections 구조
        sections = {
            "nav": rec["nav_text"][:500],
            "main": rec["clean_main_text"][:300],
            "footer": rec["footer_text"][:500],
            "buttons": rec["buttons"],
            "forms": rec["forms"],
        }

        # pages/ 개별 파일 저장
        pages_file = ""
        if save_pages:
            pages_dir = os.path.join(output_dir, "pages")
            fp = url_to_filepath(rec["url"], base_url, pages_dir)
            try:
                page_md_content = generate_page_md(rec, base_url)
                with open(fp, "w", encoding="utf-8") as f:
                    f.write(page_md_content)
                pages_file = os.path.relpath(fp, output_dir).replace(os.sep, "/")
            except Exception as e:
                print(f"    ⚠️ 개별 파일 저장 실패 ({rec['url']}): {e}")

        content_inventory.append({
            "url": rec["url"],
            "title": rec["title"],
            "sections": sections,
            "pages_file": pages_file,
            "word_count": rec["word_count"],
        })

        # 전역 이미지 목록 (다운로드용 — v1.2 는 기존 assets/images/ 구조 유지)
        for img in rec["images"]:
            all_images.append({
                "url": img["url"],
                "alt": img["alt"],
                "page": rec["url"],
                "type": img.get("type", "img"),
            })

    print(f"  ✅ {len(content_inventory)}개 페이지 텍스트 정제 완료")
    print(f"  🖼️ {len(all_images)}개 이미지 URL 발견")

    # --- 4-2. 이미지 다운로드 (기존 assets/images/ 중앙 저장 유지) ---
    print("  📥 이미지 다운로드 중...")
    save_dir = os.path.join(output_dir, "assets", "images")

    for img in all_images[:100]:
        try:
            img_url = img["url"]
            if not img_url or img_url in downloaded or not img_url.startswith("http"):
                continue

            img_res = requests.get(img_url, timeout=10, headers=HEADERS, stream=True)
            if img_res.status_code == 200:
                ext = img_url.split(".")[-1].split("?")[0][:5]
                if ext not in ["jpg", "jpeg", "png", "gif", "svg", "webp", "ico"]:
                    ext = "jpg"
                filename = hashlib.md5(img_url.encode()).hexdigest()[:10] + "." + ext
                filepath = os.path.join(save_dir, filename)

                with open(filepath, "wb") as f:
                    for chunk in img_res.iter_content(8192):
                        f.write(chunk)

                img["local_path"] = filepath
                downloaded.add(img_url)

            time.sleep(0.2)
        except Exception:
            pass

    print(f"  ✅ {len(downloaded)}개 이미지 다운로드 완료")

    return {
        "content_inventory": content_inventory,
        "all_images": all_images,
        "downloaded_count": len(downloaded),
        "page_records": records,  # v1.3 입력용으로 보존
    }


# ============================================================
# Phase 5: 디자인 시스템 분석
# ============================================================
def phase5_design_tokens(pages_data: list, base_url: str) -> dict:
    print("\n" + "=" * 60)
    print("🎨 Phase 5: 디자인 시스템 분석")
    print("=" * 60)

    all_colors = {}
    all_fonts = set()

    # 5-1. CSS 파일 수집 & 변수 파싱
    css_urls = set()
    for page in pages_data[:5]:
        soup = BeautifulSoup(page.get("html", ""), "html.parser")
        for link in soup.find_all("link", rel="stylesheet"):
            href = link.get("href", "")
            if href:
                css_urls.add(urljoin(page["url"], href))

    css_var_pattern = re.compile(
        r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\))"
    )
    font_pattern = re.compile(r"font-family\s*:\s*([^;}{]+)")

    print(f"  📄 {len(css_urls)}개 CSS 파일 분석 중...")
    for css_url in list(css_urls)[:20]:
        try:
            css_res = requests.get(css_url, timeout=10, headers=HEADERS)
            if css_res.status_code == 200:
                # CSS 변수 추출
                matches = css_var_pattern.findall(css_res.text)
                for var_name, color in matches:
                    all_colors[var_name] = color

                # 폰트 추출
                font_matches = font_pattern.findall(css_res.text)
                for fm in font_matches:
                    fonts = [f.strip().strip("'\"") for f in fm.split(",")]
                    all_fonts.update(f for f in fonts if f and f not in [
                        "inherit", "initial", "sans-serif", "serif", "monospace",
                        "cursive", "fantasy", "system-ui", "-apple-system"
                    ])

            time.sleep(0.3)
        except Exception:
            pass

    print(f"  ✅ CSS 변수 컬러: {len(all_colors)}개")
    print(f"  ✅ 감지된 폰트: {', '.join(list(all_fonts)[:10]) if all_fonts else '없음'}")

    # 5-2. inline style에서 추가 컬러 추출
    inline_colors = set()
    hex_pattern = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")

    for page in pages_data[:5]:
        html = page.get("html", "")
        matches = hex_pattern.findall(html)
        inline_colors.update(f"#{m}" for m in matches)

    # 흔한 기본 색상 제외
    common_colors = {"#000000", "#FFFFFF", "#ffffff", "#000", "#fff", "#FFF"}
    inline_colors -= common_colors

    print(f"  ✅ Inline HEX 컬러: {len(inline_colors)}개")

    return {
        "css_variables": all_colors,
        "fonts": list(all_fonts),
        "inline_colors": list(inline_colors)[:50],
    }


# ============================================================
# 숨김/JS 모달 콘텐츠 추출 (정적 수집 맹점 보완)
# ============================================================
# 정적 본문 추출(trafilatura)은 display:none 모달을 노이즈로 버리고,
# 표준 data-toggle 외의 커스텀 JS 트리거(after_on() 등)는 phase6가 놓친다.
# 모달 콘텐츠는 서버 렌더되어 HTML에 이미 존재하므로 별도 추출로 복구한다.
MODAL_TRIGGER_RE = re.compile(
    r"""javascript:\s*\w+\s*\(           # href="javascript:fn("
        |on(?:click|tap)\s*=\s*["'][^"']*\b\w+\s*\(   # onclick="fn("
        |data-(?:bs-)?toggle\s*=\s*["']modal""",
    re.I | re.X,
)
# 모달/팝업/레이어 패널로 보이는 단일 class·id 토큰 (한국 사이트 관용 명명 포함).
# 정밀 매칭: modals_1 같은 패널은 잡되, modal_box(내부 비교카드) 같은 컴포넌트는 제외.
MODAL_TOKEN_RE = re.compile(
    r"^(?:modals?|popups?|layer[-_]?pop\w*|modal[-_]?(?:wrap|pop)\w*)(?:[-_]?\d+)?$", re.I
)


def _is_modal_container(el) -> bool:
    """el의 id 또는 class 토큰 중 하나라도 모달 패널 명명에 부합하는가."""
    tokens = list(el.get("class", []))
    if el.get("id"):
        tokens.append(el["id"])
    return any(MODAL_TOKEN_RE.match(t) for t in tokens)


def extract_modal_blocks(html: str) -> list:
    """HTML에서 모달/팝업/숨김 콘텐츠 패널을 찾아 구조화 텍스트로 추출한다.
    display:none 여부와 무관. 중첩 시 가장 안쪽 패널(#modals_1 등) 단위로 분리한다.
    반환: [{"id": str, "title": str, "text": str, "words": int}, ...]"""
    soup = BeautifulSoup(html or "", "html.parser")
    matched = [el for el in soup.find_all(["div", "section", "article", "aside"])
               if _is_modal_container(el)]
    matched_set = set(matched)

    # 가장 안쪽(leaf) 패널만 채택: 모달 매칭 자손을 가진 래퍼는 건너뛴다.
    leaves = [el for el in matched
              if not any(d in matched_set for d in el.find_all(["div", "section", "article", "aside"]))]

    blocks = []
    for el in leaves:
        for junk in el(["script", "style", "noscript", "svg"]):
            junk.decompose()
        text = re.sub(r"\n{2,}", "\n", el.get_text(separator="\n", strip=True))
        if len(text) < 60:  # 빈 껍데기/닫기버튼만 있는 컨테이너 제외
            continue
        # 패널 대표 제목 우선: role=heading(통상 aria-level=2) → 첫 h1~h4 → id
        heading = el.find(attrs={"role": "heading"}) or el.find(["h1", "h2", "h3", "h4"])
        title = heading.get_text(strip=True) if heading else (el.get("id") or "모달")
        blocks.append({
            "id": el.get("id", "") or " ".join(el.get("class", [])),
            "title": title[:120],
            "text": text,
            "words": len(text.split()),
        })

    return blocks


def detect_modal_triggers(html: str) -> int:
    """after_on() · onclick="fn(" · data-toggle=modal 등 모달 트리거 추정 개수."""
    return len(MODAL_TRIGGER_RE.findall(html or ""))


# ============================================================
# Phase 6: 인터랙티브 요소 분석 (정적)
# ============================================================
def phase6_interactive(pages_data: list) -> dict:
    print("\n" + "=" * 60)
    print("⚡ Phase 6: 인터랙티브 요소 분석")
    print("=" * 60)

    interactive = {
        "슬라이더_캐러셀": 0,
        "탭": 0,
        "모달_트리거": 0,
        "드롭다운": 0,
        "폼": [],
        "비디오": 0,
        "애니메이션_라이브러리": [],
        "숨김_모달_콘텐츠": [],   # 추출한 모달/팝업 콘텐츠 블록
    }
    _modal_seen = set()   # (제목, 본문 앞부분) 기준 모달 중복 제거

    for page in pages_data[:10]:
        soup = BeautifulSoup(page.get("html", ""), "html.parser")
        html = page.get("html", "")

        # 슬라이더 감지
        slider_patterns = [".swiper", ".slick-slider", ".carousel", ".owl-carousel", "[data-slider]"]
        for sp in slider_patterns:
            selector = sp.lstrip(".")
            if soup.find(class_=re.compile(selector, re.I)) or re.search(selector, html, re.I):
                interactive["슬라이더_캐러셀"] += 1
                break

        # 탭
        tabs = soup.find_all(attrs={"role": "tab"}) or soup.find_all(class_=re.compile(r"tab", re.I))
        interactive["탭"] += len(tabs)

        # 모달 — 표준 data-toggle + 커스텀 JS 트리거(after_on() 등) + 컨테이너
        std_modals = soup.find_all(attrs={"data-toggle": "modal"}) + soup.find_all(attrs={"data-bs-toggle": "modal"})
        interactive["모달_트리거"] += len(std_modals) + detect_modal_triggers(html)

        # 숨김/JS 모달 콘텐츠 추출 (trafilatura가 버린 display:none 콘텐츠 복구)
        # 여러 페이지에 동일 모달이 반복되므로 본문 기준 중복 제거
        for blk in extract_modal_blocks(html):
            sig = (blk["title"], blk["text"][:200])
            if sig in _modal_seen:
                continue
            _modal_seen.add(sig)
            blk["page"] = page["url"]
            interactive["숨김_모달_콘텐츠"].append(blk)

        # 폼
        for form in soup.find_all("form"):
            inputs = form.find_all(["input", "textarea", "select"])
            interactive["폼"].append({
                "page": page["url"],
                "action": form.get("action", ""),
                "method": form.get("method", "GET"),
                "fields": len(inputs),
            })

        # 비디오
        interactive["비디오"] += len(soup.find_all(["video", "iframe"]))

        # 애니메이션 라이브러리
        if re.search(r"gsap|GreenSock", html, re.I):
            interactive["애니메이션_라이브러리"].append("GSAP")
        if re.search(r"AOS\.init|aos\.js", html, re.I):
            interactive["애니메이션_라이브러리"].append("AOS")
        if re.search(r"lottie|bodymovin", html, re.I):
            interactive["애니메이션_라이브러리"].append("Lottie")

    interactive["애니메이션_라이브러리"] = list(set(interactive["애니메이션_라이브러리"]))

    n_modal_content = len(interactive["숨김_모달_콘텐츠"])
    modal_words = sum(b["words"] for b in interactive["숨김_모달_콘텐츠"])
    print(f"  📊 슬라이더/캐러셀: {interactive['슬라이더_캐러셀']}개 페이지")
    print(f"  📊 탭: {interactive['탭']}개")
    print(f"  📊 모달 트리거: {interactive['모달_트리거']}개")
    print(f"  📊 숨김 모달 콘텐츠 블록: {n_modal_content}개 (약 {modal_words}단어 복구)")
    print(f"  📊 폼: {len(interactive['폼'])}개")
    print(f"  📊 비디오/iframe: {interactive['비디오']}개")
    print(f"  📊 애니메이션: {', '.join(interactive['애니메이션_라이브러리']) or '없음'}")
    if n_modal_content:
        print(f"  ⚠️  정적 본문 추출이 놓친 모달 콘텐츠를 복구했습니다 → pages/_modals.md 저장 예정")

    return interactive


# ============================================================
# pages/ 개별 저장 헬퍼
# ============================================================

def slugify_segment(text: str) -> str:
    """URL 세그먼트를 안전한 파일명으로 변환 (비ASCII → 영숫자)"""
    # 유니코드 정규화 후 ASCII 변환 시도
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    # 빈 결과면 MD5 해시로 대체
    if not ascii_text.strip():
        ascii_text = "page-" + hashlib.md5(text.encode()).hexdigest()[:8]
    # 영숫자·하이픈·점만 허용, 나머지는 하이픈
    slug = re.sub(r"[^a-zA-Z0-9.\-]", "-", ascii_text)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug[:PAGE_FILENAME_MAX_LENGTH] or "page"


def url_to_filepath(page_url: str, base_url: str, pages_dir: str) -> str:
    """URL을 pages/ 하위 절대 파일 경로로 변환"""
    parsed = urlparse(page_url)
    path = parsed.path.rstrip("/") or "/"

    # 쿼리스트링을 파일명 접미사로
    query_suffix = ""
    if parsed.query:
        # key=value 형태를 key-value__key2-value2로 직렬화
        pairs = [f"{k}-{v[0]}" for k, v in parse_qs(parsed.query).items()]
        query_suffix = "__" + "__".join(pairs)

    segments = [s for s in path.split("/") if s]

    if SLUGIFY_NON_ASCII:
        segments = [slugify_segment(s) for s in segments]

    if not segments:
        # 루트 /
        rel_path = os.path.join("index" + query_suffix + ".md")
    else:
        # 마지막 세그먼트가 확장자 포함하면 .md로 교체, 아니면 index.md로 폴더화
        last = segments[-1]
        if re.search(r"\.[a-zA-Z]{2,5}$", last):
            last = re.sub(r"\.[a-zA-Z]{2,5}$", "", last) + query_suffix + ".md"
            segments[-1] = last
        else:
            segments.append("index" + query_suffix + ".md")
        rel_path = os.path.join(*segments)

    full_path = os.path.join(pages_dir, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    return full_path


def url_depth(page_url: str, base_url: str) -> int:
    """URL의 경로 depth 반환 (루트 = 0)"""
    base_path = urlparse(base_url).path.rstrip("/")
    page_path = urlparse(page_url).path.rstrip("/")
    rel = page_path[len(base_path):].lstrip("/")
    return len([s for s in rel.split("/") if s])


def generate_page_md(record: dict, base_url: str) -> str:
    """page_record 를 받아 .md 로 렌더링만 한다 (추출 안 함).
    v1.2: 추출 기준을 phase4 Pass 1/3 에 일원화. 이 함수는 순수 렌더링."""
    crawled_at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00")

    # frontmatter
    lines = ["---"]
    lines.append(f'url: "{record["url"]}"')
    lines.append(f'title: "{(record.get("title") or "").replace(chr(34), chr(39))}"')
    lines.append(f'description: "{(record.get("description") or "").replace(chr(34), chr(39))}"')
    lines.append(f"status: {record.get('status', '')}")
    lines.append(f"depth: {record.get('depth', 0)}")
    lines.append(f"crawled_at: {crawled_at}")
    lines.append(f"load_time_ms: {record.get('load_time_ms', '')}")
    lines.append(f"word_count: {record.get('word_count', 0)}")
    if record.get("lang"):
        lines.append(f'lang: "{record["lang"]}"')
    if record.get("canonical"):
        lines.append(f'canonical: "{record["canonical"]}"')
    if record.get("og_image"):
        lines.append(f'og_image: "{record["og_image"]}"')
    lines.append("---\n")

    title = record.get("title") or record["url"]
    lines.append(f"# {title}\n")
    lines.append(f"> `{record['url']}`\n")

    if record.get("nav_text"):
        lines.append("## Navigation\n")
        lines.append(record["nav_text"] + "\n")

    if record.get("breadcrumb_text"):
        lines.append("## Breadcrumb\n")
        lines.append(record["breadcrumb_text"] + "\n")

    if record.get("headings"):
        lines.append("## Headings\n")
        for level, items in record["headings"].items():
            lines.append(f"- **{level}:** {' / '.join(items)}")
        lines.append("")

    lines.append("## Main Content\n")
    lines.append((record.get("clean_main_text") or "") + "\n")

    internal_links = record.get("internal_links", [])
    if internal_links:
        lines.append(f"## Internal Links ({len(internal_links)}개)\n")
        for text, path in internal_links[:30]:
            lines.append(f"- [{text}]({path})")
        lines.append("")

    external_links = record.get("external_links", [])
    if external_links:
        lines.append(f"## External Links ({len(external_links)}개)\n")
        for text, href in external_links[:20]:
            lines.append(f"- [{text}]({href})")
        lines.append("")

    buttons = record.get("buttons", [])
    if buttons:
        lines.append("## Buttons / CTAs\n")
        for btn in buttons:
            lines.append(f'- "{btn}"')
        lines.append("")

    forms_info = record.get("forms", [])
    if forms_info:
        lines.append("## Forms\n")
        for f in forms_info:
            lines.append(f"- `{f['method']}` {f['action']} — {f['fields']}개 필드")
            if f.get("field_names"):
                lines.append(f"  Fields: {', '.join(str(n) for n in f['field_names'] if n)}")
        lines.append("")

    images = record.get("images", [])
    if images:
        lines.append("## Images\n")
        for img in images[:30]:
            alt = img.get("alt") or "(no alt)"
            src = img.get("url", "")
            lines.append(f'- "{alt}" → {src}')
        lines.append("")

    if record.get("footer_text"):
        lines.append("## Footer\n")
        lines.append(record["footer_text"] + "\n")

    return "\n".join(lines)


def generate_pages_index(pages_data: list, base_url: str, pages_dir: str) -> str:
    """pages/_index.md — 전체 페이지 평면 목록"""
    lines = [
        "# 페이지 인덱스\n",
        f"**총 {len(pages_data)}개 페이지** | 수집 완료 {datetime.now().strftime('%Y-%m-%d')}\n",
        "| # | 경로 | 제목 | depth | 단어수 |",
        "|---|------|------|-------|--------|",
    ]
    for i, page in enumerate(pages_data, 1):
        path = urlparse(page["url"]).path or "/"
        title = (page.get("title") or "").replace("|", "｜")[:40]
        depth = url_depth(page["url"], base_url)
        # 파일 경로를 _index.md 기준 상대경로로
        fp = url_to_filepath(page["url"], base_url, pages_dir)
        rel = os.path.relpath(fp, pages_dir)
        word_count = len(
            BeautifulSoup(page.get("html", ""), "html.parser")
            .get_text().split()
        )
        lines.append(f"| {i} | [{path}](./{rel}) | {title} | {depth} | {word_count:,} |")
    return "\n".join(lines)


def generate_sitemap_tree(pages_data: list, base_url: str, pages_dir: str) -> str:
    """pages/_sitemap-tree.md — URL 계층 트리 시각화"""
    base_path = urlparse(base_url).path.rstrip("/")

    # depth별 정렬
    sorted_pages = sorted(
        pages_data,
        key=lambda p: urlparse(p["url"]).path
    )

    lines = ["# 사이트맵 트리\n"]
    for page in sorted_pages:
        path = urlparse(page["url"]).path.rstrip("/") or "/"
        rel = path[len(base_path):].lstrip("/") or "/"
        depth = url_depth(page["url"], base_url)
        indent = "  " * depth
        title = page.get("title") or rel
        fp = url_to_filepath(page["url"], base_url, pages_dir)
        rel_file = os.path.relpath(fp, pages_dir)
        lines.append(f"{indent}- [{title}](./{rel_file}) (`{path}`)")

    return "\n".join(lines)


def generate_pages_json(pages_data: list, base_url: str, pages_dir: str) -> str:
    """pages.json — 기계 판독용 페이지 메타 + 부모/자식 관계"""
    # URL → 인덱스 맵 (자식 관계 계산용)
    url_set = {p["url"] for p in pages_data}

    records = []
    for page in pages_data:
        parsed = urlparse(page["url"])
        path = parsed.path.rstrip("/") or "/"
        segments = [s for s in path.split("/") if s]
        parent_path = "/" + "/".join(segments[:-1]) if segments else None

        # 부모 URL 추정
        if parent_path and parent_path != path:
            parent_url = urlparse(base_url)._replace(path=parent_path).geturl()
            parent = parent_url if parent_url in url_set else None
        else:
            parent = None

        # 자식 URL
        children = [
            p["url"] for p in pages_data
            if urlparse(p["url"]).path.rstrip("/").rsplit("/", 1)[0] == path
            and p["url"] != page["url"]
        ]

        fp = url_to_filepath(page["url"], base_url, pages_dir)
        rel_file = os.path.relpath(fp, os.path.dirname(pages_dir))

        soup = BeautifulSoup(page.get("html", ""), "html.parser")
        for tag in soup(["script", "style"]):
            tag.decompose()
        word_count = len(soup.get_text().split())

        records.append({
            "url": page["url"],
            "file": rel_file.replace(os.sep, "/"),
            "title": page.get("title", ""),
            "description": page.get("description", ""),
            "status": page.get("status", 0),
            "depth": url_depth(page["url"], base_url),
            "word_count": word_count,
            "load_time_ms": page.get("load_time_ms", 0),
            "parent": parent,
            "children": children,
        })

    return json.dumps({
        "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "base_url": base_url,
        "total_pages": len(records),
        "pages": records,
    }, ensure_ascii=False, indent=2)


# ============================================================
# 리포트 생성 함수들
# ============================================================
def generate_site_structure_md(pages_data: list, url: str) -> str:
    md = f"""# 사이트 구조 분석

**분석 대상:** {url}
**분석 일시:** {datetime.now().strftime('%Y년 %m월 %d일 %H:%M')}

## 전체 페이지 목록 ({len(pages_data)}개)

| # | URL | 제목 | 상태 | 응답시간 |
|---|-----|------|------|---------|
"""
    for i, page in enumerate(pages_data, 1):
        title = page["title"][:40] if page["title"] else "(제목 없음)"
        md += f"| {i} | {page['url']} | {title} | {page['status']} | {page['load_time_ms']}ms |\n"

    md += "\n## 페이지별 heading 구조\n\n"
    for page in pages_data[:20]:
        md += f"### {page['title'] or page['url']}\n"
        if page["h1"]:
            md += f"- **H1:** {', '.join(page['h1'])}\n"
        if page["h2"]:
            md += f"- **H2:** {', '.join(page['h2'][:5])}\n"
        md += "\n"

    return md


def generate_tech_stack_md(tech_stack: dict, url: str) -> str:
    md = f"""# 기술 스택 분석 결과

**분석 대상:** {url}
**분석 일시:** {datetime.now().strftime('%Y년 %m월 %d일 %H:%M')}

## 탐지된 기술 스택

| 카테고리 | 탐지 결과 |
|----------|-----------|
"""
    for category, result in tech_stack.items():
        if isinstance(result, list):
            md += f"| {category} | {', '.join(result)} |\n"
        else:
            md += f"| {category} | {result} |\n"

    return md


def generate_design_tokens_md(design: dict, url: str) -> str:
    md = f"""# 디자인 시스템 분석

**분석 대상:** {url}
**분석 일시:** {datetime.now().strftime('%Y년 %m월 %d일 %H:%M')}

## 🎨 컬러 시스템

### CSS 변수 기반 컬러

| 변수명 | 값 | 추정 용도 |
|--------|-----|----------|
"""
    for var, color in design["css_variables"].items():
        purpose = "메인 컬러" if "primary" in var else \
                  "포인트 컬러" if ("accent" in var or "point" in var) else \
                  "배경" if "bg" in var or "background" in var else \
                  "텍스트" if "text" in var or "font" in var else "보조 컬러"
        md += f"| `{var}` | `{color}` | {purpose} |\n"

    md += f"\n### Inline HEX 컬러 ({len(design['inline_colors'])}개)\n\n"
    for color in design["inline_colors"][:20]:
        md += f"- `{color}`\n"

    md += f"\n## 🔤 타이포그래피\n\n### 감지된 폰트\n\n"
    for font in design["fonts"]:
        md += f"- {font}\n"

    return md


def generate_content_inventory_md(content: dict, url: str) -> str:
    md = f"""# 콘텐츠 인벤토리

**분석 대상:** {url}
**수집 페이지:** {len(content['content_inventory'])}개
**수집 이미지:** {content['downloaded_count']}개

> 전체 본문은 각 페이지 링크를 클릭하여 확인하세요. 여기서는 미리보기만 제공합니다.

---

"""
    for item in content["content_inventory"]:
        title = item["title"] or item["url"]
        pages_file = item.get("pages_file", "")
        link = f"[{title}](./{pages_file})" if pages_file else title

        md += f"## {link}\n\n"
        md += f"**URL:** {item['url']}\n\n"

        preview = item["sections"].get("main", "").strip()
        if preview:
            # 미리보기 3줄 or 300자
            preview_lines = preview.splitlines()
            short = "\n".join(preview_lines[:3])
            if len(short) > 300:
                short = short[:300] + "…"
            short_quoted = short.replace(chr(10), "  \n> ")
            md += f"> {short_quoted}\n\n"

        if item["sections"].get("buttons"):
            md += f"**CTA:** {', '.join(item['sections']['buttons'][:8])}\n\n"

        if pages_file:
            md += f"→ 전문 보기: [{pages_file}](./{pages_file})\n\n"

        md += "---\n\n"

    return md


def generate_interaction_md(interactive: dict, url: str) -> str:
    md = f"""# 인터랙티브 요소 분석

**분석 대상:** {url}
**분석 일시:** {datetime.now().strftime('%Y년 %m월 %d일 %H:%M')}

## 감지된 동적 요소

| 요소 유형 | 수량 |
|-----------|------|
| 슬라이더/캐러셀 | {interactive['슬라이더_캐러셀']}개 페이지 |
| 탭 | {interactive['탭']}개 |
| 모달 트리거 (data-toggle + JS after_on 등) | {interactive['모달_트리거']}개 |
| 숨김 모달 콘텐츠 블록 | {len(interactive.get('숨김_모달_콘텐츠', []))}개 |
| 비디오/iframe | {interactive['비디오']}개 |
| 폼 | {len(interactive['폼'])}개 |

> ⚠️ **모달 트리거가 0이 아니면** 핵심 콘텐츠가 JS 모달 안에 있을 수 있습니다. 추출된 모달 본문은 `pages/_modals.md`를 확인하세요(정적 본문 추출이 놓치는 영역).

## 애니메이션 라이브러리

{', '.join(interactive['애니메이션_라이브러리']) if interactive['애니메이션_라이브러리'] else '감지되지 않음'}

## 폼 상세

"""
    for form in interactive["폼"][:10]:
        md += f"- **{form['page']}** — `{form['method']}` {form['action']} ({form['fields']}개 필드)\n"

    return md


def generate_modals_md(interactive: dict, url: str) -> str:
    """추출한 숨김/JS 모달 콘텐츠를 마크다운으로 정리.
    정적 본문 추출이 버리는 display:none 모달을 복구해 AI 분석에 제공한다."""
    blocks = interactive.get("숨김_모달_콘텐츠", [])
    md = f"""# 숨김/JS 모달 콘텐츠

**분석 대상:** {url}
**추출 블록:** {len(blocks)}개

> 정적 본문 추출(trafilatura)은 `display:none` 모달을 제외하고, 표준 `data-toggle` 외 커스텀 JS 트리거(`after_on()` 등)는 인터랙션 집계에서 누락됩니다.
> 그러나 모달 콘텐츠는 서버 렌더되어 HTML에 존재하므로 여기서 복구합니다. **핵심 콘텐츠가 모달에 집약된 사이트는 이 파일이 1차 콘텐츠 소스입니다.**

---

"""
    if not blocks:
        md += "_추출된 모달 콘텐츠가 없습니다._\n"
        return md

    for i, blk in enumerate(blocks, 1):
        md += f"## {i}. {blk['title']}\n\n"
        md += f"**출처 페이지:** {blk.get('page', '')}  \n"
        md += f"**컨테이너:** `{blk['id']}`  \n"
        md += f"**분량:** 약 {blk['words']}단어\n\n"
        md += blk["text"].strip() + "\n\n---\n\n"

    return md


# ============================================================
# 메인 실행
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="웹사이트 리뉴얼 분석 스크립트")
    parser.add_argument("url", help="분석할 웹사이트 URL")
    parser.add_argument(
        "--no-pages",
        action="store_true",
        default=False,
        help="pages/ 개별 페이지 파일 저장 비활성화",
    )
    parser.add_argument(
        "--no-trafilatura",
        action="store_true",
        default=False,
        help="trafilatura 본문 추출 비활성화 (BS4 fallback 전용)",
    )
    parser.add_argument(
        "--no-boilerplate",
        action="store_true",
        default=False,
        help="전 페이지 기준 boilerplate 자동 감지 비활성화",
    )
    args = parser.parse_args()

    url = args.url.rstrip("/")
    if not url.startswith("http"):
        url = "https://" + url
    save_pages = not args.no_pages
    use_trafilatura = not args.no_trafilatura
    detect_bp = not args.no_boilerplate

    site_name = get_site_name(url)
    output_dir = ensure_dirs(site_name)

    print(f"\n{'🚀' * 20}")
    print(f"  웹사이트 리뉴얼 분석 시작")
    print(f"  대상: {url}")
    print(f"  출력: {output_dir}")
    print(f"{'🚀' * 20}\n")

    start_time = time.time()

    # Phase 1
    access = phase1_check_access(url)
    if not access["accessible"]:
        print("\n❌ 사이트에 접근할 수 없습니다. 분석을 중단합니다.")
        sys.exit(1)

    # Phase 2
    tech_stack = phase2_detect_tech(url, access["html"])

    # Phase 3
    pages_data = phase3_crawl_pages(url, access.get("disallowed_paths", []))

    # Phase 4
    content = phase4_collect_content(
        pages_data, url, output_dir,
        save_pages=save_pages,
        use_trafilatura=use_trafilatura,
        detect_boilerplate_flag=detect_bp,
    )

    # Phase 5
    design = phase5_design_tokens(pages_data, url)

    # Phase 6
    interactive = phase6_interactive(pages_data)

    # 리포트 저장
    print("\n" + "=" * 60)
    print("📄 리포트 파일 저장")
    print("=" * 60)

    save_md(output_dir, "01-site-structure.md", generate_site_structure_md(pages_data, url))
    save_md(output_dir, "02-tech-stack.md", generate_tech_stack_md(tech_stack, url))
    save_md(output_dir, "03-design-tokens.md", generate_design_tokens_md(design, url))
    save_md(output_dir, "04-content-inventory.md", generate_content_inventory_md(content, url))
    save_md(output_dir, "06-interaction.md", generate_interaction_md(interactive, url))

    # 숨김/JS 모달 콘텐츠 복구 저장 (정적 추출 맹점 보완)
    modal_blocks = interactive.get("숨김_모달_콘텐츠", [])
    if modal_blocks:
        pages_dir = os.path.join(output_dir, "pages")
        os.makedirs(pages_dir, exist_ok=True)
        with open(os.path.join(pages_dir, "_modals.md"), "w", encoding="utf-8") as f:
            f.write(generate_modals_md(interactive, url))
        print(f"  ✅ pages/_modals.md 저장 완료 ({len(modal_blocks)}개 블록)")

    # pages/ 인덱스 파일 생성
    if save_pages:
        pages_dir = os.path.join(output_dir, "pages")
        print(f"\n  📁 pages/ 인덱스 파일 생성 중...")

        index_md = generate_pages_index(pages_data, url, pages_dir)
        with open(os.path.join(pages_dir, "_index.md"), "w", encoding="utf-8") as f:
            f.write(index_md)
        print("  ✅ pages/_index.md 저장 완료")

        tree_md = generate_sitemap_tree(pages_data, url, pages_dir)
        with open(os.path.join(pages_dir, "_sitemap-tree.md"), "w", encoding="utf-8") as f:
            f.write(tree_md)
        print("  ✅ pages/_sitemap-tree.md 저장 완료")

        pages_json_str = generate_pages_json(pages_data, url, pages_dir)
        with open(os.path.join(output_dir, "pages.json"), "w", encoding="utf-8") as f:
            f.write(pages_json_str)
        print("  ✅ pages.json 저장 완료")

    # 완료 요약
    elapsed = round(time.time() - start_time)
    minutes = elapsed // 60
    seconds = elapsed % 60

    summary = {
        "url": url,
        "site_name": site_name,
        "pages_found": len(pages_data),
        "images_downloaded": content["downloaded_count"],
        "tech_stack_items": len(tech_stack),
        "css_colors": len(design["css_variables"]),
        "fonts": design["fonts"],
        "modal_triggers": interactive.get("모달_트리거", 0),
        "modal_content_blocks": len(interactive.get("숨김_모달_콘텐츠", [])),
        "elapsed": f"{minutes}분 {seconds}초",
    }

    summary_md = f"""# 분석 요약

**분석 대상:** {url}
**분석 일시:** {datetime.now().strftime('%Y년 %m월 %d일 %H:%M')}
**소요 시간:** {summary['elapsed']}

| 항목 | 결과 |
|------|------|
| 발견 페이지 | {summary['pages_found']}개 |
| 다운로드 이미지 | {summary['images_downloaded']}개 |
| 기술 스택 항목 | {summary['tech_stack_items']}개 |
| CSS 변수 컬러 | {summary['css_colors']}개 |
| 감지 폰트 | {', '.join(summary['fonts'][:5]) if summary['fonts'] else '없음'} |
| 모달 트리거 | {summary['modal_triggers']}개 |
| 숨김 모달 콘텐츠 블록 | {summary['modal_content_blocks']}개 |

> ⚠️ Phase 7 (AI 종합 분석)과 Phase 8 (최종 리포트)은 Antigravity에서 직접 수행합니다.
> {'🔎 **모달 콘텐츠 감지됨** — `pages/_modals.md`에 복구된 모달 본문이 있습니다. AI 분석 시 1차 콘텐츠 소스로 반드시 포함하세요.' if summary['modal_content_blocks'] else ''}
"""

    save_md(output_dir, "00-summary.md", summary_md)

    # JSON 요약 (Antigravity가 읽을 수 있도록)
    with open(os.path.join(output_dir, "analysis_data.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n{'🎉' * 20}")
    print(f"  Phase 1~6 자동 분석 완료!")
    print(f"  📁 결과: {output_dir}")
    print(f"  ⏱️ 소요 시간: {summary['elapsed']}")
    print(f"  → Phase 7~8은 Antigravity에서 AI 분석으로 진행됩니다.")
    print(f"{'🎉' * 20}")


if __name__ == "__main__":
    main()
