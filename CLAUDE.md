# CLAUDE.md

웹사이트 리뉴얼 분석 프로젝트. 프로젝트 설계는 `DESIGN.md`, 수집 파이프라인은 `scripts/analyze_site.py` + `.agent/workflows/analyze-for-renewal.md` 참조.

**환경 셋업:** 새 컴퓨터에서 클론 후 "셋팅해줘" 요청 시 → `bash scripts/setup.sh` 실행(venv·Python 의존성·Node 도구 자동 설치). 하네스(`.claude/`)는 클론 즉시 동작하므로 별도 설치 불필요.

## 하네스: 웹사이트 리뉴얼 분석 & 벤치마킹

**목표:** 수집 스크립트가 만든 `output/{site}/` 데이터를 입력으로, 기술/디자인/콘텐츠 전문 분석가 팀이 AI 종합 분석을 수행하고 벤치마킹 레시피·리뉴얼 인사이트·최종 리포트를 생성한다. (수집은 하네스 범위 밖 — `analyze_site.py`가 담당)

**트리거:** "리뉴얼 분석", "벤치마킹 분석", "이 사이트 분석해줘", "AI 분석 돌려줘", "리포트 업데이트", "기술/디자인/콘텐츠 분석만 다시" 등 분석·벤치마킹 작업 요청 시 `renewal-analysis` 스킬을 사용하라. 단순 질문(수집 데이터 조회 등)은 직접 응답 가능.

**구성:** 에이전트 팀 모드. 분석가 3종(tech/design/content) 병렬 → benchmark-synthesizer 통합 → qa-validator 정합성 검증. 에이전트 정의는 `.claude/agents/`, 스킬은 `.claude/skills/`에서 관리. 산출물: `05-components.md`, `07-performance-a11y.md`, `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `COMPLETION_REPORT.md`.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-05 | 초기 구성 — 분석/벤치마킹 단계 하네스 구축 (에이전트 5 + 스킬 6) | 전체 | 수집 후 AI 종합 분석·벤치마킹 자동화 |
| 2026-06-06 | 레시피 형식을 2-프롬프트(🎨 디자이너용 한글 콘텐츠 + ⚙️ 개발자용 인터랙션)로 진화 | skills/benchmark-recipe (recipe-format.md, SKILL.md) | 디자인/개발 수신자 분리 + 카테고리별 한글 콘텐츠 명세 요구 |
| 2026-06-06 | JS 트리거 숨김 콘텐츠(모달/탭) 탐지 가드 추가 | skills/tech-analysis, content-analysis | 정적 수집이 `after_on()` 모달을 놓쳐 "모달 0개" 오탐 발생(afneyeclinic 사례) |
| 2026-06-06 | 수집 스크립트에 모달/숨김 콘텐츠 자동 추출 추가 (`pages/_modals.md` 생성) + py3.9 f-string 버그 수정 | scripts/analyze_site.py | 근본 보완 — `display:none` 모달 본문을 정적으로 복구(Playwright 불요), 분석 스킬이 자동 소비 |
