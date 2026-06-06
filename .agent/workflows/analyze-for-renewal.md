---
description: 웹사이트 리뉴얼을 위한 종합 분석 워크플로우. URL을 받아 기술 스택, 콘텐츠, 디자인, 성능을 분석하고 한국어 리포트를 생성한다.
---

# /analyze-for-renewal [URL] (별칭: 분석해줘:[URL])

웹사이트 리뉴얼 및 벤치마킹을 위한 9-Phase 종합 분석 파이프라인

## 사전 조건

- Python 3.10+ 설치됨
- Node.js 18+ 설치됨

---

## Phase 0: 사전 준비

// turbo

1. Python 의존성 설치

```
pip install -r scripts/requirements.txt
```

// turbo
2. Playwright 브라우저 설치

```
npx -y playwright install chromium
```

1. 출력 폴더 생성 — URL에서 사이트 이름 추출 후 폴더 생성

```
python -c "import sys,re; name=re.sub(r'https?://','','{URL}').replace('/','_').replace('.','_')[:30]; import os; [os.makedirs(f'output/{name}/{d}',exist_ok=True) for d in ['screenshots/pc','screenshots/mobile','assets/images']]; print(f'📁 {name}')"
```

---

## Phase 1: 사이트 접속 & 기본 분석

1. `read_url_content`로 URL 접속하여 HTML 내용 확인
2. `read_url_content`로 `{URL}/robots.txt` 확인
3. `read_url_content`로 `{URL}/sitemap.xml` 확인

---

## Phase 2~5: 통합 분석 스크립트 실행

1. 통합 분석 스크립트 실행 (기술스택 + 크롤링 + 콘텐츠 수집 + 디자인 토큰)

```
python scripts/analyze_site.py {URL}
```

---

## Phase 4-3: 스크린샷 캡처

1. `browser_subagent`로 PC 전체 스크린샷 (1920x1080)
   - URL 접속 후 전체 페이지 스크린샷
   - 주요 하위 페이지 스크린샷

2. `browser_subagent`로 Mobile 스크린샷 (375x812)
   - 모바일 뷰포트로 동일 페이지 캡처

---

## Phase 6: 성능 분석

1. Lighthouse 실행 (선택적)

```
npx -y lighthouse {URL} --output json --output-path output/{SITE_NAME}/lighthouse.json --chrome-flags="--headless" --only-categories=performance,accessibility,seo,best-practices --quiet
```

---

## Phase 7: AI 종합 분석 및 벤치마킹 레시피 생성

1. `view_file`로 output 폴더의 모든 분석 파일 읽기
2. 수집 데이터 기반 AI 종합 분석 및 **벤치마킹 데이터 추출** 수행:
    - 사이트 성격 정의 및 유지/개선 항목 분류
    - **핵심 기술 적용 페이지 매핑**: 어떤 기술(Swiper, 특정 폰트, 그리드 등)이 어떤 경로(URL)에서 핵심적으로 쓰였는지 분석
    - **복제용 프롬프트 가이드 생성**: 타 프로젝트에서 해당 기능을 구현하기 위한 AI 명령어(Prompt) 요약
3. `08-renewal-insights.md` 작성
4. **`BENCHMARK_RECIPE.md`** 작성 (기술-페이지 매핑 + 복제용 명령어 포함)

---

## Phase 8: 최종 리포트 및 활용 안내

1. `COMPLETION_REPORT.md` 한국어 종합 리포트 자동 생성
2. 사용자에게 결과 요약 보고 및 **`BENCHMARK_RECIPE.md`** 활용 방법 안내
3. 타 프로젝트 적용을 위한 구체적인 지시어 예시 제공

---

## 에러 핸들링

- Phase 실패 시 → 에러 기록 후 다음 Phase 계속
- 개별 페이지 실패 → 스킵 후 계속
- 타임아웃 → 3회 재시도 후 스킵
