---
name: renewal-qa
description: 웹사이트 리뉴얼 분석 산출물의 완전성·정합성·한국어 품질을 검증하는 스킬. 수집 원본(pages.json, 03-design-tokens 등)과 분석 산출물(BENCHMARK_RECIPE, 05-components 등)의 경계면을 교차 비교하여 환각 경로·없는 컬러·누락 산출물을 스크립트로 잡아낸다. qa-validator 에이전트(general-purpose)가 사용. "QA 검증", "정합성 확인", "산출물 검수", "레시피 경로 검증", "품질 점검"을 요청하면 이 스킬을 사용하라.
---

# 리뉴얼 분석 산출물 QA

분석 산출물이 **수집된 원본 데이터와 일치하는지**, **산출물끼리 모순되지 않는지**를 교차 검증한다.

## 왜 이렇게 하는가

분석가는 자신감 있게 "메인에서 Swiper 사용", "primary는 #1A3B8C"라고 써낸다. 하지만 이것이 실제 pages.json·03-design-tokens의 데이터로 뒷받침되는지는 별개 문제다. LLM은 그럴듯한 경로/값을 **환각**할 수 있다. QA의 본질은 "파일이 있는가"가 아니라 **"경계면을 교차 비교했을 때 사실이 맞는가"**다. 그래서 눈으로 보지 않고 **스크립트로** 대조한다.

## 검증 항목 (경계면 교차 비교)

### 1. 완전성
기대 산출물 7종이 모두 존재하고 비어있지 않은가:
`05-components.md`, `07-performance-a11y.md`, `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `MASTER_REPLICATION_PROMPT.md`, `PRD.md`, `COMPLETION_REPORT.md`. 누락 시 책임 에이전트 명시.

### 2. 기술→페이지 매핑 정합성 (환각 검증, 최우선)
`BENCHMARK_RECIPE.md`와 `_workspace/tech_findings.md`가 인용한 페이지 경로가 `pages.json`에 실재하는가. **스크립트로 대조:**

```python
import json, re, sys
# pages.json에서 실제 URL/경로 집합 추출
data = json.load(open("output/{site}/pages.json", encoding="utf-8"))
real = set()
def walk(o):
    if isinstance(o, dict):
        for k,v in o.items():
            if k in ("url","path") and isinstance(v,str): real.add(v)
            walk(v)
    elif isinstance(o, list):
        for x in o: walk(x)
walk(data)
real_paths = {re.sub(r"https?://[^/]+","",u).rstrip("/") or "/" for u in real}
# 레시피에서 인용한 경로 추출 (코드블록/표의 `/...` 패턴)
recipe = open("output/{site}/BENCHMARK_RECIPE.md", encoding="utf-8").read()
cited = set(re.findall(r"`(/[^`]*)`", recipe))
ghost = {c for c in cited if c.rstrip("/") not in real_paths and c != "/"}
print("환각 의심 경로:", ghost or "없음")
```

`ghost`가 비어있지 않으면 blocker. 해당 경로를 인용한 레시피를 benchmark-synthesizer + tech-analyst에게 수정 요청.

### 3. 디자인 토큰 정합성
`05-components.md`/`design_findings.md`의 팔레트 HEX·폰트가 토큰 근거에 실재하는가. HEX를 정규식으로 뽑아 대조하되, **근거 파일은 `10-design-tokens-structured.md`(+`tokens/tokens.raw.json`)와 `03-design-tokens.md` 둘 다**이다 — computedStyle 기반 `10-`이 있으면 그 값이 1차 진실이므로, `10-`/`tokens.raw.json` *또는* `03-` 어디에든 있으면 통과. 둘 다에 없는 값만 환각 의심(blocker 후보).

> ⚠️ `10-`은 군집 대표색이라 `03-`의 raw HEX와 미세하게 다를 수 있다(예: `#533afd` vs `#5339fd`). 근접색(distance 작음)은 환각으로 보지 말 것 — 군집화 결과다.

### 4. 콘텐츠/IA 정합성
IA·CTA 분석이 `01-site-structure`/`04-content-inventory`/`pages.json`과 일치하는가. IA가 언급한 섹션/페이지 수가 실제와 맞는지 확인.

### 5. 레시피 실행 가능성
`BENCHMARK_RECIPE.md`의 각 레시피가 무엇을·어디서·어떻게(프롬프트) 3요소를 갖췄는가. 프롬프트 블록이 비어있거나 "멋지게 만들어줘" 수준이면 warning.

### 6. 마스터 프롬프트 전수 흡수 (near-clone 보증)
`MASTER_REPLICATION_PROMPT.md`가 `BENCHMARK_RECIPE.md`의 **모든 레시피를 흡수**했는가. 레시피 제목 목록을 뽑아 마스터 본문에 대응 컴포넌트/섹션이 있는지 대조 — 빠진 레시피가 있으면 warning(near-clone 누락). 또한 마스터에 ① 멀티 에이전트 역할 가이드, ② 안전(법적) 치환 규칙(이미지·문장·신원·면책), ③ 자기완결성(외부 파일 참조 없이 빌드 가능)이 있는지 확인. 없으면 warning.

```bash
# 레시피 제목 수 vs 마스터의 컴포넌트/섹션 헤더 수 개략 대조
grep -cE "^## 레시피 [0-9]+" output/{site}/BENCHMARK_RECIPE.md
grep -cE "^(###|##) " output/{site}/MASTER_REPLICATION_PROMPT.md
grep -qE "빌드 에이전트 구성|역할별" output/{site}/MASTER_REPLICATION_PROMPT.md && echo "역할가이드 OK" || echo "역할가이드 누락"
grep -qE "데모|가상|실제 의료기관 정보가 아닙니다" output/{site}/MASTER_REPLICATION_PROMPT.md && echo "면책 OK" || echo "면책 누락"
```

### 7. 한국어 품질
- 본문이 한국어인가, 기술 용어는 영문 유지했는가
- 깨진 표, 빈 섹션, 잔존 플레이스홀더(`{site}`, `{사이트명}`, TODO, `XXX`)가 있는가 — grep으로 일괄 점검

```bash
grep -rnE "\{site\}|\{사이트명\}|TODO|XXX|\bplaceholder\b" output/{site}/*.md
```

### 8. PRD 정합성 (페이지·개선 근거 검증)
`PRD.md`의 **페이지 맵 경로가 pages.json에 실재**하는가 — 항목 2와 동일한 스크립트로 PRD 본문의 `` `/...` `` 경로를 대조. "신규"로 명시되지 않은 환각 경로는 blocker. 또한 PRD의 "개선 반영" 항목이 `08-renewal-insights.md`의 개선/도입 항목에 실재하는지(없는 개선을 발명하지 않았는지), 각 P0 페이지에 목적·섹션·한글 콘텐츠·CTA가 채워졌는지(플레이스홀더 잔존 시 warning) 확인.

```bash
# PRD가 인용한 경로 중 pages.json에 없는 것 (신규 표기 제외 후 수동 확인)
grep -oE "`/[^`]*`" output/{site}/PRD.md | sort -u
# P0 페이지 섹션에 플레이스홀더가 남았는지
grep -nE "여기에|TODO|\{.*\}|플레이스홀더" output/{site}/PRD.md || echo "플레이스홀더 없음"
```

## 작업 방식 (점진적 QA)

전체 완성 후 1회가 아니라, **산출물이 나올 때마다 점진적으로** 검증한다. tech_findings가 나오면 즉시 항목 2를 돌린다. 각 분석가의 "완료" 메시지가 트리거다.

## 심각도

| 심각도 | 기준 | 처리 |
|--------|------|------|
| blocker | 환각 경로/값, 산출물 누락, 깨진 핵심 표 | 수정 전 통과 불가 |
| warning | 빈약한 프롬프트, 약한 근거, IA 수치 불일치 | 수정 권고 |
| nit | 사소한 표기/포맷 | 선택적 |

## 출력: `_workspace/qa_report.md`

```markdown
# QA 리포트 — {site}
| 항목 | 결과 | 심각도 | 위치 | 근거 | 수정 요청 대상 |
|------|------|--------|------|------|---------------|
| 완전성 | FAIL | blocker | 07 누락 | 파일 없음 | tech-analyst |
| 기술→페이지 | FAIL | blocker | RECIPE 레시피3 | `/about-us` pages.json에 없음 | benchmark-synthesizer |
...
## 종합 판정: BLOCKED / PASS
```

blocker가 0일 때만 오케스트레이터에게 "검증 통과"를 보고한다. 직접 산출물을 고치지 않는다 — 지적·재검증만 하고 수정은 원저자가 한다.

## 자가 점검

- [ ] 항목 2(환각 경로)를 눈이 아니라 **스크립트로** 돌렸는가?
- [ ] 모든 FAIL에 심각도와 수정 요청 대상을 붙였는가?
- [ ] blocker가 남아 있는데 "통과"로 보고하지 않았는가?
