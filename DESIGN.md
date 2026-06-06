# 웹사이트 리뉴얼 분석 프로젝트 — DESIGN.md

> **목적:** 기존 웹사이트를 분석하여 리뉴얼에 필요한 모든 데이터를 수집하고, AI 기반 인사이트를 도출한다.
> **환경:** Antigravity IDE (Cross-platform)
> **언어:** 모든 분석 결과 한국어, 기술 용어는 영문 유지

---

## 📐 아키텍처 개요

```
. (Research 디렉토리)
├── DESIGN.md                          ← 이 파일 (프로젝트 설계)
├── .agent/workflows/
│   └── analyze-for-renewal.md         ← 실행 워크플로우
├── scripts/
│   ├── analyze_site.py                ← 통합 분석 스크립트 (Phase 1~5)
│   └── requirements.txt               ← Python 의존성
└── output/                             ← 분석 결과 출력
    └── {site_name}/
        ├── 00-summary.md
        ├── 01-site-structure.md
        ├── 02-tech-stack.md
        ├── 03-design-tokens.md
        ├── 04-content-inventory.md
        ├── 05-components.md
        ├── 06-interaction.md
        ├── 07-performance-a11y.md
        ├── 08-renewal-insights.md
        ├── 09-runtime-interactions.md
        ├── BENCHMARK_RECIPE.md
        ├── MASTER_REPLICATION_PROMPT.md
        ├── COMPLETION_REPORT.md
        ├── runtime/
        │   └── runtime-analysis.json
        ├── screenshots/
        │   ├── pc/
        │   └── mobile/
        └── assets/
            └── images/
```

---

## 🔧 도구 매핑 (원본 → Antigravity)

| 원본 (Claude CLI) | Antigravity 대체 | 비고 |
|---|---|---|
| `requests + BeautifulSoup` | `run_command` (Python 스크립트) | 동일 |
| `/chrome` 브라우저 연결 | `browser_subagent` | 자동화된 브라우저 제어 |
| `playwright` 스크립트 | `run_command` (Playwright) | headless 모드 |
| Claude Vision (스크린샷 분석) | Antigravity 직접 분석 | `view_file`로 이미지 읽기 |
| Claude AI 분석 | Antigravity 직접 수행 | 파일 읽고 인사이트 작성 |
| `pytesseract` OCR | ❌ 제외 (Windows 설치 복잡) | CSS변수+ComputedStyle로 충분 |
| `npx lighthouse` | `run_command` 실행 | 설치 필요 시 자동 |

---

## 📋 Phase 구조 (9단계)

### Phase 0: 사전 준비

- [x] Python 의존성 설치 확인
- [x] Playwright 브라우저 설치
- [x] 출력 폴더 구조 생성

### Phase 1: 사이트 접속 & 유효성 확인

- `read_url_content`로 기본 접속 테스트
- robots.txt 확인 → 크롤링 제외 경로 파악

### Phase 2: 기술 스택 탐지

- HTML 소스 정적 분석 (regex 패턴 매칭)
- Playwright 런타임 전역 객체 탐지
- Network URL 패턴 분석

### Phase 3: 페이지 전체 탐색

- sitemap.xml 파싱
- 재귀 링크 크롤링 (depth 3, max 200)

### Phase 4: 콘텐츠 수집

- 텍스트 구조화 수집 (nav, hero, main, footer)
- 이미지 URL 수집 & 다운로드
- 스크린샷 캡처 (PC 1920px / Mobile 375px)

### Phase 5: 디자인 시스템 분석

- CSS 변수 파싱
- Computed Style 추출
- Color Thief 이미지 팔레트
- 폰트 & 간격 시스템 분석

### Phase 6: 인터랙티브 & 런타임 분석

- 동적 요소 (슬라이더, 모달, 탭, 폼)
- Playwright Chromium 런타임 실행
- PC/Mobile 전체 페이지 스크린샷
- 클릭 후보 탐색 및 클릭 후 DOM 상태 변화 저장
- visible dialog/modal, console error, network host 요약
- Lighthouse 성능 측정

### Phase 7: AI 종합 분석

- Antigravity가 수집 데이터 직접 분석
- 리뉴얼 인사이트 & 개선 제안 작성

### Phase 8: 최종 리포트 생성

- COMPLETION_REPORT.md 한국어 보고서

---

## ⚙️ 기술 요구사항

### Python 패키지

```
requests>=2.31
beautifulsoup4>=4.12
Pillow>=10.0
colorthief>=0.2
lxml>=4.9
```

### Node.js 패키지

```
playwright (npx playwright install chromium)
lighthouse (npx lighthouse)
```

---

## 🚦 실행 흐름

1. 사용자가 분석할 URL 제공
2. `/analyze-for-renewal [URL]` 워크플로우 실행
3. Phase 0~6: 자동 스크립트 실행 (Python 정적 수집 + Playwright 런타임 보강)
4. Phase 7: Antigravity가 수집 파일 읽고 AI 분석
5. Phase 8: COMPLETION_REPORT.md 자동 생성
6. 사용자에게 결과 보고

---

## 📝 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-02-20 | 초기 설계 — analyze-for-renewal.md 기반 Antigravity 환경 적응 |
