# 기능 기획안: 페이지별 전체 텍스트 저장 (사이트맵 기반 폴더 구조)

> **상태:** 구현 완료
> **작성일:** 2026-04-23
> **업데이트:** 2026-04-23 — 전체 확정 및 analyze_site.py v1.1 구현 완료
> **대상 버전:** analyze_site.py v1.1
> **관련 파일:** [scripts/analyze_site.py](../scripts/analyze_site.py) · [DESIGN.md](../DESIGN.md)

---

## 1. 배경 & 문제 정의

### 현재 동작 (Phase 4)

`analyze_site.py`는 페이지별 텍스트를 수집하지만 **모두 한 파일(`04-content-inventory.md`)에 합쳐서 저장**하며, 다음과 같이 **강하게 잘려 있음**:

| 영역 | 현재 제한 |
|------|-----------|
| `nav` | 500자 |
| `main` | 수집 3,000자 → 저장 시 **1,000자** ([analyze_site.py:366, 693](../scripts/analyze_site.py)) |
| `buttons` | 20개 |
| `footer` | 500자 |

### 문제점

- **원문 유실**: 리뉴얼 카피라이팅 시 원본 텍스트를 그대로 참조해야 하는데, 1,000자에서 잘려서 뒷부분 콘텐츠가 사라짐
- **탐색 어려움**: 수백 페이지 텍스트가 한 파일에 섞여 있어 특정 페이지를 빠르게 찾기 어려움
- **구조 유실**: URL 계층(사이트맵)이 평면화되어 정보 아키텍처가 사라짐

### 사용자 요구사항

> "웹사이트의 모든 페이지의 텍스트까지 저장되면 좋을거 같아, 정렬방식은 사이트맵 기준으로 폴더화"

- ✅ 페이지별 **전체 텍스트** 저장 (잘림 없음)
- ✅ **사이트맵 계층 = 폴더 계층**
- ✅ 기존 `04-content-inventory.md` 요약 기능은 유지(보완 관계)

---

## 2. 제안 기능 개요

`output/{site}/pages/` 디렉토리를 신설하고, **각 URL을 경로 기반 폴더로 매핑한 개별 `.md` 파일**에 페이지 전체 텍스트를 저장합니다.

### 출력 구조 예시

**분석 대상:** `https://example.com/about/team/john`

```
output/example_com/
├── 00-summary.md
├── 01-site-structure.md
├── ... (기존 리포트)
├── 04-content-inventory.md      ← 기존 요약(유지)
├── pages/                        ← NEW
│   ├── _index.md                 ← 페이지 인덱스 (전체 목록)
│   ├── _sitemap-tree.md          ← 시각적 트리 구조
│   ├── index.md                  ← 홈 (/)
│   ├── about/
│   │   ├── index.md              ← /about
│   │   └── team/
│   │       ├── index.md          ← /about/team
│   │       └── john.md           ← /about/team/john
│   ├── products/
│   │   ├── index.md
│   │   └── item-123.md
│   └── blog/
│       ├── index.md
│       └── 2026-03-15-hello.md
├── screenshots/
└── assets/
```

---

## 3. 상세 스펙

### 3.1 URL → 파일 경로 매핑 규칙

| URL 패턴 | 저장 경로 |
|----------|-----------|
| `/` | `pages/index.md` |
| `/about` or `/about/` | `pages/about/index.md` |
| `/about/team` | `pages/about/team/index.md` |
| `/about/team/john` | `pages/about/team/john.md` |
| `/products/item-1.html` | `pages/products/item-1.md` (확장자 변환) |
| `/blog?page=2` | `pages/blog/index__page-2.md` (쿼리스트링은 파일명 접미사) |
| `/카테고리/한글` | `pages/category/hangeul.md` (**slugify: 영숫자 변환**) |

**규칙 요약:**
1. 끝이 `/`이거나 경로만 있으면 → `.../index.md`
2. 리프 세그먼트가 파일처럼 보이면 → `segment.md`
3. `?query=x` → 파일명에 `__` 구분자로 안전하게 직렬화
4. 특수문자(`?`, `&`, `:`, `*`, `"`, `<`, `>`, `|`)는 `-`로 치환
5. 파일명 길이 100자 제한, 초과 시 MD5 해시 접미사
6. **한글/비ASCII 문자는 slugify로 영숫자 변환** (예: `팀소개` → `team-sogae` 또는 `hangul-<md5>`)
   - 원본 URL은 frontmatter `url:` 필드에 보존되므로 정보 손실 없음

### 3.2 각 페이지 `.md` 파일 포맷

```markdown
---
url: https://example.com/about/team/john
title: 팀 소개 - John Doe
description: John Doe 팀장 소개 페이지
status: 200
depth: 3
crawled_at: 2026-04-23T14:30:00+09:00
load_time_ms: 342
word_count: 1847
---

# 팀 소개 - John Doe

> `https://example.com/about/team/john`

## Navigation

Home | About | Products | Contact

## Breadcrumb

Home > About > Team > John Doe

## Headings

- **H1:** John Doe, CEO
- **H2:** 약력, 비전, 연락처
- **H3:** 2020년 입사, 2023년 승진

## Main Content

(페이지 본문 전체 텍스트 — 잘림 없이 원문 그대로)

## Links (내부/외부 분리)

**내부 링크 (12개):**
- [팀 전체 보기](/about/team) → /about/team
- ...

**외부 링크 (3개):**
- [LinkedIn](https://linkedin.com/in/john) 
- ...

## Buttons / CTAs

- "문의하기"
- "이력서 다운로드"

## Forms

(폼이 있는 경우: action, method, 필드 목록)

## Images (alt 텍스트만)

- "John Doe 프로필 사진" → /assets/images/abc123.jpg
- ...

## Footer

(푸터 전체 텍스트)

---

## Raw Text (정제된 본문만)

(스크립트/스타일 제외한 순수 텍스트 블록)
```

**설계 포인트:**
- **Frontmatter**: 정적 사이트 생성기(Jekyll/Hugo 등)와 호환 + 프로그램이 쉽게 파싱
- **구조 + 원문**: 요약된 섹션과 원문(Raw Text)을 모두 담아 용도별로 활용
- **링크 분리**: 내부/외부 구분으로 사이트 내부 관계 분석 용이

### 3.3 인덱스 파일

#### `pages/_index.md` (평면 목록)

```markdown
# 페이지 인덱스

**총 87개 페이지** | 수집 완료 2026-04-23

| # | 경로 | 제목 | depth | 단어수 |
|---|------|------|-------|--------|
| 1 | [/](./index.md) | 홈 | 0 | 452 |
| 2 | [/about](./about/index.md) | 회사소개 | 1 | 1,203 |
| 3 | [/about/team](./about/team/index.md) | 팀 | 2 | 321 |
| 4 | [/about/team/john](./about/team/john.md) | John Doe | 3 | 1,847 |
...
```

#### `pages/_sitemap-tree.md` (시각 트리)

```markdown
# 사이트맵 트리

- [홈](./index.md) (/)
  - [회사소개](./about/index.md) (/about)
    - [팀](./about/team/index.md) (/about/team)
      - [John Doe](./about/team/john.md) (/about/team/john)
      - [Jane Smith](./about/team/jane.md) (/about/team/jane)
  - [제품](./products/index.md) (/products)
    - [제품 A](./products/item-a.md) (/products/item-a)
  - [블로그](./blog/index.md) (/blog)
```

---

## 4. 구현 변경점

### 4.1 신규 함수 (analyze_site.py)

```python
def url_to_filepath(page_url: str, base_url: str, pages_dir: str) -> str:
    """URL을 pages/ 하위 파일 경로로 변환"""
    # 3.1 규칙 구현

def generate_page_md(page: dict, content: dict, images: list) -> str:
    """개별 페이지 .md 파일 생성 (frontmatter + 전체 텍스트)"""
    # 3.2 포맷 구현

def generate_pages_index(pages_data: list, pages_dir: str) -> str:
    """_index.md 생성"""

def generate_sitemap_tree(pages_data: list) -> str:
    """_sitemap-tree.md 생성"""
```

### 4.2 기존 함수 수정

- **`ensure_dirs`**: `pages/` 디렉토리 추가
- **`phase4_collect_content`**: 
  - `main` 텍스트 수집 시 현재 3,000자 제한 → **완전 해제 (무제한)**
  - `[:1000]` 슬라이스도 제거 → 원문 그대로 개별 파일에 저장
  - 각 페이지 순회 시 `generate_page_md()` 호출하여 개별 파일 저장
- **`main()`**: Phase 4 이후 인덱스 파일 2개 생성 단계 추가

### 4.3 설정 추가

```python
# 상수 추가
SAVE_INDIVIDUAL_PAGES = True       # 개별 페이지 저장 (기본 on)
MAX_PAGE_TEXT_LENGTH = 0           # 페이지당 본문 상한 (0 = 무제한, 확정)
PAGE_FILENAME_MAX_LENGTH = 100     # 파일명 최대 길이
SLUGIFY_NON_ASCII = True           # 비ASCII 파일명 영숫자 변환 (확정)
```

CLI 옵트아웃 플래그: `--no-pages` (끄고 싶을 때만 명시).

---

## 5. 엣지 케이스 & 결정 필요 항목

| # | 이슈 | 제안 |
|---|------|------|
| 1 | 같은 경로에 자식과 자기 자신이 둘 다 존재 (`/about`와 `/about/team`) | `index.md` 패턴으로 자연 해결 |
| 2 | 쿼리스트링이 내용을 좌우 (`?id=123`) | 파일명에 `__key-value` 형식으로 직렬화 |
| 3 | 해시 프래그먼트(`#section`) | **무시** (같은 문서 내 앵커) |
| 4 | 한글 URL 처리 | **slugify로 영숫자 변환** (확정), 원본은 frontmatter `url:`에 보존 |
| 5 | 대소문자 구분 (macOS/Windows 파일시스템) | 소문자로 정규화 |
| 6 | 파일명 충돌 (`/foo` vs `/Foo`) | 소문자 변환 + 충돌 시 해시 접미사 |
| 7 | HTML 제외 자산 (이미지/PDF 등)에 경로가 중복될 때 | 이미 Phase 3에서 필터링됨 |
| 8 | 너무 깊은 경로 (depth 10+) | 경로 그대로 유지 (사용자가 원본 구조 보고 싶어할 것) |
| 9 | 기존 `04-content-inventory.md` 유지 여부 | **유지** (빠른 요약 용도, 개별 파일은 심층 분석 용도) |
| 10 | 다시 실행 시 기존 `pages/` 덮어쓰기 | 덮어쓰기 (현재 다른 파일도 동일 동작) |

---

## 6. 기대 효과

- ✅ **원문 완전 보존** → 리뉴얼 시 카피 재활용·비교 가능
- ✅ **사이트맵 직관 탐색** → 파일 탐색기로 구조 이해 즉시 가능
- ✅ **grep 친화적** → 특정 키워드 포함 페이지 빠르게 찾기
- ✅ **정적 사이트 생성기 호환** → frontmatter 기반 재가공 용이
- ✅ **AI 분석 개선** → Phase 7에서 페이지별 깊이 있는 분석 가능

---

## 7. 리스크 & 트레이드오프

| 리스크 | 영향도 | 대응 |
|--------|--------|------|
| 출력 용량 증가 (100페이지 × 50KB = 5MB) | 낮음 | 텍스트이므로 용량 부담 미미 |
| 파일 수 폭증 (100~200 파일) | 낮음 | 폴더 구조화로 정리됨 |
| 실행 시간 증가 | 매우 낮음 | 파일 쓰기 I/O만 추가 (네트워크 미발생) |
| Windows 경로 길이 260자 제한 | 중간 | 긴 파일명 100자 제한 + 해시로 대응 |
| 파일명 특수문자 이슈 | 중간 | 화이트리스트 방식 치환 규칙 엄격 적용 |

---

## 8. 작업 분할 (구현 시)

1. **Phase A**: 파일 경로 매핑 헬퍼 + 단위 테스트 (1~2h)
2. **Phase B**: `generate_page_md` 템플릿 작성 + `phase4` 통합 (2~3h)
3. **Phase C**: 인덱스/사이트맵 트리 생성 함수 (1h)
4. **Phase D**: 엣지 케이스 처리(쿼리스트링, 한글, 충돌) (1~2h)
5. **Phase E**: DESIGN.md 업데이트 + 기존 출력(`damha_co_kr`) 재생성 검증 (30m)

**예상 총 소요**: 5~8시간

---

## 9. 검토 요청 항목

### 1차 검토 확정 (2026-04-23)

- [x] **Q3.** 본문 텍스트 **완전 무제한** 저장
- [x] **Q5.** 파일명 **slugify (영숫자 변환)**, 원본 URL은 frontmatter 보존
- [x] **Q6.** **기본 on**, `--no-pages`로 옵트아웃

### 전체 확정 및 구현 완료 (2026-04-23)

- [x] **Q1.** 파일 경로 매핑 규칙 — 제안 그대로 구현 (`index.md` 패턴, slugify)
- [x] **Q2.** 포맷 — `lang`, `canonical`, `og_image` frontmatter 추가 / "Raw Text" 섹션 제거
- [x] **Q4.** `04-content-inventory.md` — 미리보기(300자) + pages/ 링크 포털로 축소
- [x] **Q7.** `pages.json` — 부모/자식 관계 포함 기계 판독용 메타 파일 생성
