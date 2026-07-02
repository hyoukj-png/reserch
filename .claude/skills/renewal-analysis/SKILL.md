---
name: renewal-analysis
description: 웹사이트 리뉴얼 분석의 AI 종합 분석·벤치마킹 단계를 조율하는 오케스트레이터. 수집 스크립트(analyze_site.py)가 만든 output/{site}/ 데이터를 입력으로, 기술/디자인/콘텐츠 전문 분석가 팀을 병렬 가동하고 통합·QA를 거쳐 05/07/08-renewal-insights.md, BENCHMARK_RECIPE.md, MASTER_REPLICATION_PROMPT.md, PRD.md, FRD.md, COMPLETION_REPORT.md를 생성한다. "리뉴얼 분석", "벤치마킹 분석", "사이트 분석 종합", "AI 분석 돌려줘", "이 사이트 분석해줘", "분석 다시 실행", "재실행", "리포트 업데이트", "기술/디자인/콘텐츠 분석만 다시", "이전 결과 개선"을 요청하거나 output/{site}/에 수집 데이터가 준비되어 AI 종합 분석이 필요할 때 반드시 이 스킬을 사용하라.
---

# 리뉴얼 분석 오케스트레이터

수집 스크립트가 멈춘 지점(Phase 7~8: AI 종합 분석 + 최종 리포트)을 전문 분석가 팀으로 완성한다. **수집은 이 하네스의 범위가 아니다** — 이미 `output/{site}/`에 수집 데이터가 있다고 전제한다(없으면 `python scripts/analyze_site.py {URL}` 안내).

**실행 모드:** 에이전트 팀 (팬아웃/팬인 + 생성-검증 하이브리드)

## 팀 구성

| 에이전트 | 타입 | 역할 |
|---------|------|------|
| tech-analyst | (정의된) opus | 기술 스택·인터랙션·성능 → tech_findings + `07-performance-a11y.md` |
| design-analyst | opus | 디자인 토큰·스크린샷·컴포넌트 → design_findings + `05-components.md` |
| content-analyst | opus | IA·콘텐츠·CTA → content_findings |
| benchmark-synthesizer | opus | 통합 → `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `MASTER_REPLICATION_PROMPT.md`, `PRD.md`, `FRD.md`, `COMPLETION_REPORT.md` |
| qa-validator | **general-purpose** opus | 정합성 교차 검증 → qa_report |

> 모든 Agent 호출에 `model: "opus"` 명시. qa-validator는 검증 스크립트 실행이 필요하므로 반드시 `subagent_type: "general-purpose"`.

## Phase 0: 컨텍스트 확인 (시작 시 항상)

1. 분석 대상 `output/{site}/` 결정. 사용자가 사이트명/URL을 주면 그것으로, 안 주면 `output/` 하위 디렉토리를 `ls`로 확인하여 후보 제시.
2. 수집 데이터 존재 확인: `00-summary.md`, `02-tech-stack.md`, `03-design-tokens.md` 등이 있는가.
   - **없으면:** "수집 데이터가 없습니다. 먼저 `python scripts/analyze_site.py {URL}` 실행이 필요합니다"라고 안내하고 중단.
3. 실행 모드 판별:
   - `output/{site}/` 최종 산출물(`COMPLETION_REPORT.md` 등) **없음** → **초기 실행** (전체 Phase)
   - 최종 산출물 **있음** + 사용자가 "특정 영역만 다시" → **부분 재실행** (해당 분석가 + synthesizer + QA만)
   - 최종 산출물 **있음** + 새 수집 데이터 → **새 실행** (기존을 `_workspace_prev/`로 이동 후 전체)
4. `output/{site}/_workspace/` 디렉토리 생성 (중간 산출물 저장소).

## Phase 1: 병렬 분석 (팬아웃)

**실행 모드:** 에이전트 팀

1. `TeamCreate`로 팀 구성: tech-analyst, design-analyst, content-analyst, benchmark-synthesizer, qa-validator.
2. `TaskCreate`로 작업 할당 (의존성 설정):
   - 분석 3종(tech/design/content) — 의존성 없음, 병렬
   - 통합(synthesizer) — 분석 3종에 `addBlockedBy`
   - QA — 점진적, 각 산출물에 반응
3. 세 분석가가 각자 스킬(`tech-analysis`/`design-analysis`/`content-analysis`)에 따라 `output/{site}/`를 읽고 `_workspace/*_findings.md`를 작성. 분석가 간 필요한 정보는 `SendMessage`로 직접 교환(예: tech→design 인터랙션 위치).
4. 각 분석가는 완료 시 `_workspace/`에 파일을 남기고 synthesizer·qa에게 완료를 알린다.

**부분 재실행 시:** 해당 분석가만 호출. 나머지 findings는 기존 파일 재사용.

## Phase 2: 점진적 QA (분석과 동시)

**실행 모드:** 에이전트 팀 (생성-검증)

- qa-validator는 각 `*_findings.md`가 나오는 즉시 `renewal-qa` 스킬로 경계면 정합성을 검증한다(환각 경로·없는 컬러). 전체 완성을 기다리지 않는다.
- blocker 발견 시 책임 분석가에게 `SendMessage`로 수정 요청 → 수정 후 재검증.

## Phase 3: 통합 (팬인)

**실행 모드:** 에이전트 팀

1. benchmark-synthesizer는 **세 findings가 모두 준비되면** `benchmark-recipe` 스킬로 통합을 시작한다.
2. 산출: `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `MASTER_REPLICATION_PROMPT.md`, `PRD.md`, `FRD.md`, `COMPLETION_REPORT.md`를 `output/{site}/`에 작성.
3. 통합 중 발견 간 모순은 양 분석가에게 확인 요청. 미해소 시 양쪽 출처 병기.

## Phase 4: 최종 QA & 종합

1. qa-validator가 최종 산출물 8종(05/07/08/RECIPE/MASTER/PRD/FRD/COMPLETION)을 `renewal-qa` 전 항목으로 검증, `qa_report.md` 작성.
2. blocker가 있으면 원저자 수정 → 재검증 루프. blocker 0일 때 통과.
3. 오케스트레이터(리더)가 결과를 종합하여 사용자에게 보고: 생성된 산출물 목록 + 핵심 발견 요약 + QA 통과 여부 + 남은 warning.
4. 팀 정리.

## 데이터 전달 프로토콜

- **태스크 기반**(`TaskCreate`/`TaskUpdate`): 진행 추적·의존 관리
- **파일 기반**: `output/{site}/_workspace/`에 중간 산출물(`tech_findings.md`, `design_findings.md`, `content_findings.md`, `qa_report.md`). 최종물만 `output/{site}/` 루트에. `_workspace/`는 사후 감사용으로 보존.
- **메시지 기반**(`SendMessage`): 분석가 간 정보 교환, QA 이슈 전달, 완료 신호

## 에러 핸들링

- 분석가 1명 실패 → 1회 재시도. 재실패 시 해당 영역 없이 진행하고 COMPLETION_REPORT 상단에 "❌ {영역} 분석 누락" 명시.
- 수집 입력 파일 누락 → 해당 분석만 생략, 발견 문서에 표기.
- 발견 간 상충 → 삭제·임의선택 금지, 양쪽 출처 병기 + "확인 필요".
- QA blocker가 재시도 후에도 해소 안 됨 → 사용자에게 보고하고 판단 요청.

## 테스트 시나리오

**정상 흐름:** `output/damha_co_kr/`에 수집 데이터 존재 → Phase 0이 초기 실행 판별 → 세 분석가 병렬로 findings 작성 → QA가 tech_findings의 페이지 경로를 pages.json과 대조(통과) → synthesizer가 6종 산출물 작성 → 최종 QA 통과 → 사용자에게 산출물 목록 보고. 기대: `output/damha_co_kr/`에 05/07/08/RECIPE/MASTER/PRD/FRD/COMPLETION 8개 파일 생성.

**에러 흐름:** synthesizer가 BENCHMARK_RECIPE에 `/about-us`를 인용했으나 pages.json에 없음 → QA가 스크립트 대조로 환각 경로 blocker 검출 → benchmark-synthesizer + tech-analyst에게 SendMessage 수정 요청 → 실제 경로로 교정 또는 항목 제거 → 재검증 통과. 기대: 최종 RECIPE의 모든 경로가 pages.json에 실재.

**부분 재실행 흐름:** 사용자가 "디자인 분석만 다시" → Phase 0이 부분 재실행 판별 → design-analyst만 호출, design_findings 갱신 → synthesizer가 디자인 연관 통합 부분만 재작성 → QA가 변경분만 재검증.
