---
title: analyze_site.py 개선 기획안 v2 (현재 코드 기준 재정의)
status: draft for review
date: 2026-04-23
target: scripts/analyze_site.py
related:
  - [FEATURE_PROPOSAL_main_content_extraction.md](./FEATURE_PROPOSAL_main_content_extraction.md)
  - [FEATURE_PROPOSAL_pages_text.md](./FEATURE_PROPOSAL_pages_text.md)
---

# analyze_site.py 개선 기획안 v2

이 문서는 기존 기획안을 대체하는 "새 기능 제안"이 아니라, 이미 구현된 v1.1 상태를 기준으로 다음 변경을 안전하게 쌓기 위한 **재정의 문서**다.

핵심은 세 가지다.

1. 본문 추출 품질을 올린다.
2. 현재 `pages/` 저장 구조를 깨지 않고 v1.2를 먼저 안정화한다.
3. 폴더 구조 변경과 이미지 저장 정책 변경은 v1.3로 분리한다.

---

## 1. 현재 상태 요약

현재 `scripts/analyze_site.py`에는 이미 아래 기능이 들어가 있다.

- `pages/` 개별 페이지 저장
- `pages/_index.md`
- `pages/_sitemap-tree.md`
- `pages.json`
- `assets/images/` 중앙 저장

즉, 이번 작업은 `pages/` 기능을 새로 만드는 일이 아니라, **기존 저장 파이프라인을 더 정확한 본문 추출과 더 나은 출력 구조로 마이그레이션하는 일**이다.

현재 기준 주요 코드 위치:

- `phase4_collect_content()`: [scripts/analyze_site.py](/Volumes/sub_ssd/Works/Antigravity/Research/scripts/analyze_site.py:341)
- `generate_page_md()`: [scripts/analyze_site.py](/Volumes/sub_ssd/Works/Antigravity/Research/scripts/analyze_site.py:680)
- `url_to_filepath()`: [scripts/analyze_site.py](/Volumes/sub_ssd/Works/Antigravity/Research/scripts/analyze_site.py:637)
- `generate_pages_index()`: [scripts/analyze_site.py](/Volumes/sub_ssd/Works/Antigravity/Research/scripts/analyze_site.py:846)
- `generate_sitemap_tree()`: [scripts/analyze_site.py](/Volumes/sub_ssd/Works/Antigravity/Research/scripts/analyze_site.py:869)

---

## 2. 기존 기획안의 문제

기존 문서의 방향은 좋지만, 현재 코드에 바로 적용하기엔 아래 문제가 있다.

### 2.1 현재 코드와 기준선이 다르다

문서는 `pages/` 저장과 인덱스 생성을 새로 만드는 것처럼 적혀 있지만, 이 기능은 이미 구현되어 있다.  
그래서 실제 구현 범위와 문서 범위가 어긋난다.

### 2.2 2-pass 정제 순서가 완전히 정의되지 않았다

boilerplate 제거는 전체 페이지를 한번 모은 뒤에 해야 한다.  
그런데 현재 저장 흐름은 각 페이지를 순회하면서 바로 `.md`를 쓴다.

이 상태에서 설계가 불완전하면 다음 문제가 생긴다.

- 정제 전 본문이 파일에 먼저 저장됨
- `04-content-inventory.md`와 `pages/*.md`의 본문 기준이 달라짐
- `word_count`가 어느 시점 기준인지 불명확해짐

### 2.3 `trafilatura` 추가만으로 끝나지 않는다

`requirements.txt` 업데이트만으로는 부족하다. 현재 스크립트는 자체 부트스트랩 로직이 있어 새 의존성 도입 시 실행 경로까지 같이 정리해야 한다.

### 2.4 v1.2와 v1.3 경계가 더 명확해야 한다

본문 추출 정확도 개선과 출력 구조 개편은 서로 다른 종류의 변경이다.

- v1.2는 "내용 품질" 변경
- v1.3는 "파일 구조" 변경

이 둘을 섞으면 회귀 원인 추적이 어려워진다.

---

## 3. 새 제안의 원칙

### 3.1 v1.2는 출력 구조를 바꾸지 않는다

v1.2에서는 아래를 유지한다.

- `pages/` 경로 규칙 유지
- `url_to_filepath()` 유지
- `assets/images/` 유지
- `pages/_index.md`, `pages/_sitemap-tree.md`, `pages.json` 유지

바꾸는 것은 오직 본문 추출 품질과 생성 순서다.

### 3.2 저장 전에 표준화된 페이지 레코드를 만든다

`generate_page_md()`가 raw HTML에서 직접 모든 것을 다시 추출하는 구조를 줄이고,  
`phase4_collect_content()`가 먼저 "정제된 페이지 레코드"를 만든 뒤 그것을 저장하도록 바꾼다.

즉:

- 지금: `HTML -> 루프 중간에 바로 .md 저장`
- 변경: `HTML -> 표준화 레코드 생성 -> 전체 정제 -> .md 저장`

### 3.3 v1.3는 파일 시스템 변경만 담당한다

메뉴 기반 폴더와 페이지별 이미지 저장은 v1.2가 안정화된 뒤 따로 진행한다.

---

## 4. 제안 범위

## 4.1 v1.2 범위

포함:

- `trafilatura` 기반 본문 추출 도입
- BS4 fallback 유지
- boilerplate 제거 2-pass 도입
- `phase4_collect_content()`와 `generate_page_md()` 책임 재정리
- 최소한의 CLI 플래그 추가
- 본문 기준 `word_count` 재정의

제외:

- 메뉴 기반 폴더 구조
- `assets/images/` 제거
- 페이지별 `images/` 폴더
- `_orphan/` 구조

## 4.2 v1.3 범위

포함:

- 메뉴 기반 폴더 구조
- 페이지별 이미지 저장
- 인덱스/사이트맵 생성 규칙 재작성

---

## 5. v1.2 상세 설계

## 5.1 새 처리 흐름

v1.2의 핵심은 `phase4_collect_content()`를 아래 순서로 바꾸는 것이다.

### Pass 1. 페이지별 기초 레코드 생성

각 페이지에 대해 아래 데이터를 먼저 만든다.

```python
{
    "url": ...,
    "title": ...,
    "status": ...,
    "html": ...,
    "nav_text": ...,
    "breadcrumb_text": ...,
    "footer_text": ...,
    "buttons": [...],
    "forms": [...],
    "images": [...],
    "raw_main_text": ...,
    "main_text_candidate": ...,
}
```

여기서 `main_text_candidate`는 `trafilatura -> BS4 fallback` 결과다.

### Pass 2. 전 페이지 기준 boilerplate 감지

`main_text_candidate` 목록 전체를 모아 공통 반복 라인을 감지한다.

### Pass 3. 페이지별 최종 본문 확정

각 페이지에서 아래를 계산한다.

- `clean_main_text`
- `word_count`
- `content_inventory_preview`
- 저장용 markdown 본문

이 단계가 끝난 뒤에만 개별 페이지 `.md`를 쓴다.

이렇게 하면 `04-content-inventory.md`, `pages/*.md`, `pages.json`이 같은 기준의 본문을 보게 된다.

## 5.2 본문 추출 함수

### `extract_main_text(html, url)`

역할:

- `trafilatura`가 있으면 우선 사용
- 없거나 실패하면 빈 문자열 반환

의도:

- 의존성 설치 실패가 전체 스크립트를 망치지 않게 함

예상 인터페이스:

```python
def extract_main_text(html: str, url: str = "") -> str:
    ...
```

### `extract_main_text_with_fallback(html, url)`

역할:

1. `trafilatura`
2. `strip_noise()`
3. `find_main_content()`

반환:

- 최종 후보 본문 문자열

## 5.3 fallback은 "백업"으로만 둔다

BS4 fallback이 `trafilatura`를 덮어쓰는 구조로 만들지 않는다.  
기본 원칙은 아래다.

- `trafilatura` 성공 시 그대로 채택
- 너무 짧거나 비정상일 때만 fallback 사용

판정 기준 초안:

```python
MIN_MAIN_LENGTH = 120
```

## 5.4 boilerplate 제거 규칙

`detect_boilerplate()`는 유지하되, 적용 범위를 보수적으로 둔다.

초기 규칙:

- 3페이지 미만이면 미사용
- 길이 4자 미만 라인은 무시
- 60% 이상 반복되는 라인만 boilerplate 처리

추가 원칙:

- 페이지 제목과 완전히 같은 라인은 boilerplate로 제거하지 않음
- 본문 첫 줄은 가능하면 보존

이 부분은 과제거가 가장 무서우므로 처음에는 보수적으로 간다.

## 5.5 `generate_page_md()` 책임 축소

현재 `generate_page_md()`는 raw HTML에서 다시 본문, 링크, 이미지, 폼을 재계산한다.  
v1.2에서는 이 함수를 "렌더링 함수"로 줄이는 것이 맞다.

권장 방향:

```python
def generate_page_md(page_record: dict, base_url: str) -> str:
    ...
```

즉, `page_record` 안에는 이미 아래 값이 들어 있어야 한다.

- `clean_main_text`
- `nav_text`
- `breadcrumb_text`
- `buttons`
- `forms`
- `images`
- `footer_text`
- `word_count`

이렇게 해야 추출 기준이 한 군데로 모인다.

## 5.6 `word_count` 기준 변경

현재는 raw HTML 전체 텍스트에 가까운 값이 섞여 있다.  
v1.2 이후에는 `word_count`를 `clean_main_text` 기준으로 통일한다.

이 값이 더 작아지는 것은 정상이다.  
오히려 사용자 입장에서는 "실제 본문 밀도"에 가까워진다.

---

## 6. 의존성 및 실행 정책

## 6.1 의존성 추가

[scripts/requirements.txt](/Volumes/sub_ssd/Works/Antigravity/Research/scripts/requirements.txt) 에 아래 추가:

```txt
trafilatura>=1.12
```

## 6.2 런타임 처리

현재 `scripts/analyze_site.py`는 import 실패 시 패키지를 설치하려고 한다.  
여기에 `trafilatura`를 같은 방식으로 얹기보다는, 아래 둘 중 하나로 정리하는 것이 낫다.

권장안:

- `requests`, `bs4`, `lxml`만 강제 의존성 유지
- `trafilatura`는 선택 의존성으로 import 시도
- 실패하면 경고 후 fallback-only 모드로 동작

이유:

- 문서/스크립트 사용자가 바로 실행했을 때 덜 깨진다
- 네트워크 제한 환경에서도 기능이 완전히 죽지 않는다

---

## 7. CLI 제안

플래그는 최소한으로 간다. 초기에 너무 많이 열어두면 테스트 표면만 넓어진다.

v1.2 제안:

```bash
--no-pages
--no-trafilatura
--no-boilerplate
```

보류:

- `--keep-nav`
- `--no-strip`

이 둘은 실제 사용 사례가 확인된 뒤 넣는 편이 낫다.

---

## 8. v1.3 예고 설계

v1.3는 아래 선행조건이 충족된 뒤 진행한다.

1. `damha.co.kr`에서 본문 잔여 noise가 충분히 줄었을 것
2. `04-content-inventory.md`와 `pages/*.md`의 본문 기준이 일치할 것
3. 새 `word_count` 기준이 납득 가능할 것

그 다음 아래를 진행한다.

- `url_to_filepath()`를 대체할 `resolve_page_folder()` 도입
- 메뉴 라벨 기반 폴더 구조
- 페이지별 `images/` 저장
- `assets/images/` 제거

즉, v1.3는 v1.2의 "정제된 페이지 레코드"를 입력으로 받아 파일 구조만 바꾸는 작업이 되어야 한다.

---

## 9. 검증 계획

## 9.1 단위 테스트

신규 테스트 대상:

- `extract_main_text_with_fallback()`
- `strip_noise()`
- `find_main_content()`
- `detect_boilerplate()`
- `clean_extracted_text()`

테스트 포인트:

- `<main>` 없는 레거시 HTML
- 메뉴/푸터/prev-next가 섞인 게시판형 HTML
- 너무 짧은 `trafilatura` 결과
- 반복 라인 과다 제거 방지

## 9.2 회귀 검증

우선 대상:

- `damha.co.kr`
- `cheongnabit.com`

성공 기준:

- `pages/*.md`에서 이전글/다음글/공유하기/푸터 반복문구가 크게 감소
- `04-content-inventory.md` 미리보기와 개별 페이지 본문이 같은 기준으로 보임
- `word_count` 감소가 노이즈 제거 결과로 설명 가능함

## 9.3 수동 검수

- 포트폴리오 상세 페이지 3개 샘플 확인
- 일반 소개 페이지 3개 샘플 확인
- 게시판형 페이지 3개 샘플 확인

---

## 10. 구현 순서

### Step 1

`trafilatura` 선택 import와 fallback 함수 추가

### Step 2

`phase4_collect_content()`를 "즉시 저장" 구조에서 "표준화 레코드 생성 -> 전체 정제 -> 저장" 구조로 변경

### Step 3

`generate_page_md()`를 page record 기반 렌더링 함수로 축소

### Step 4

`word_count`, `content_inventory` 미리보기 기준 정리

### Step 5

회귀 검증 후 결과를 문서화

---

## 11. 결정 사항

이 문서 기준 제안은 아래를 확정안 후보로 둔다.

- v1.2는 출력 경로를 바꾸지 않는다
- v1.2는 본문 추출 파이프라인만 바꾼다
- 저장은 boilerplate 정제 이후에만 수행한다
- `generate_page_md()`는 추출 함수가 아니라 렌더링 함수로 단순화한다
- `trafilatura`는 선택 의존성으로 도입한다
- 메뉴 기반 폴더와 페이지별 이미지 저장은 v1.3로 분리한다

---

## 12. 검토 요청 포인트

이 문서를 검토할 때 아래 세 가지만 보면 된다.

1. v1.2를 정말 "본문 품질 개선만"으로 제한할지
2. `trafilatura`를 선택 의존성으로 둘지, 강제 의존성으로 둘지
3. v1.3로 넘길 항목 범위가 적절한지

이 세 가지가 합의되면, 구현은 비교적 깔끔하게 들어갈 수 있다.
