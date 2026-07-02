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
`05-components.md`, `07-performance-a11y.md`, `08-renewal-insights.md`, `BENCHMARK_RECIPE.md`, `MASTER_REPLICATION_PROMPT.md`, `FRD.md`, `COMPLETION_REPORT.md`. 누락 시 책임 에이전트 명시.

### 1.5 인터랙션 누락 4유형 점검 (★afneyeclinic 회귀 — 단일 스냅샷 맹점)
`09-runtime-interactions.md`가 **개선된 스크립트 최신본**인지부터 확인(09에 "섹션별 인터랙션 인벤토리"·"스크롤 연동 요소"·**"커버리지 자가진단"** 섹션이 없으면 stale → 재수집 요청, blocker). 그 다음 산출물이 다음을 빠뜨리지 않았는지 교차 확인:
- **(A) 상태 교체형:** 09의 **"Swiper 상태 순회"** 섹션에 슬라이드별 연동 패널이 실측돼 있다 — 산출물이 그 **연동 패널 전부(N개)** 를 담았는가, active 1개만 담고 끝냈는가(예: 장비 13종을 1개로 축소). 09에 N개가 있는데 산출물에 1개면 blocker. 09에 순회 섹션 자체가 없으면 stale.
- **(B) 섹션 귀속:** Swiper/슬라이더 역할이 **클래스명 추측**이 아니라 인벤토리의 소속 섹션과 일치하는가(`main_view`=히어로 식 오귀속 적발).
- **(C) 스크롤 연동:** "스크롤 연동 요소"에 잡힌 패럴랙스/드리프트(예: `.big_size`)가 산출물 모션 명세에 반영됐는가.
- **(D) ★실측 근거:** ★실측으로 표기된 인터랙션이 09에 실제 근거가 있는가(근거 없는 ★실측은 환각, blocker).
- **(E) 모달 전수:** 09의 **"숨김 모달/레이어 인벤토리"**(display:none 포함 전수 + 본문 실측)와 산출물의 모달 목록을 대조 — 인벤토리에 있는 모달이 산출물에 없으면 warning, 본문 200자 이상 모달 누락은 blocker. "모달 0개" 결론은 이 인벤토리가 0건일 때만 허용.
- **(F) 커버리지 잔여:** 09의 **"커버리지 자가진단"**에 `⚠️ 미탐 클릭 후보`가 남아 있거나 `Swiper N개 중 M개 순회(M<N)`이면, COMPLETION_REPORT에 잔여 미탐과 재수집 필요(`--max-clicks` 상향 등)가 명시됐는지 확인 — 미명시면 warning.

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
`05-components.md`/`design_findings.md`의 팔레트 HEX·폰트가 `03-design-tokens.md`에 실재하는가. HEX를 정규식으로 뽑아 토큰 파일과 대조. 없는 값은 환각 의심.

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

### 6.5 FRD 정합성 (구현 단일 정답 소스 보증)
`FRD.md`가 `references/frd-format.md`(benchmark-recipe 스킬) 골격·표기 철칙을 지켰는가:
- **★실측 근거:** FRD의 ★표기 항목을 표본 추출(최소 5건)해 `09-runtime-interactions.md`에 실제 근거가 있는지 대조 — 근거 없는 ★는 환각, blocker.
- **페이지 전수:** §6.0 As-Is 매트릭스의 페이지 수가 pages.json 실페이지 수(정규화 중복 제거 후)와 일치하는가 — 누락 페이지 있으면 warning, 핵심 페이지(GNB 노출) 누락은 blocker.
- **콘텐츠 verbatim 전수:** 09의 숨김 모달 인벤토리·Swiper 연동 패널 N종·자가진단 문항이 FRD §5/§6/부록에 반영됐는가 — 연동 패널 N종을 1개로 축소 시 blocker(1.5-(A)와 동일 기준).
- **커버리지 승계:** 09 "커버리지 자가진단"에 미탐 잔여가 있으면 FRD 헤더에 ⚠️ 미탐 명시가 있는가 — 미명시면 warning.
- **표기 규약:** `[추정]`/`[미확인]` 없이 단정한 비실측 값이 있는지 표본 점검. §0~§9 + 부록 A/B가 모두 존재하는가.

```bash
grep -c "★" output/{site}/FRD.md   # ★ 사용량 — 0이면 실측 미반영 의심
grep -qE "^## 9\.|인수 기준" output/{site}/FRD.md && echo "인수기준 OK" || echo "인수기준 누락"
grep -qE "\[추정|\[미확인" output/{site}/FRD.md && echo "표기규약 사용됨" || echo "표기규약 미사용 — 전량 단정 의심"
```

### 7. 한국어 품질
- 본문이 한국어인가, 기술 용어는 영문 유지했는가
- 깨진 표, 빈 섹션, 잔존 플레이스홀더(`{site}`, `{사이트명}`, TODO, `XXX`)가 있는가 — grep으로 일괄 점검

```bash
grep -rnE "\{site\}|\{사이트명\}|TODO|XXX|\bplaceholder\b" output/{site}/*.md
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
