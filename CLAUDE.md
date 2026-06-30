# CLAUDE.md

웹사이트 리뉴얼 분석 프로젝트. 프로젝트 설계는 `DESIGN.md`, 수집 파이프라인은 `scripts/analyze_site.py` + `.agent/workflows/analyze-for-renewal.md` 참조.

**환경 셋업:** 새 컴퓨터에서 클론 후 "셋팅해줘" 요청 시 → `bash scripts/setup.sh` 실행(venv·Python 의존성·Node 도구 자동 설치). 하네스(`.claude/`)는 클론 즉시 동작하므로 별도 설치 불필요.

## 하네스: 웹사이트 리뉴얼 분석 & 벤치마킹

**목표:** 수집 스크립트가 만든 `output/{site}/` 데이터를 입력으로, 기술/디자인/콘텐츠 전문 분석가 팀이 AI 종합 분석을 수행하고 벤치마킹 레시피·리뉴얼 인사이트·최종 리포트를 생성한다. (수집은 하네스 범위 밖 — 정적 수집은 `analyze_site.py`, 런타임 보강은 `browser_analyze_site.js`가 담당)

**트리거:** "리뉴얼 분석", "벤치마킹 분석", "이 사이트 분석해줘", "AI 분석 돌려줘", "리포트 업데이트", "기술/디자인/콘텐츠 분석만 다시" 등 분석·벤치마킹 작업 요청 시 `renewal-analysis` 스킬을 사용하라. 단순 질문(수집 데이터 조회 등)은 직접 응답 가능.

**구성:** 에이전트 팀 모드. 분석가 3종(tech/design/content) 병렬 → benchmark-synthesizer 통합 → qa-validator 정합성 검증. 에이전트 정의는 `.claude/agents/`, 스킬은 `.claude/skills/`에서 관리. 산출물: `05-components.md`, `07-performance-a11y.md`, `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `MASTER_REPLICATION_PROMPT.md`, `COMPLETION_REPORT.md`. `09-runtime-interactions.md`가 있으면 클릭 후 동적 상태의 1차 근거로 반드시 포함한다.

**런타임 도구 일원화:** 런타임 실측은 `scripts/browser_analyze_site.js` **단일 도구**로 통합한다(→ `09-runtime-interactions.md`). 캡처 범위: ① 클릭 기반 동적 상태(모달·clickable·폼·콘솔/네트워크) ② **디자인 실측(designSignals)** — computed 폰트·타입스케일·팔레트·페이지별 라이브러리 로드 스코프·GSAP/Swiper/AOS 설정·리빌 CSS ③ **인터랙션 패턴(interactionPatterns)** — 가로 확장 패널 셀렉터 등 카드 그리드로 오판하기 쉬운 패턴. 분석가는 폰트·라이브러리·인터랙션 판정 시 `09-runtime-interactions.md`를 추론·정적신호보다 우선한다. (구 `extract_runtime.py`는 deprecated — 기능 흡수 완료, 폴백용 보존)

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-05 | 초기 구성 — 분석/벤치마킹 단계 하네스 구축 (에이전트 5 + 스킬 6) | 전체 | 수집 후 AI 종합 분석·벤치마킹 자동화 |
| 2026-06-06 | 레시피 형식을 2-프롬프트(🎨 디자이너용 한글 콘텐츠 + ⚙️ 개발자용 인터랙션)로 진화 | skills/benchmark-recipe (recipe-format.md, SKILL.md) | 디자인/개발 수신자 분리 + 카테고리별 한글 콘텐츠 명세 요구 |
| 2026-06-06 | JS 트리거 숨김 콘텐츠(모달/탭) 탐지 가드 추가 | skills/tech-analysis, content-analysis | 정적 수집이 `after_on()` 모달을 놓쳐 "모달 0개" 오탐 발생(afneyeclinic 사례) |
| 2026-06-06 | 수집 스크립트에 모달/숨김 콘텐츠 자동 추출 추가 (`pages/_modals.md` 생성) + py3.9 f-string 버그 수정 | scripts/analyze_site.py | 근본 보완 — `display:none` 모달 본문을 정적으로 복구(Playwright 불요), 분석 스킬이 자동 소비 |
| 2026-06-06 | Playwright 런타임 보강 스크립트 추가 (`09-runtime-interactions.md`, screenshots, runtime JSON 생성) | scripts/browser_analyze_site.js | 완전 복제 목표를 위한 동적 DOM/클릭 상태/스크린샷 근거 확보 |
| 2026-06-06 | 6번째 산출물 `MASTER_REPLICATION_PROMPT.md` 추가 — 사이트 전체를 한 장으로 재현하는 자기완결 빌드 지시서(멀티 에이전트 역할 가이드 + 안전 치환 포함). 신규 `references/master-prompt-format.md` + benchmark-recipe/synthesizer/renewal-analysis/renewal-qa 동기화 | skills/benchmark-recipe, agents/benchmark-synthesizer, skills/renewal-analysis, skills/renewal-qa | 레시피(부품)를 넘어 near-clone 빌드 지시서를 자동 생성, 수신 AI가 역할별 전문 작업으로 분담하도록 가이드 |
| 2026-06-29 | 런타임 도구 일원화 — `extract_runtime.py`의 designSignals(폰트·타입스케일·팔레트·라이브러리 스코프·GSAP/Swiper 설정·리빌 CSS)를 `browser_analyze_site.js`로 흡수, 구 스크립트 deprecated | scripts/browser_analyze_site.js, scripts/extract_runtime.py | 런타임 추출기 2개 중복 제거 → 09-runtime-interactions.md 단일 정답 소스화 |
| 2026-06-29 | 가로 확장 패널 셀렉터 등 인터랙션 패턴 탐지 추가(interactionPatterns) | scripts/browser_analyze_site.js | "5대 중점진료=가로 확장 아코디언"을 카드 그리드로 오판한 사례(afneyeclinic/마블안과) 재발 방지 |
| 2026-06-30 | 자가진단 위젯 탐지 추가(selfTestWidgets) — 예/아니오 토글 설문(진행바·순차분기·문항·결과 실측)·카운트업 타이머. visible 필터 미적용으로 reveal·모달 내부(display:none) 위젯까지 DOM 스캔 포착. afneyeclinic 라이브 검증 통과 | scripts/browser_analyze_site.js | 검진설문 `survey=0` 오탐 + 눈깜빡임 모달 내부 미실측 → 분석가 창작 방지(근본) |
| 2026-06-30 | 인터랙션 내부 동작 창작 금지 가드 추가 — 진행바·순차분기·상태머신·결과 임계값·문항수는 09-runtime 실측 우선, 미확인은 '추정' 표기 | skills/tech-analysis, content-analysis, benchmark-recipe | selfTestWidgets 실측을 분석가가 추론보다 우선하도록 강제(증상 차단) |
