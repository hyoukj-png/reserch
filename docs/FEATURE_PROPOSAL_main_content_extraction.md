---
title: analyze_site.py v1.2 / v1.3 통합 확정안 v3
status: 확정 (구현 대기)
date: 2026-04-23
target: analyze_site.py v1.2 (본문 품질), v1.3 (파일 구조)
supersedes:
  - FEATURE_PROPOSAL_main_content_extraction_v2.md
related:
  - [FEATURE_PROPOSAL_pages_text.md](./FEATURE_PROPOSAL_pages_text.md)
---

# analyze_site.py v1.2 / v1.3 통합 확정안 v3

이 문서는 v2 의 **엔지니어링 관점(안전한 변경 순서)** 과 v1 의 **제품 스펙 상세도** 를 통합한 최종안이다.

---

## 0. 문서 통합 원칙

- **v1.2 는 "본문 품질" 만 바꾼다** — 출력 경로/파일 규칙은 건드리지 않음 (v2 철학)
- **v1.3 는 "파일 구조" 만 바꾼다** — 정제된 레코드를 입력으로 받아 배치만 변경 (v2 철학)
- **변경 종류를 섞지 않는다** — 회귀 원인 추적성 확보
- v1.3 의 폴더/이미지 규칙은 이미 사용자 확정 사항이므로 **v1 에서 합의된 세부 스펙 유지**

---

## 1. 현재 상태 (v1.1 기준선)

`scripts/analyze_site.py` 에 이미 구현된 기능:

- `pages/` 개별 페이지 저장
- `pages/_index.md`, `pages/_sitemap-tree.md`, `pages.json`
- `assets/images/` 중앙 저장
- URL slug 기반 파일명

주요 코드 위치:
- `phase4_collect_content()`: [scripts/analyze_site.py:341](../scripts/analyze_site.py#L341)
- `generate_page_md()`: [scripts/analyze_site.py:680](../scripts/analyze_site.py#L680)
- `url_to_filepath()`: [scripts/analyze_site.py:637](../scripts/analyze_site.py#L637)
- `generate_pages_index()`: [scripts/analyze_site.py:846](../scripts/analyze_site.py#L846)
- `generate_sitemap_tree()`: [scripts/analyze_site.py:869](../scripts/analyze_site.py#L869)

이번 작업은 **신규 구축이 아닌 리팩토링 마이그레이션** 이다.

---

## 2. 릴리스 구분

| 릴리스 | 변경 종류 | 범위 |
|--------|-----------|------|
| **v1.2** | 내용 품질 | 본문 추출 파이프라인만 바꾼다. 출력 경로/파일 규칙 불변 |
| **v1.3** | 파일 구조 | 메뉴 기반 폴더 + 페이지별 이미지. 본문 추출 로직 불변 |

**v1.2 에 포함:**
- trafilatura 기반 본문 추출 도입
- BS4 fallback 유지 + 개선 (`strip_noise`, `find_main_content`)
- boilerplate 제거 3-pass 도입
- `phase4_collect_content()` 3-pass 재구성
- `generate_page_md()` 를 추출 함수 → **렌더링 함수** 로 축소
- `word_count` 기준을 `clean_main_text` 로 통일
- 최소 CLI 플래그 3개

**v1.2 에서 제외 (v1.3 로 이관):**
- 메뉴 기반 폴더 구조
- `assets/images/` 폐기
- 페이지별 `images/` 폴더
- `_orphan/` 구조
- 인덱스/사이트맵 트리 재작성

---

## 3. v1.2 상세 설계

### 3.1 핵심 아키텍처 변경

**현재 (v1.1):**
```
phase4 루프: HTML → 바로 .md 저장
generate_page_md: raw HTML 에서 다시 본문/링크/이미지/폼 재추출
```
→ 추출 기준이 두 군데로 갈림 (phase4 미리보기 vs generate_page_md 본문)

**v1.2:**
```
Pass 1. 표준화 레코드 생성 (모든 페이지)
  HTML → page_record {url, title, nav_text, footer_text, buttons,
                       forms, images, raw_main_text, main_text_candidate}

Pass 2. 전 페이지 기준 boilerplate 감지
  main_text_candidate 목록 → boilerplate set

Pass 3. 최종 본문 확정 + 저장
  clean_main_text, word_count, preview 계산
  page_record 완성 후 → generate_page_md() 렌더링 → .md 저장
  04-content-inventory.md 도 같은 기준으로 생성
```

**핵심 원칙:** 추출 기준을 한 곳(page_record)으로 통일.

### 3.2 본문 추출 함수

#### `extract_main_text(html, url)` — trafilatura 래퍼

```python
def extract_main_text(html: str, url: str = "") -> str:
    """trafilatura 로 본문만 추출. 없거나 실패하면 빈 문자열 반환."""
    if trafilatura is None:
        return ""
    try:
        text = trafilatura.extract(
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
```

#### `extract_main_text_with_fallback(html, url)` — 통합 진입점

```python
def extract_main_text_with_fallback(html: str, url: str = "") -> str:
    # 1. trafilatura 우선
    text = extract_main_text(html, url)
    if text and len(text) >= MIN_MAIN_LENGTH:
        return text

    # 2. BS4 + strip_noise + find_main (fallback)
    soup = BeautifulSoup(html, "html.parser")
    soup = strip_noise(soup)
    main_el = find_main_content(soup)
    return main_el.get_text(separator="\n", strip=True) if main_el else ""
```

**원칙:** fallback 은 백업. trafilatura 성공 시 그대로 채택, 너무 짧거나 비정상일 때만 fallback.

### 3.3 `strip_noise(soup)` — fallback 보조

```python
def strip_noise(soup: BeautifulSoup) -> BeautifulSoup:
    # 스크립트·스타일·미디어 컨테이너
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()

    # 의미 태그: nav/header/footer 전체 제거
    for tag in soup(["nav", "header", "footer"]):
        tag.decompose()
    # aside: sidebar/widget/advert 클래스일 때만 제거 (callout 보존)
    for el in soup.find_all("aside"):
        cls = " ".join(el.get("class", []))
        if re.search(r"sidebar|widget|advert", cls, re.I):
            el.decompose()

    # ARIA role
    for role in ["navigation", "banner", "contentinfo", "search"]:
        for el in soup.find_all(attrs={"role": role}):
            el.decompose()

    # class/id 패턴 blacklist (Hero/visual 화이트리스트)
    BLACKLIST = [
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
    HERO_WHITELIST = re.compile(r"\b(hero|visual|main-?visual|key-?visual|mv|kv)\b", re.I)
    combined = re.compile("|".join(BLACKLIST), re.I)

    for el in soup.find_all(class_=combined):
        if HERO_WHITELIST.search(" ".join(el.get("class", []))):
            continue
        el.decompose()
    for el in soup.find_all(id=combined):
        if HERO_WHITELIST.search(el.get("id", "")):
            continue
        el.decompose()

    return soup
```

### 3.4 `find_main_content(soup)` — fallback 2단계

```python
def find_main_content(soup) -> Tag | None:
    # 우선순위 1: 의미 셀렉터 (한국형 관용어 포함)
    for selector in ["main", "article", '[role="main"]',
                     "#content", "#contents", "#main", "#container",
                     ".content", ".contents", ".contents_area",
                     ".main", ".main-content", "#wrap .inner"]:
        el = soup.select_one(selector)
        if el and len(el.get_text(strip=True)) > 100:
            return el

    # 우선순위 2: 텍스트 밀도 스코어링
    return _highest_density_block(soup.body) if soup.body else None


def _highest_density_block(root):
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
```

### 3.5 boilerplate 제거 — 보수적

```python
def detect_boilerplate(all_texts: list[str], threshold: float = 0.6,
                       titles: set[str] = None) -> set[str]:
    """전 페이지 중 threshold 이상 반복되는 라인 = 공용 boilerplate"""
    from collections import Counter
    if len(all_texts) < 3:      # 3페이지 미만 스킵
        return set()
    counts = Counter()
    for text in all_texts:
        for ln in {ln.strip() for ln in text.split("\n") if len(ln.strip()) >= 4}:
            counts[ln] += 1
    min_n = max(2, int(len(all_texts) * threshold))
    bp = {ln for ln, c in counts.items() if c >= min_n}
    # 페이지 제목과 완전 일치하는 라인은 제거 대상 제외
    if titles:
        bp -= titles
    return bp


PAGINATION_LABELS = {"이전글", "다음글", "목록", "페이지 정보", "본문",
                     "검색", "프린트", "공유하기", "위로", "TOP", "Next", "Prev"}


def clean_extracted_text(text: str, boilerplate: set[str]) -> str:
    cleaned, prev = [], None
    for i, ln in enumerate(l.strip() for l in text.split("\n")):
        # 본문 첫 줄 가급적 보존 (짧지 않으면)
        if i == 0 and len(ln) >= 2:
            cleaned.append(ln)
            prev = ln
            continue
        if len(ln) < 2 or ln in PAGINATION_LABELS or ln in boilerplate:
            continue
        if ln == prev:
            continue
        cleaned.append(ln)
        prev = ln
    return "\n".join(cleaned)
```

**보수적 원칙:**
- 3페이지 미만이면 boilerplate 감지 미사용
- 4자 미만 라인 무시
- 60% 이상 반복만 처리
- 페이지 제목과 동일 라인 보존
- 본문 첫 줄 보존

### 3.6 `generate_page_md()` 책임 축소 — 렌더링 함수화

**이전 (v1.1):** HTML 을 받아 본문/링크/이미지/폼을 **재추출** 후 md 렌더링

**v1.2:**
```python
def generate_page_md(page_record: dict, base_url: str) -> str:
    """page_record 를 받아 md 로 렌더링만 한다. 추출 안 함."""
    # page_record 에는 이미 다음이 들어있음:
    # - clean_main_text, nav_text, breadcrumb_text, footer_text
    # - buttons, forms, images, internal_links, external_links
    # - word_count, headings, lang, canonical, og_image
    ...
```

추출 책임은 `phase4_collect_content()` Pass 1 에 일원화.

### 3.7 `word_count` 기준 통일

- **이전:** raw HTML 전체 텍스트 기준 (혼재)
- **v1.2:** `clean_main_text` 기준으로 통일

사용자 체감상 값이 줄어드는 것은 정상 — 실제 본문 밀도에 가까워짐.

### 3.8 설정 & 플래그 (v1.2)

```python
MIN_MAIN_LENGTH = 120
BOILERPLATE_THRESHOLD = 0.6
```

CLI (최소 3개):
```
--no-pages              # pages/ 생성 자체 끄기 (기존)
--no-trafilatura        # trafilatura 비활성화 (BS4 fallback only)
--no-boilerplate        # boilerplate 감지 끄기
```

**보류 (실수요 확인 후 추가):** `--keep-nav`, `--no-strip`

### 3.9 의존성 정책

`scripts/requirements.txt` 에 추가:
```
trafilatura>=1.12
```

**런타임 처리 (선택 의존성):**
```python
try:
    import trafilatura
except ImportError:
    trafilatura = None
    print("⚠️ trafilatura 미설치 — BS4 fallback 모드로 동작합니다.")
```

**원칙:**
- `requests`, `bs4`, `lxml` 만 강제 의존성 유지
- `trafilatura` 는 선택 의존성 — 없어도 스크립트 완전 동작
- 네트워크 제한 환경 / 다른 컴퓨터 초기 셋업에서도 깨지지 않음

### 3.10 v1.2 에서 바꾸지 않는 것 (명시)

- `pages/` 경로 규칙 유지
- `url_to_filepath()` 유지
- `assets/images/` 중앙 저장 유지
- `pages/_index.md`, `pages/_sitemap-tree.md`, `pages.json` 포맷 유지
- 이미지 다운로드 상한 정책 유지

위 항목은 **v1.3** 에서 일괄 변경.

---

## 4. v1.3 상세 설계

### 4.1 선행 조건

v1.2 가 완료되고 다음 검증이 통과되어야 진행:

1. `damha.co.kr` 에서 본문 잔여 noise 가 충분히 감소
2. `04-content-inventory.md` 와 `pages/*.md` 본문 기준 일치
3. 새 `word_count` 기준 합리적

### 4.2 목표 출력 구조

```
pages/
├── index.md                            ← 홈 (최상위 단독)
├── home-images/                        ← 홈 이미지
├── _index.md                           ← 전체 인덱스
├── _sitemap-tree.md                    ← 시각 트리
├── _menu-mapping.json                  ← 메뉴 → URL 매핑
├── pages.json                          ← 기계 판독용
│
├── 주요사업소개/
│   ├── index.md
│   └── images/
│
├── 포트폴리오/
│   ├── index.md
│   ├── images/
│   ├── 카페올스커피로고디자인/
│   │   ├── index.md
│   │   └── images/
│   └── 웰하이여성아동병원홈페이지/
│       ├── index.md
│       └── images/
│
└── _orphan/                            ← 메뉴 미매칭
    └── policy-privacy/
        └── index.md
```

**확정 규칙:**
- 모든 일반 페이지 = 독립 폴더 (`index.md` + `images/`)
- 홈(`/`) 예외: `pages/index.md` 최상위, 이미지는 `pages/home-images/`
- 폴더명 = 메뉴 텍스트 (한글 보존) 또는 H1 기반
- 충돌 시 `-2`, `-3` 접미사
- 메뉴 미매칭 = `_orphan/` 수집

### 4.3 메뉴 트리 구축

```python
def build_menu_tree(pages_data: list, base_url: str) -> dict:
    """url → {menu_label, parent_url, depth, is_menu}"""
    nav_links = {}

    # 첫 2~3개 페이지에서 nav 추출
    for page in pages_data[:3]:
        soup = BeautifulSoup(page["html"], "html.parser")
        nav_containers = soup.find_all(["nav", "header"]) + \
                         soup.find_all(class_=re.compile(r"gnb|lnb|menu|navigation", re.I))
        for nav in nav_containers:
            for a in nav.find_all("a", href=True):
                text = a.get_text(strip=True)
                if not text or len(text) > 30:
                    continue
                full_url = urljoin(page["url"], a["href"])
                nav_links.setdefault(full_url, text)

    # 중첩 <ul><li> → 부모-자식 트리 추론
    tree = _parse_nested_ul(nav_containers, base_url)

    # 크롤된 URL 을 트리에 매핑
    mapping = {}
    for page in pages_data:
        url = page["url"]
        if url in nav_links:
            mapping[url] = {"menu_label": nav_links[url], "is_menu": True}
        else:
            parent = _find_closest_menu_parent(url, nav_links)
            mapping[url] = {
                "menu_label": _derive_label_from_page(page),
                "parent_menu_url": parent,
                "is_menu": False,
            }
    return mapping
```

**Label 파생:** H1 → title 첫 세그먼트 → URL slug 순 fallback

### 4.4 폴더명 생성 규칙

```python
def menu_label_to_foldername(label: str, existing: set[str]) -> str:
    """메뉴명 → 파일시스템 안전 폴더명 (한글 보존)"""
    name = re.sub(r"\s+", "", label)
    name = re.sub(r'[/\\:*?"<>|]', "-", name)
    name = name.strip(". ")
    if len(name) > 50:
        name = name[:50].rstrip() + "-" + hashlib.md5(label.encode()).hexdigest()[:6]
    name = name or "untitled"
    if name in existing:
        for i in range(2, 100):
            candidate = f"{name}-{i}"
            if candidate not in existing:
                return candidate
    return name
```

| 메뉴명 | 폴더명 |
|--------|--------|
| `포트폴리오` | `포트폴리오` |
| `주요 사업 소개` | `주요사업소개` |
| `Q&A 게시판` | `Q-A게시판` |
| (중복) | `포트폴리오-2` |

### 4.5 페이지별 이미지 저장

**확정 규칙:**
- 각 페이지 폴더 내 `images/` 서브폴더
- 페이지의 `<img>` + OG 이미지 **전부** 저장 (**무제한**)
- md 이미지 참조는 **상대경로** (`./images/{md5}.{ext}`)
- 중복 이미지(공용 로고)는 각 페이지 폴더에 복사
- 네트워크는 URL 캐시로 1회만, 로컬은 복사 배포
- `assets/images/` 완전 폐기

```python
def download_page_images(page_url, images, page_folder, cache) -> list[dict]:
    images_dir = os.path.join(page_folder, "images")
    os.makedirs(images_dir, exist_ok=True)

    saved = []
    for img in images:   # 페이지당 무제한
        img_url = img["url"]
        if not img_url or not img_url.startswith("http"):
            continue
        ext = _infer_extension(img_url)
        filename = hashlib.md5(img_url.encode()).hexdigest()[:10] + "." + ext
        filepath = os.path.join(images_dir, filename)
        try:
            if img_url in cache:
                with open(filepath, "wb") as f:
                    f.write(cache[img_url])
            else:
                res = requests.get(img_url, timeout=10, headers=HEADERS, stream=True)
                if res.status_code != 200:
                    continue
                data = res.content
                cache[img_url] = data
                with open(filepath, "wb") as f:
                    f.write(data)
            saved.append({
                "url": img_url,
                "local_relpath": f"./images/{filename}",
                "alt": img.get("alt", ""),
            })
            time.sleep(0.2)
        except Exception:
            continue
    return saved
```

### 4.6 v1.3 설정 & 플래그

```python
USE_MENU_FOLDERS = True
IMAGES_PER_PAGE_DIR = True
MAX_IMAGES_PER_PAGE = 0       # 0 = 무제한
MAX_IMAGES_TOTAL = 0          # 0 = 무제한
SKIP_DUPLICATE_DOWNLOADS = True
PRESERVE_KOREAN_FOLDERNAMES = True
MENU_FOLDER_MAX_LENGTH = 50
```

CLI 플래그:
```
--ascii-foldernames     # 영문 slug 변환
--url-slug-folders      # 메뉴 기반 끄고 URL slug (v1.2 호환)
--shared-images         # 공용 이미지 _shared/ 통합
--legacy-assets         # assets/images/ 중앙 저장 (v1.2 호환)
```

---

## 5. 검증 계획

### 5.1 v1.2 검증

**단위 테스트** (`scripts/test_v12.py`)
- `extract_main_text_with_fallback`
- `strip_noise`
- `find_main_content`
- `detect_boilerplate`
- `clean_extracted_text`

**테스트 포인트:**
- `<main>` 없는 레거시 HTML
- 메뉴/푸터/prev-next 섞인 게시판형 HTML
- trafilatura 결과가 너무 짧은 경우
- 반복 라인 과다 제거 방지

**실사이트 회귀 (damha.co.kr, cheongnabit.com):**

성공 기준:
- [ ] `pages/*.md` 에서 이전글/다음글/공유하기/푸터 반복 문구 크게 감소
- [ ] `04-content-inventory.md` 미리보기와 개별 페이지 본문이 **같은 기준**
- [ ] `word_count` 감소가 노이즈 제거로 설명 가능
- [ ] trafilatura 미설치 환경에서도 스크립트 완전 동작

**수동 검수 샘플:**
- 포트폴리오 상세 3개
- 일반 소개 3개
- 게시판형 3개

### 5.2 v1.3 검증

- damha: 메뉴 5개 (주요사업소개/상품구성/핵심강점과경쟁력/주요마케팅타겟/포트폴리오) 폴더 생성
- damha: 포트폴리오 하위 상세 페이지 폴더 + 각 `images/` 존재
- cheongnabit: 좌측/상단 메뉴 양쪽 구조 추론
- 폴더 하나를 외부 복사 → md 이미지 정상 표시 (자기완결성)

---

## 6. 구현 순서

### v1.2 단계

1. **Step 1** — `trafilatura` 선택 import + fallback 함수 추가 (0.3h)
2. **Step 2** — `strip_noise` / `find_main_content` / `_highest_density_block` (1.5h)
3. **Step 3** — `detect_boilerplate` / `clean_extracted_text` (0.8h)
4. **Step 4** — `phase4_collect_content` 를 3-pass 구조로 재작성 (1.5h)
5. **Step 5** — `generate_page_md` 를 렌더링 함수로 축소 (1h)
6. **Step 6** — `word_count`, `content_inventory` 미리보기 기준 통일 (0.4h)
7. **Step 7** — CLI 플래그 3개 + 설정 상수 (0.3h)
8. **Step 8** — damha/cheongnabit 회귀 + 수동 검수 + 문서화 (1.2h)

**v1.2 총 예상: 7h**

### v1.3 단계

1. **Step H1** — `build_menu_tree` + `_parse_nested_ul` + 테스트 (2h)
2. **Step H2** — `menu_label_to_foldername` + `resolve_page_folder` (1h)
3. **Step H3** — `download_page_images` + `rewrite_img_paths_in_md` (1h)
4. **Step H4** — `phase4` 이미지 저장 경로 페이지별 이관 (1h)
5. **Step H5** — `generate_pages_index` / `generate_sitemap_tree` 재구성 (1h)
6. **Step H6** — `ensure_dirs` 변경 + `assets/images/` 제거 (0.3h)
7. **Step H7** — CLI 플래그 + 설정 상수 (0.3h)
8. **Step H8** — damha/cheongnabit 회귀 + 수동 검수 (1h)
9. **Step H9** — DESIGN.md / FEATURE_PROPOSAL 업데이트 (0.4h)

**v1.3 총 예상: 8h**

**전체 총 예상: 15h**

---

## 7. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| trafilatura 미설치 환경 | 중간 | 선택 의존성 + BS4 fallback-only 모드 |
| trafilatura 결과 이상 | 낮음 | `MIN_MAIN_LENGTH` 미달 시 fallback 자동 전환 |
| boilerplate 과제거 | 중간 | 3페이지 미만 스킵, 제목/첫 줄 보존, 60% 기준 |
| 메뉴 트리 추론 실패 (JS 렌더링) | 중간 | URL path fallback + `_orphan/` |
| 한글 폴더명 크로스플랫폼 | 낮음 | `--ascii-foldernames` 옵트인 |
| 이미지 중복 복사로 디스크 증가 | 낮음 | 로컬 프로젝트, Git 로컬 사용. 필요 시 `--shared-images` |
| 3-pass 메모리 증가 | 낮음 | 텍스트만 캐시, 100페이지 수십 MB |
| v1.2/v1.3 분리 진행 지연 | 낮음 | v1.2 단독 가치 충분 (본문 품질), v1.3 는 단계적 적용 |

---

## 8. 출력 덮어쓰기 정책

- **경고 프롬프트 없음** — 로컬 개발 프로젝트, Git 추적으로 충분
- 기존 `output/{site}/` 폴더 존재 시 바로 덮어쓰기
- 재실행 전 `pages/`, `assets/` 정리 로직만 추가
- 이 프로젝트는 GitHub 로 다른 장소/컴퓨터 셋업을 돕는 메인 로컬 도구 성격

---

## 9. 확정 결정 요약

### 설계 철학 (v2 통합)
- [x] **v1.2 는 내용 품질만**, 출력 구조 불변
- [x] **v1.3 는 파일 구조만**, 본문 로직 불변
- [x] **변경 종류 구분** — 회귀 추적성 확보
- [x] **3-pass 구조** — 레코드 생성 → 정제 → 저장
- [x] **`generate_page_md` 렌더링 함수화** — 추출 기준 한 곳 통일
- [x] **trafilatura 선택 의존성** — 미설치 시 fallback-only
- [x] **CLI 플래그 최소화** (v1.2 에 3개)
- [x] **`word_count` 기준 = `clean_main_text`**

### 본문 추출 (v1.2)
- [x] trafilatura 우선, BS4 fallback
- [x] `nav/header/footer` 전체 제거, `aside` 는 sidebar/widget/advert 만
- [x] 한국 관용어(gnb/lnb/snb) blacklist
- [x] Hero/visual 화이트리스트
- [x] boilerplate: 3페이지 미만 스킵, threshold 0.6, 제목/첫 줄 보존

### 파일 구조 (v1.3)
- [x] 모든 일반 페이지 = 폴더 (`index.md` 내부)
- [x] 홈 예외: `pages/index.md` 최상위
- [x] 상세 폴더명: H1 기반, 충돌 시 `-2/-3`
- [x] 한글 폴더명 보존 (기본)
- [x] 메뉴 미매칭: `_orphan/` 수집
- [x] 이미지: 페이지당 **무제한**, 페이지별 폴더 `images/`
- [x] `assets/images/` 완전 폐기
- [x] 중복 이미지: 페이지별 복사, 네트워크 캐시 1회

### 운영
- [x] 출력 덮어쓰기: 경고 없음, Git 추적으로 충분
- [x] 릴리스 분리: v1.2 먼저 → 안정화 후 v1.3

---

## 10. 다음 단계

v1.2 부터 착수. Step 1 ~ Step 8 순차 진행 후 회귀 검증 통과 시 v1.3 진입.
