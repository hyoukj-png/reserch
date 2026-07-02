# CLAUDE.md

웹사이트 리뉴얼 분석 프로젝트. 프로젝트 설계는 `DESIGN.md`, 수집 파이프라인은 `scripts/analyze_site.py` + `.agent/workflows/analyze-for-renewal.md` 참조.

**환경 셋업:** 새 컴퓨터에서 클론 후 "셋팅해줘" 요청 시 → `bash scripts/setup.sh` 실행(venv·Python 의존성·Node 도구 자동 설치). 하네스(`.claude/`)는 클론 즉시 동작하므로 별도 설치 불필요.

## 하네스: 웹사이트 리뉴얼 분석 & 벤치마킹

**목표:** 수집 스크립트가 만든 `output/{site}/` 데이터를 입력으로, 기술/디자인/콘텐츠 전문 분석가 팀이 AI 종합 분석을 수행하고 벤치마킹 레시피·리뉴얼 인사이트·최종 리포트를 생성한다. (수집은 하네스 범위 밖 — 정적 수집은 `analyze_site.py`, 런타임 보강은 `browser_analyze_site.js`가 담당)

**수집 범위:** `python scripts/analyze_site.py {URL}` = 전체 사이트 크롤링(기본). `... {URL} --single-page` = 제공한 URL 한 페이지만 수집 → `pages.json`이 1페이지가 되어 런타임 보강·AI 분석이 모두 1페이지로 연쇄 축소(작업량·토큰 절약). 사용자가 "이 페이지만"·"단일 페이지"·"전체 말고 이 URL만" 분석을 요청하면 `--single-page`로 안내한다.

**트리거:** "리뉴얼 분석", "벤치마킹 분석", "이 사이트 분석해줘", "AI 분석 돌려줘", "리포트 업데이트", "기술/디자인/콘텐츠 분석만 다시" 등 분석·벤치마킹 작업 요청 시 `renewal-analysis` 스킬을 사용하라. 단순 질문(수집 데이터 조회 등)은 직접 응답 가능.

**구성:** 에이전트 팀 모드. 분석가 3종(tech/design/content) 병렬 → benchmark-synthesizer 통합 → qa-validator 정합성 검증. 에이전트 정의는 `.claude/agents/`, 스킬은 `.claude/skills/`에서 관리. 산출물: `05-components.md`, `07-performance-a11y.md`, `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `MASTER_REPLICATION_PROMPT.md`, `PRD.md`, `COMPLETION_REPORT.md`. `09-runtime-interactions.md`가 있으면 클릭 후 동적 상태의 1차 근거로 반드시 포함한다(섹션 역할 IA 시드도 여기와 `runtime/section-roles.json`에 담긴다 — content-analysis가 페이지 내부 IA 진단에 소비). `10-design-tokens-structured.md`(+`tokens/` 기계가독 토큰)가 있으면 **디자인 토큰의 1차 근거**(computedStyle 기반 군집·스케일·모션·WCAG·스코어)로 반드시 포함하며, 정적 `03-design-tokens.md`와 충돌 시 `10-`을 신뢰한다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-05 | 초기 구성 — 분석/벤치마킹 단계 하네스 구축 (에이전트 5 + 스킬 6) | 전체 | 수집 후 AI 종합 분석·벤치마킹 자동화 |
| 2026-06-06 | 레시피 형식을 2-프롬프트(🎨 디자이너용 한글 콘텐츠 + ⚙️ 개발자용 인터랙션)로 진화 | skills/benchmark-recipe (recipe-format.md, SKILL.md) | 디자인/개발 수신자 분리 + 카테고리별 한글 콘텐츠 명세 요구 |
| 2026-06-06 | JS 트리거 숨김 콘텐츠(모달/탭) 탐지 가드 추가 | skills/tech-analysis, content-analysis | 정적 수집이 `after_on()` 모달을 놓쳐 "모달 0개" 오탐 발생(afneyeclinic 사례) |
| 2026-06-06 | 수집 스크립트에 모달/숨김 콘텐츠 자동 추출 추가 (`pages/_modals.md` 생성) + py3.9 f-string 버그 수정 | scripts/analyze_site.py | 근본 보완 — `display:none` 모달 본문을 정적으로 복구(Playwright 불요), 분석 스킬이 자동 소비 |
| 2026-06-06 | Playwright 런타임 보강 스크립트 추가 (`09-runtime-interactions.md`, screenshots, runtime JSON 생성) | scripts/browser_analyze_site.js | 완전 복제 목표를 위한 동적 DOM/클릭 상태/스크린샷 근거 확보 |
| 2026-06-06 | 6번째 산출물 `MASTER_REPLICATION_PROMPT.md` 추가 — 사이트 전체를 한 장으로 재현하는 자기완결 빌드 지시서(멀티 에이전트 역할 가이드 + 안전 치환 포함). 신규 `references/master-prompt-format.md` + benchmark-recipe/synthesizer/renewal-analysis/renewal-qa 동기화 | skills/benchmark-recipe, agents/benchmark-synthesizer, skills/renewal-analysis, skills/renewal-qa | 레시피(부품)를 넘어 near-clone 빌드 지시서를 자동 생성, 수신 AI가 역할별 전문 작업으로 분담하도록 가이드 |
| 2026-06-15 | **수집 범위 옵션 `--single-page` 추가** — `analyze_site.py`가 크롤링/sitemap을 건너뛰고 제공된 URL 한 페이지만 수집. `pages.json` 1페이지 → 런타임 보강(browser는 `pages.json`을 `slice(0,maxPages)`로 소비)·AI 분석이 모두 1페이지로 연쇄 축소. 기본은 전체 사이트 크롤링 유지 | scripts/analyze_site.py, README.md | 전체 사이트가 불필요한 특정 페이지 벤치마킹 시 작업량·토큰 절약 |
| 2026-06-15 | **7번째 산출물 `PRD.md` 추가** — 리뉴얼 제작 요구사항 정의서. BENCHMARK_RECIPE/MASTER(=AI 복제 프롬프트)와 달리 사람(기획·디자인·개발)이 읽고 페이지별 제작 범위를 합의·착수하는 문서. `content_findings`의 페이지 맵을 골격으로 `08`의 유지/개선/도입을 페이지별 요구사항·우선순위(MVP)로 번역. 경로는 pages.json 실재값만, 개선은 08 근거만. 신규 `references/prd-format.md` + benchmark-recipe/synthesizer/renewal-analysis(산출 5종) + renewal-qa(완전성 7종·PRD 정합성 항목8) 동기화 | skills/benchmark-recipe, agents/benchmark-synthesizer, skills/renewal-analysis, skills/renewal-qa | 레시피·복제 프롬프트만으로는 인간 제작팀의 착수 문서가 없어, 페이지별 제작 명세를 합의 가능한 PRD로 산출 |
| 2026-06-09 | **computedStyle 기반 구조화 토큰화 추가** — 런타임 패스(`browser_analyze_site.js`)가 라이브 DOM의 `getComputedStyle`을 전수 수집 → 신규 `scripts/tokenize.js`가 색 군집/역할분류(primary·neutral·accent)·타입/간격/radius/shadow 스케일·모션 토큰·WCAG 대비·디자인 스코어(A–F)를 산출. 신규 산출물 `10-design-tokens-structured.md` + `tokens/{raw,dtcg}.json·tailwind.js·css`. design-analysis 스킬이 이를 디자인 토큰 1차 근거로 소비. 외부 오픈소스 design-extract(designlang, MIT) 추출 접근 참조·포팅 | scripts/browser_analyze_site.js, scripts/tokenize.js(신규), skills/design-analysis | 정적 CSS regex의 "선언 ≠ 실사용" 맹점 보완 + 개발 인수인계용 기계가독 토큰 확보(복제 정확도↑). 비교·계획 근거: `docs/IMPROVEMENT_PLAN_design-extract-비교.md` |
| 2026-06-27 | **design-extract v12.21 재검토 후 인-스코프 격차 최신화** — (P3-1) `tokenize.js` 디자인 스코어를 5→**7카테고리**(엘리베이션/그림자·Radius 일관성 추가) **가중 평균**으로 정렬. (P3-2) 신규 `scripts/section_roles.js`(+테스트) — 런타임 패스가 페이지별 섹션을 hero/feature-grid/pricing-table/faq/stats/steps/comparison/gallery/logo-wall/testimonial/cta/nav/footer로 휴리스틱 분류해 `runtime/section-roles.json` 생성 + `09-runtime-interactions.md`에 "섹션 역할" 표 추가. content-analysis가 페이지 내부 IA 시드로 소비. 한국어 사이트 적중 위해 정규식에 한글 키워드 보강. v12.21 신규(studio/verify/멀티플랫폼)은 계획서 §4 범위 밖으로 제외 | scripts/tokenize.js, scripts/section_roles.js(신규), scripts/browser_analyze_site.js, skills/content-analysis, DESIGN.md | 정량 지표(P3-1)·IA 자동 라벨링(P3-2) 격차 해소. 검토 근거: `docs/IMPROVEMENT_PLAN_design-extract-비교.md` §3 |
