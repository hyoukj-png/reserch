---
name: analyze-renewal
description: "웹사이트 리뉴얼 분석 에이전트 팀을 조율하는 오케스트레이터. URL을 받아 크롤링 → 병렬 분석(기술/디자인/콘텐츠) → 종합(인사이트·BENCHMARK_RECIPE·PROJECT_BRIEF) → QA 검증의 전체 파이프라인을 실행한다. 트리거: '분석해줘', '사이트 분석', 'analyze', '리뉴얼 분석', 'URL 분석', '벤치마킹 분석', 'BENCHMARK_RECIPE 생성', 'PROJECT_BRIEF 생성', 그리고 후속 작업: '다시 분석', '재실행', '업데이트', '결과 보완', '특정 섹션만 다시', '디자인 토큰만 다시', 'BENCHMARK_RECIPE만 다시', '이전 결과 개선' 시에도 반드시 이 스킬을 사용한다."
---

# Analyze Renewal — 웹사이트 리뉴얼 분석 오케스트레이터

웹사이트 URL을 입력받아, 6명 에이전트 팀이 협업하여 리뉴얼/벤치마킹용 최종 산출물 4종(`08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `PROJECT_BRIEF.md`, `COMPLETION_REPORT.md`)을 생성하는 통합 워크플로우.

## 실행 모드: 하이브리드

| Phase | 모드 | 이유 |
|-------|------|------|
| Phase 2 (수집) | 서브 에이전트 | 단일 collector가 스크립트 실행만 담당, 팀 통신 불필요 |
| Phase 3 (병렬 분석) | 에이전트 팀 | 3명 분석가가 페이지·라이브러리·디자인 매핑을 교차 검증 |
| Phase 4 (종합) | 서브 에이전트 | 단독 synthesizer가 통합 문서 생성 |
| Phase 5 (QA) | 서브 에이전트 | 단독 qa-reviewer가 객관 검증 |

## 에이전트 구성

| 에이전트 | 역할 | 사용 스킬 | 주요 출력 |
|---------|------|----------|----------|
| collector | 크롤링·스크린샷·Lighthouse | site-crawler, screenshot-capture | `output/{site}/00~06.md`, `analysis_data.json`, `lighthouse.json`, `screenshots/`, `_workspace/raw/collector_manifest.json` |
| tech-analyst | 기술스택·성능 분석 | (분석 메서드) | `_workspace/analysis/02_tech_stack_analysis.md`, `07_performance_analysis.md`, `tech_benchmark_map.json` |
| design-analyst | 디자인 토큰 추출 | design-token-extraction | `_workspace/analysis/03_design_system.md`, `design_tokens.json`, `tailwind.config.snippet.js` |
| content-analyst | IA·콘텐츠·컴포넌트 분석 | (분석 메서드) | `_workspace/analysis/01,04,05,06.md`, `content_map.json` |
| synthesizer | 종합 인사이트·BENCHMARK·BRIEF | benchmark-recipe-writer | `output/{site}/08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `PROJECT_BRIEF.md`, `COMPLETION_REPORT.md` |
| qa-reviewer | 정합성 검증 | (검증 체크리스트) | `_workspace/qa/qa_report.md`, `qa_summary.json` |

모든 Agent 호출 시 `model: "opus"` 명시.

## 워크플로우

### Phase 0: 컨텍스트 확인

1. 사용자 입력에서 URL 추출 (예: `분석해줘:https://example.com` 또는 `/analyze-renewal https://example.com`)
2. URL에서 site_name 도출: `re.sub(r'https?://','',url).replace('/','_').replace('.','_')[:30]`
3. 다음 경로 존재 여부 확인:
   - `output/{site_name}/`
   - `_workspace/`
4. 실행 모드 결정:
   - **둘 다 없음** → 초기 실행. Phase 1로 진행
   - **`_workspace/` 존재 + 사용자가 "다시", "업데이트", "보완" 요청** → 부분 재실행
   - **`output/{site_name}/` 존재 + 사용자가 새 URL 또는 "재크롤링" 명시** → 새 실행. 기존 `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 이동
   - **`output/{site_name}/` 존재 + URL 동일 + 사용자가 "이어서" 또는 "분석만"** → 수집 스킵하고 Phase 3부터 시작
5. 부분 재실행 시: 어느 에이전트 산출물을 갱신할지 파악하고, 해당 에이전트 프롬프트에 "이전 결과 경로"와 "수정 지시"를 포함

### Phase 1: 준비

1. `_workspace/`, `_workspace/raw/`, `_workspace/analysis/`, `_workspace/qa/` 생성
2. `output/{site_name}/` 폴더 구조 사전 생성 (collector가 어차피 만들지만, 경로 검증을 위해 미리 확인)
3. 사용자에게 "분석 시작" 짧은 보고 (URL, site_name, 예상 출력 경로)

### Phase 2: 데이터 수집 (서브 에이전트)

**실행 모드:** 서브 에이전트 단일

```
Agent(
  subagent_type: "collector",
  model: "opus",
  prompt: "
    대상 URL: {URL}
    site_name: {site_name}
    작업: scripts/analyze_site.py 실행 + Playwright 스크린샷 + scripts/extract_runtime.py(런타임 실측) + Lighthouse 측정
    출력:
    - output/{site_name}/ 하위 분석 파일들
    - output/{site_name}/runtime_extract.json/.md (런타임 실측 — 분석가 1차 정답 소스)
    - _workspace/raw/collector.log
    - _workspace/raw/collector_manifest.json
    완료 시 collector_manifest.json 경로와 errors 배열, runtime_ok/runtime_pages_extracted를 반환할 것.
  "
)
```

**완료 후:** `collector_manifest.json` 의 `errors`를 확인. 사이트 자체 접근 불가(errors에 'URL access failed' 포함) 시 사용자에게 알리고 종료.

### Phase 3: 병렬 분석 (에이전트 팀)

**실행 모드:** 에이전트 팀

1. 팀 생성:
   ```
   TeamCreate(
     team_name: "renewal-analysis-team",
     members: [
       {
         name: "tech-analyst", agent_type: "tech-analyst", model: "opus",
         prompt: "site_dir={output/{site_name}}, manifest={_workspace/raw/collector_manifest.json}. tech-analyst.md의 역할대로 _workspace/analysis/02_tech_stack_analysis.md, 07_performance_analysis.md, tech_benchmark_map.json 생성."
       },
       {
         name: "design-analyst", agent_type: "design-analyst", model: "opus",
         prompt: "site_dir={output/{site_name}}. design-token-extraction 스킬 사용. _workspace/analysis/03_design_system.md, design_tokens.json, tailwind.config.snippet.js 생성. 스크린샷 시각 검증 포함."
       },
       {
         name: "content-analyst", agent_type: "content-analyst", model: "opus",
         prompt: "site_dir={output/{site_name}}. content-analyst.md의 역할대로 _workspace/analysis/01,04,05,06.md, content_map.json 생성. pages/*.md 본문 직접 Read 권장."
       }
     ]
   )
   ```

2. 작업 등록:
   ```
   TaskCreate(tasks: [
     { title: "기술스택·성능 분석", assignee: "tech-analyst" },
     { title: "디자인 시스템 역설계", assignee: "design-analyst" },
     { title: "IA·콘텐츠·컴포넌트 분석", assignee: "content-analyst" }
   ])
   ```

3. 팀원 자체 조율:
   - tech-analyst ↔ content-analyst: 라이브러리-페이지 매핑 교차 검증 (SendMessage)
   - design-analyst ↔ content-analyst: 반복 컴포넌트 ↔ 디자인 토큰 일관성 (SendMessage)
   - tech-analyst ↔ design-analyst: 폰트/아이콘 라이브러리 교차 확인 (SendMessage)

4. 리더 모니터링: TaskGet으로 진행상황 확인, 팀원 유휴 시 결과 파일 존재 검증

5. 팀 정리: TeamDelete

### Phase 4: 종합 (서브 에이전트)

**실행 모드:** 서브 에이전트 단일

```
Agent(
  subagent_type: "synthesizer",
  model: "opus",
  prompt: "
    site_dir: output/{site_name}
    분석 입력: _workspace/analysis/*.md, *.json (tech_benchmark_map.json, design_tokens.json, content_map.json 포함)
    수집 메타: _workspace/raw/collector_manifest.json

    benchmark-recipe-writer 스킬을 사용하여 다음 4개 문서 생성:
    1. output/{site_name}/08-renewal-insights.md
    2. output/{site_name}/BENCHMARK_RECIPE.md (복제용 프롬프트 포함)
    3. output/{site_name}/PROJECT_BRIEF.md (8개 필수 섹션)
    4. output/{site_name}/COMPLETION_REPORT.md (한국어 종합 리포트)

    분석가 결론 상충 시 양쪽 출처 명시.
  "
)
```

### Phase 5: QA 검증 (서브 에이전트)

**실행 모드:** 서브 에이전트 단일

```
Agent(
  subagent_type: "qa-reviewer",
  model: "opus",
  prompt: "
    검증 대상: output/{site_name}/ 의 최종 4개 문서 + _workspace/analysis/*.json
    qa-reviewer.md의 검증 체크리스트(파일 존재 / 경계면 교차 정합 / 자기완결성 / 표기 일관성)에 따라 진행.
    출력: _workspace/qa/qa_report.md, qa_summary.json
    BLOCKER/HIGH 발견 시 즉시 보고.
  "
)
```

**조치 분기:**
- `qa_summary.json.overall_status === "FAIL"` → BLOCKER/HIGH 이슈를 synthesizer에게 SendMessage로 수정 요청, 1회 재실행. 재실패 시 사용자에게 보고
- `PASS` 또는 `PASS_WITH_WARNINGS` → Phase 6 진행

### Phase 6: 정리 및 보고

1. 사용자에게 짧은 결과 요약:
   - 분석 대상 URL, site_name
   - 생성된 4개 문서의 절대 경로
   - QA 상태 (PASS / PASS_WITH_WARNINGS / FAIL)
   - `_workspace/` 보존 사실 (감사 추적용)
2. 활용 안내:
   - BENCHMARK_RECIPE.md → 타 프로젝트 복제용
   - PROJECT_BRIEF.md → 다음 단계(/design, /fe, /be 등) 에이전트 인계용
3. `_workspace/` 삭제하지 않음 (재실행 시 차분 비교용)

## 데이터 흐름

```
사용자 URL
    │
    ▼
[Phase 0] 컨텍스트 분기 (초기/부분재실행/이어서)
    │
    ▼
[Phase 1] _workspace/ 디렉토리 준비
    │
    ▼
[Phase 2] collector (서브)
    └→ output/{site}/00~06.md, analysis_data.json, runtime_extract.json/.md, lighthouse.json
    └→ _workspace/raw/collector_manifest.json
    │
    ▼
[Phase 3] TeamCreate (renewal-analysis-team)
    ├→ tech-analyst    → _workspace/analysis/02,07.md, tech_benchmark_map.json
    ├→ design-analyst  → _workspace/analysis/03.md, design_tokens.json
    └→ content-analyst → _workspace/analysis/01,04,05,06.md, content_map.json
       (SendMessage로 라이브러리-페이지 매핑 교차 검증)
    │
    ▼
[Phase 4] synthesizer (서브)
    └→ output/{site}/08-renewal-insights.md
    └→ output/{site}/BENCHMARK_RECIPE.md
    └→ output/{site}/PROJECT_BRIEF.md
    └→ output/{site}/COMPLETION_REPORT.md
    │
    ▼
[Phase 5] qa-reviewer (서브)
    └→ _workspace/qa/qa_report.md, qa_summary.json
    │
    ▼
[Phase 6] 사용자 보고
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| URL 접근 불가 | Phase 2에서 종료, 사용자에게 보고. Phase 3~5 진행 불가 |
| analyze_site.py 부분 실패 (e.g. Lighthouse만 실패) | 진행 계속, 영향받는 분석 섹션은 "데이터 부족" 명시 |
| Phase 3 팀원 1명 실패 | 리더가 1회 재시작 시도. 재실패 시 해당 분석 없이 Phase 4 진행 (synthesizer가 누락 명시) |
| Phase 3 팀원 과반 실패 | 사용자에게 즉시 보고, 진행 여부 확인 |
| Phase 5 QA에서 FAIL | synthesizer 1회 재호출. 재실패 시 사용자에게 qa_report.md 경로와 함께 보고 |
| 디스크 공간/권한 문제 | 즉시 종료, 사용자에게 보고 |
| 중복 site_name으로 인한 충돌 | Phase 0에서 감지하여 사용자에게 확인 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: `/analyze-renewal https://damha.co.kr`
2. Phase 0: `_workspace/`, `output/damha_co_kr/` 모두 없음 → 초기 실행
3. Phase 1: 디렉토리 생성
4. Phase 2: collector 실행 → 91 페이지 크롤링, 55 이미지, 스크린샷 캡처 성공
5. Phase 3: 3명 팀원 병렬 분석 (약 5~10분), 라이브러리 매핑 교차 검증
6. Phase 4: synthesizer가 4개 문서 생성
7. Phase 5: qa-reviewer가 PASS_WITH_WARNINGS (LOW 2건) 판정
8. Phase 6: 사용자에게 결과 경로 보고

### 에러 흐름
1. 사용자: `/analyze-renewal https://broken.example.com`
2. Phase 2: collector가 connection timeout 반복 → errors에 기록
3. collector_manifest.json의 errors가 비어있지 않음을 감지
4. 오케스트레이터가 즉시 종료, 사용자에게 "사이트 접근 불가, 로그: _workspace/raw/collector.log" 보고
5. _workspace/ 보존하여 사후 디버깅 가능하게 함

### 부분 재실행 흐름
1. 사용자: "디자인 토큰만 다시 추출해줘"
2. Phase 0: `_workspace/`, `output/damha_co_kr/` 존재 → 부분 재실행 모드
3. design-analyst만 단독 호출 (Phase 3 전체 대신)
4. synthesizer 재호출하여 PROJECT_BRIEF의 디자인 섹션만 갱신
5. qa-reviewer 재호출하여 경계면 정합성 재검증
6. 사용자에게 갱신 보고
