# 개선 계획서 — `design-extract`(designlang) 벤치마킹 비교 분석

> **목적:** 외부 오픈소스 [`Manavarya09/design-extract`](https://github.com/Manavarya09/design-extract)(npm: **designlang** v12.16.0, MIT)를 우리 *웹사이트 리뉴얼 분석 하네스*와 심층 비교하여, 도입 가치가 높은 개선·보완 항목을 우선순위와 함께 제안한다.
> **작성일:** 2026-06-09 · **상태:** P1·P2·P3 실행 완료 (2026-06-27 갱신)
> **라이선스 참고:** 대상 레포는 **MIT** → 로직 포팅·참조 가능(저작권 고지 유지 권장).
>
> **진척(2026-06-27 v12.21 재검토):** P1(computedStyle·컬러 클러스터링·스케일)·P2-1(DTCG/Tailwind/CSS)·P2-2(모션 토큰)·P3-3(WCAG 대비)는 `tokenize.js`로 **완료**. 금회 **P3-1(디자인 스코어를 5→7카테고리 가중 평균)**·**P3-2(`section_roles.js` → `runtime/section-roles.json` IA 시드)**까지 완료. 대상은 v12.16→**v12.21**로 진화했으나 신규 기능(studio 토큰 에디터·verify 충실도·멀티플랫폼 emit)은 모두 본 문서 §4 제외 범위(제품화/창작/다중 플랫폼) 또는 P4(드리프트/비주얼 diff)에 해당 → **추가 도입 없음**. 남은 항목은 P4(드리프트·anatomy)뿐이며 수요 발생 시 착수.
>
> **⚠️ 재검토(2026-07-02) — 업스트림 소멸:** GitHub 리포 `Manavarya09/design-extract`와 저자 계정이 **모두 삭제(404)**. npm `designlang` 최신은 여전히 **v12.21.0**(2026-06-14 배포)으로 지난 검토와 동일 → **신규 도입 항목 없음**. 유일한 잔존 소스는 npm 타볼(`designlang-12.21.0.tgz`, MIT, 166파일/약 1.1MB)이며 업스트림은 사실상 **유지보수 종료**. 대응 계획은 §8 참조.

---

## 0. 한 줄 요약

design-extract는 **"라이브 DOM의 computed style을 결정론적으로 읽어 38종의 기계가독(machine-readable) 산출물(DTCG 토큰·Tailwind·Figma·모션 토큰 등)을 자동 생성"**하는 성숙한 도구다. 우리 프로젝트는 **"정적 수집 + AI 에이전트의 한국어 정성 분석 + 복제 프롬프트"**가 강점이다. 두 도구는 **목적이 다르므로 통째로 대체할 대상이 아니라, 우리 미션(리뉴얼 벤치마킹·복제)을 강화하는 "추출 정확도·구조화 출력" 모듈을 선별 도입**하는 것이 핵심이다.

---

## 1. 두 프로젝트의 본질 비교

| 축 | 우리 프로젝트 (reserch 하네스) | design-extract (designlang) |
|---|---|---|
| **목적** | 리뉴얼·벤치마킹 인사이트 + AI 복제 프롬프트 생성 | 디자인 시스템을 결정론적으로 추출해 "바로 쓰는" 토큰/코드로 배포 |
| **수집 방식** | 정적 1차(requests+BeautifulSoup, regex) + Playwright 런타임 보강 | Playwright로 **모든 요소의 computedStyle을 라이브 DOM에서 직독** |
| **분석 주체** | Claude Code 에이전트(기술/디자인/콘텐츠) 정성 분석 | 48개 결정론적 extractor + 38개 formatter |
| **산출물** | 한국어 마크다운 리포트 + `BENCHMARK_RECIPE` + `MASTER_REPLICATION_PROMPT` | DTCG JSON·Tailwind·shadcn·Figma·모션·anatomy 스텁·brand book·Next.js starter |
| **정량 지표** | 거의 없음(정성 위주) | 디자인 스코어 A–F(7개 카테고리), WCAG 대비 |
| **배포 면** | 로컬 하네스 | CLI + VS Code/Raycast/Figma/Chrome 확장 + MCP + GitHub Action |
| **규모** | `analyze_site.py` 1.6k줄 + JS 런타임 | src 약 19.7k줄, v12까지 진화 |

**결론:** 우리의 약점은 정확히 design-extract의 강점인 **(a) 토큰 추출 정확도**와 **(b) 구조화·기계가독 출력**이다. 반대로 우리의 한국어 AI 정성 분석·복제 프롬프트는 design-extract에 없다. → **추출/구조화 레이어만 선별 보강.**

---

## 2. 기능 매트릭스 (우리 ↔ 대상)

| 기능 | 우리 | design-extract | 격차/메모 |
|---|---|---|---|
| 컬러 수집 | △ CSS변수 regex + inline HEX | ◎ computedStyle 전수 + **클러스터링·역할분류(primary/neutral/semantic)** | **큰 격차** — 우리는 실제 렌더 색·브랜드색 식별 불가 |
| 타이포 | △ font-family만 | ◎ family/weight/size **스케일** | 타입 스케일 부재 |
| 간격/radius/shadow 토큰 | ✕ | ◎ spacing/borders/shadows extractor | 컴포넌트 복제 필수 요소 누락 |
| 모션(duration/easing/keyframe) | △ 정성 기술 | ◎ **구조화 토큰 + spring 감지 + CSS/Tailwind emit** | 동적 복제 정확도 격차 |
| 접근성 | △ Lighthouse | ◎ **색쌍 WCAG 대비 전수 계산** + a11y 교정 | 정량 대비 점수 부재 |
| 컴포넌트 | ○ 정성 카탈로그(05) | ◎ anatomy 트리 + variant×state 매트릭스 + 타입 스텁 | 코드화 가능성 격차 |
| IA/섹션 의미 | ○ 정성 IA | ◎ **section-roles 자동분류**(hero/pricing/faq/stats…) | 자동 라벨링 부재 |
| 디자인 점수 | ✕ | ◎ A–F 7카테고리 | 리뉴얼 전후 정량 비교 불가 |
| 구조화 출력 | ✕ (한국어 MD만) | ◎ DTCG/Tailwind/CSS vars/Figma/shadcn | 개발팀 즉시 사용성 격차 |
| 드리프트/비주얼 diff | ✕ | ◎ drift/visual-diff/CI | 리뉴얼 전후 회귀비교 |
| AI 한국어 정성 분석 | ◎ | ✕ | **우리 고유 강점** |
| 복제용 프롬프트(v0/Lovable/Cursor) | ◎ MASTER_REPLICATION_PROMPT | ○ prompt-pack | 우리가 더 서사적·한국어 |
| 모달/숨김 콘텐츠 복구 | ◎ (정적 복구) | △ | **우리 고유 강점** |

(◎ 강함 / ○ 있음 / △ 부분 / ✕ 없음)

---

## 3. 도입 권장 항목 (우선순위)

### 🔴 P1 — 추출 정확도의 근본 보강 (효과 최대)

**P1-1. computedStyle 기반 토큰 수집으로 전환/보강**
- *현황:* `phase5_design_tokens`는 CSS 파일 텍스트 regex + inline HEX만 본다(`analyze_site.py:776-843`). 실제 렌더링 색/폰트/간격을 못 봐 데드 CSS·미사용 변수까지 토큰으로 오인.
- *대상 방식:* Playwright로 페이지 내 요소를 순회하며 `getComputedStyle` 수집 → `colors.js`/`typography.js`/`spacing.js`가 소비.
- *우리 적용:* **이미 `browser_analyze_site.js`(Playwright)가 있으므로**, 런타임 패스에서 computedStyle 덤프를 추가 수집해 토큰 산출의 1차 근거로 승격. 정적 regex는 보조로 강등.
- *근거 정합성:* 우리 메모리의 "로드 vs 실사용 라이브러리" 맹점([[collection-misses-loaded-vs-used-libs]])과 같은 결의 개선 — **선언된 것이 아니라 실제 쓰인 것**을 본다.

**P1-2. 컬러 클러스터링 + 역할 분류(primary/neutral/semantic)**
- *대상 로직:* `extractors/colors.js` — `clusterColors`로 근접색 병합, "interactive 배경"(버튼/CTA) 빈도로 **primary 브랜드색 자동 식별**, 채도/명도로 neutral 분리.
- *우리 적용:* `03-design-tokens.md`와 `BENCHMARK_RECIPE`의 🎨 파트에 "대표 팔레트 + 역할"을 자동 제시 → 마스터 복제 프롬프트 품질 직결.

**P1-3. 타입/간격/radius/shadow 스케일 토큰화**
- *현황:* 폰트 패밀리만, 스케일·간격·그림자·라운드 토큰 전무.
- *대상:* `typography.js`(size 스케일), `spacing.js`, `borders.js`, `shadows.js`.
- *우리 적용:* 컴포넌트 복제에 필수인 수치 토큰 확보 → `05-components.md`·마스터 프롬프트가 "px 매직넘버" 대신 토큰으로 기술.

### 🟠 P2 — 구조화·기계가독 출력 추가 (개발 인수인계 가치)

**P2-1. DTCG/Tailwind/CSS-vars 산출물 추가**
- *현황:* 산출물이 전부 한국어 마크다운 → 리뉴얼 **개발팀이 바로 못 씀**.
- *대상:* `formatters/dtcg-tokens.js`(W3C DTCG, `$value/$type`), `tailwind.js`, `css-vars.js`, `design-md.js`.
- *우리 적용:* 신규 산출물 `tokens.dtcg.json` + `tokens.tailwind.js` + `tokens.css`를 `output/{site}/`에 추가. **MASTER_REPLICATION_PROMPT가 이 파일을 참조**하면 수신 AI의 복제 실행성↑. (한국어 리포트는 유지 — 사람용/기계용 분리.)

**P2-2. 모션 토큰 추출(duration/easing/keyframe + spring 감지)**
- *대상:* `extractors/motion.js` — easing을 cubic-bezier로 의미 분류, overshoot=spring 감지, duration 의미명(instant/sm/md/lg) 부여; `motion-css.js`/`motion-tailwind.js`로 emit.
- *우리 적용:* `09-runtime-interactions.md`(이미 동적 상태 1차 근거)에 **모션 토큰 절**을 추가 → 동적 사이트 복제 정확도.

### 🟡 P3 — 정량 지표·의미 분류 (리포트 설득력)

**P3-1. 디자인 스코어/그레이드(A–F)** ✅ *완료(2026-06-27): `tokenize.js scoreDesign`이 7카테고리(컬러 규율·타이포 일관성·간격 규율·엘리베이션·Radius·접근성·모션) 가중 평균으로 산출.*
- *대상:* `extractors/scoring.js` — 컬러 규율/타이포 일관성/대비/모션 등 7카테고리, 실제 프로덕션 사이트(Linear/Stripe/Vercel) 기준으로 보정된 룰.
- *우리 적용:* `08-renewal-insights.md`에 **현 사이트 점수 + 벤치마크 대상 점수 비교표** → 리뉴얼 ROI 설득 근거. (한국어 카테고리명으로 래핑.)

**P3-2. section-roles 자동 분류 → IA 분석 보강** ✅ *완료(2026-06-27): `scripts/section_roles.js` 포팅(한글 키워드 보강) → 런타임 패스가 `runtime/section-roles.json` 생성, content-analysis가 페이지 내부 IA 시드로 소비.*
- *대상:* `extractors/section-roles.js` — hero/pricing/faq/stats/comparison/steps/gallery/bento 등 정규식+휴리스틱 라벨링.
- *우리 적용:* `content-analysis` 스킬의 IA 해석에 자동 섹션 라벨을 시드로 제공(에이전트가 한국어로 재해석).

**P3-3. WCAG 대비 전수 계산**
- *대상:* `extractors/accessibility.js`/`scoring.js`의 색쌍 대비 로직.
- *우리 적용:* `07-performance-a11y.md`에 "대비 미달 색쌍" 표 추가(현재 Lighthouse 요약만).

### ⚪ P4 — 선택/후순위 (리뉴얼 전후 비교 시)

- **드리프트 / 비주얼 diff** (`drift.js`, `visual-diff.js`): 리뉴얼 **전후** 또는 **벤치마크 대상 간** 회귀 비교가 필요할 때. 일회성 분석 위주인 현 워크플로우에선 후순위.
- **컴포넌트 anatomy 스텁**(`component-anatomy.js`): `05-components.md`를 코드화 가능한 variant×state 매트릭스로 격상. 복제 프롬프트 고도화 시.

---

## 4. 도입하지 않을 항목 (범위 밖 — 명시적 제외)

| 항목 | 제외 사유 |
|---|---|
| Next.js starter `clone` 생성 | 우리 철학은 "코드 직접생성"이 아니라 **복제 프롬프트 산출**. 산출물 책임범위 다름 |
| VS Code/Raycast/Figma/Chrome 확장, 마켓플레이스 배포 | 리뉴얼 분석 하네스 미션과 무관(제품화 트랙) |
| MCP 서버 노출 | 현재 Claude Code 하네스로 충분, 외부 에이전트 노출 수요 없음 |
| `remix`/`battle`/`pair` 창작 변형 | 분석이 아닌 디자인 창작 — 범위 밖 |
| iOS/Android/Flutter 다중 플랫폼 출력 | 대상이 **웹 리뉴얼** — 불필요 |

---

## 5. 단계별 실행 로드맵 (제안)

> 각 단계는 독립 PR 단위. P1이 가장 ROI 높음.

1. **Step 1 (P1-1·P1-2·P1-3):** `browser_analyze_site.js`에 computedStyle 덤프 수집 추가 → 신규 `scripts/tokenize.js`(또는 파이썬 후처리)에서 클러스터링·역할분류·스케일화. 산출: `03-design-tokens.md` 강화 + `tokens.raw.json`.
   - design-extract의 `colors.js`/`typography.js`/`spacing.js` 로직 포팅(MIT 고지).
2. **Step 2 (P2-1):** `tokens.raw.json` → `tokens.dtcg.json`/`tokens.tailwind.js`/`tokens.css` 변환기 추가. `DESIGN.md` 산출물 목록·`renewal-analysis`/`benchmark-recipe` 스킬에 신규 산출물 반영.
3. **Step 3 (P2-2):** 모션 토큰 추출을 런타임 패스에 추가 → `09-runtime-interactions.md` 절 추가.
4. **Step 4 (P3-1·P3-3):** 스코어링·WCAG 대비 → `07`·`08` 리포트에 정량표.
5. **Step 5 (P3-2):** section-roles 시드를 `content-analysis` 입력으로.
6. **Step 6 (P4, 선택):** 드리프트/anatomy — 수요 확인 후.

**하네스 동기화 필수:** 산출물이 늘면 `CLAUDE.md` 변경이력·`DESIGN.md` 아키텍처·각 스킬(`renewal-analysis`, `benchmark-recipe`, `renewal-qa`)의 산출물 목록과 QA 검증 항목을 함께 갱신해야 정합성이 유지됨.

---

## 6. 리스크 / 주의

- **목적 혼입 경계:** design-extract는 "토큰 배포 도구", 우리는 "분석·복제 하네스". 결정론적 추출이 AI 정성 분석을 **대체하지 않고 입력 근거를 강화**하는 선에서만 도입. (한국어 리포트·복제 프롬프트는 유지.)
- **포팅 비용:** Node 기반 로직을 우리 Playwright(JS) 패스에 합치는 게 자연스러움. 파이썬 측에 무리하게 재구현하지 말 것.
- **라이선스:** MIT — 포팅 시 원저작권 고지 파일/주석 유지 권장.
- **수집 맹점 정합:** computedStyle 전환은 우리 기존 학습([[collection-misses-js-modals]], [[collection-misses-loaded-vs-used-libs]])과 같은 방향. 단, 클릭 전 숨김 모달 토큰은 여전히 별도 패스 필요.
- **과확장 경계:** 38 formatter 전부가 아니라 **DTCG/Tailwind/CSS/모션 4종**으로 한정. 나머지는 수요 기반.

---

## 7. 검토 요청 사항 (의사결정 필요)

1. **범위:** P1·P2까지를 1차 목표로 할지, P3 정량지표까지 묶을지?
2. **출력 철학:** 기계가독 토큰 파일(DTCG/Tailwind)을 산출물에 **정식 추가**할지(개발 인수인계 강화) vs. 분석 리포트 순수성 유지?
3. **구현 위치:** 토큰 추출을 Playwright(JS) 단일 경로로 통합할지, 파이썬 후처리와 분담할지?
4. **포팅 vs 의존성:** `designlang`을 npm 의존성으로 직접 `require`할지(빠름, 버전추적) vs. 핵심 로직만 발췌 포팅할지(가벼움, 결합도↓)?
   - *(2026-07-02 결론: 업스트림 소멸로 **발췌 포팅**이 유일한 선택지. §7-4 종결.)*

---

## 8. 소스 보존(클론) 계획 — 업스트림 소멸 대응 (2026-07-02 수립)

**배경:** GitHub 원 리포·저자 계정 삭제로 P4(드리프트/비주얼 diff·컴포넌트 anatomy) 착수 시 참조할 소스가 npm 타볼밖에 없다. npm도 저자가 계정을 정리한 정황상 영구 보장이 없으므로, **최종판 v12.21.0을 로컬에 아카이브**해 둔다.

| 단계 | 작업 | 비고 |
|---|---|---|
| **1. 타볼 아카이브(즉시)** | `curl -O https://registry.npmjs.org/designlang/-/designlang-12.21.0.tgz` → `vendor/designlang-12.21.0/`에 압축 해제 후 커밋 | MIT·166파일·언팩 약 1.1MB. `LICENSE` 파일 원본 유지(MIT 고지 의무) |
| **2. 무결성 기록** | npm 레지스트리의 `dist.integrity`(sha512)를 `vendor/designlang-12.21.0/PROVENANCE.md`에 기록 + 출처(원 GitHub URL·삭제 확인일·npm 배포일) 명시 | 향후 소스 진위 검증용 |
| **3. 의존 관계 명확화** | `vendor/`는 **참조 전용**(빌드·런타임에서 import 금지) — 우리 파이프라인은 이미 발췌 포팅(`tokenize.js`, `section_roles.js`)으로 자립 완료 | 결합도 0 유지 |
| **4. P4 착수 시 활용** | 드리프트(`drift.js`)·비주얼 diff(`visual-diff.js`)·anatomy(`component-anatomy.js`)를 아카이브에서 발췌 포팅 | 수요 발생 시 |
| **5. 하네스 동기화** | 아카이브 커밋 시 `CLAUDE.md` 변경 이력에 1행 추가 | — |

**모니터링 종료:** 업스트림이 죽었으므로 정기 버전 재검토는 **중단**. 본 문서는 P4 착수 전까지 동결.
