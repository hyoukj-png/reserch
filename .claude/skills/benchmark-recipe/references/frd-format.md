# FRD.md 형식 표준 — 기능 명세서 (Functional Requirements Document)

> 7번째 산출물. **Claude Design·IDE 에이전트가 그대로 구현 가능한 화면·컴포넌트·인터랙션 명세**를 만든다.
> 골격 선례: `output/afneyeclinic_com/FRD.md` (사용자 검수 완료본 — 구조·표기 규약의 기준).
> 레시피(부품)·마스터 프롬프트(빌드 지시서)와 달리, FRD는 **리뉴얼 구현팀의 단일 정답 소스(as-is 실측 + to-be 결정)**다.

## 표기 철칙 (★ 위반 시 QA blocker)

1. **추측 금지.** 모든 수치·색·폰트·config는 수집 데이터에서 추출. 각 값에 출처 표기.
2. **★실측** 표기는 `09-runtime-interactions.md`(또는 runtime-analysis.json)에 실제 근거가 있을 때만. 근거 없는 ★는 환각.
3. 확인 불가 값은 `[미확인]`, 근거 있는 추론은 `[추정 — 근거: …]`로 명시 구분. (FRD 프로젝트 `/frd` 스킬과 동일 규약)
4. **콘텐츠는 verbatim.** 문구·문항·가격·장비 설명은 수집 원문 그대로 — 창작 카피 0건. 특히:
   - 모달 본문 → 09의 **"숨김 모달/레이어 인벤토리"** + `pages/_modals.md`
   - 슬라이드 연동 콘텐츠(N종 전수) → 09의 **"Swiper 상태 순회"** 연동 패널
   - 자가진단 문항·결과 문구 → 09의 **"자가진단 위젯"**
5. As-Is(실측)와 To-Be(리뉴얼 결정)를 항상 구분한다. To-Be 결정에는 근거 한 줄.
6. 09의 **"커버리지 자가진단"**에 미탐 잔여가 있으면 FRD 헤더에 "⚠️ 미탐 영역: …(재수집 권장)"을 명시 — 누락을 침묵시키지 않는다.

## 문서 골격 (섹션 번호 고정)

```
# FRD — {사이트명} 웹사이트 리뉴얼 기능 명세서
> Functional Requirements Document · v{N} · {날짜}
> 데이터 출처 규약(★실측/[추정]/[미확인]) + 근거 파일 목록 + (있다면) ⚠️ 미탐 영역

## 0. 구현 스택 권고 (Target Stack)
   As-Is(추출) vs To-Be 권고 표 — 프레임워크/스타일/모션/슬라이더/미디어/아이콘.
   라이브러리 통합·제거 원칙(시각 결과물은 보존, 구현은 단일화)과 페이지별 로드 스코프(09 designSignals.libs).

## 1. 폰트 시스템 — ★실측
   1.1 페이지별 computed font 실측 표(본문/디스플레이/배경) ← 09 designSignals.fonts
   1.2 To-Be 통합 폰트 스택(CSS 변수 코드블록)
   1.3 타입 스케일 — 실측 fz 유틸/헤딩 스케일 ← 09 designSignals.typeScale

## 2. 디자인 토큰 (Design Tokens)
   2.1 컬러(실측 팔레트 + 의미 분류) ← 03-design-tokens + 09 designSignals.palette
   2.2 간격·반경·그림자  2.3 Breakpoints  2.4 Tailwind 매핑(코드블록)

## 3. 모션 토큰 — ★실측
   리빌 CSS(revealRules)·AOS 설정·GSAP ScrollTrigger config·duration/easing 공통값 ← 09

## 4. 레이아웃 컴포넌트 (Global Layout)
   4.x `<GlobalHeader>`/`<GlobalFooter>`/플로팅 요소/스크롤탑 — 실측 동작 포함

## 5. 인터랙션 명세 — ★실측 · 최우선
   유형별 서브섹션: 스크롤 리빌 / scrub 패럴랙스·스크롤 연동(scrollLinked) / Swiper 인스턴스별 정확 config
   / 자가진단 위젯(selfTestWidgets 실측 동작) / 확장 패널(hoverPanels 실측) / 모달(트리거→동작→본문)
   / 상태 교체형 콘텐츠(swiperStates 연동 패널 — 전환 로직 명세) / 모션 접근성(prefers-reduced-motion)
   각 항목: 트리거 → 동작 → 결과 + 재현 코드 힌트(GSAP/CSS/React 스니펫).

## 6. 페이지별 기능 명세 (Page Specs)
   6.0 페이지별 As-Is 실측 매트릭스(전 페이지 — 폰트/배경/라이브러리/핵심 인터랙션 한 줄씩)
   6.x 페이지별: 라우트(As-Is → To-Be), 섹션 구성(실측 순서), 섹션별 인터랙션(09 sectionInteractions 귀속 준수), 콘텐츠 포인터
   ※ 섹션 역할을 클래스명으로 추측 금지 — 09 섹션 귀속을 따른다.

## 7. 컴포넌트 카탈로그 (Component Library)
   레이아웃/콘텐츠/인터랙티브 위젯/버튼(실측 토큰)/카드·표 — 05-components와 정합.

## 8. 비기능 요구사항 (NFR)
   8.1 성능 예산(lighthouse 실측 기반)  8.2 접근성(WCAG 2.1 AA)  8.3 SEO  8.4 법적/규제(업종별 — 의료법 등)

## 9. 인수 기준 (Acceptance Criteria)
   기능 레벨 체크리스트 — 각 항목이 §5·§6의 실측 명세와 1:1 대응(검증 가능한 문장으로).

## 부록 A. As-Is 라이브 추출 원장
   09-runtime 핵심 실측값 압축 원장(자가진단·섹션순서·확장셀렉터·페이지 전수 매트릭스 등) — FRD 본문의 근거 스냅샷.

## 부록 B. 분석 산출물 교차 참조
   01~09·BENCHMARK_RECIPE·MASTER_REPLICATION_PROMPT·_workspace 파일 경로 목록.
```

## 데이터 소스 매핑 (필수 소비)

| FRD 섹션 | 1차 정답 소스 | 보조 |
|----------|--------------|------|
| §0 스택 | 02-tech-stack + 09 designSignals.libs(페이지별 스코프) | lighthouse.json |
| §1 폰트 | 09 designSignals.fonts/typeScale | 03-design-tokens |
| §2 토큰 | 03-design-tokens | 09 designSignals.palette |
| §3 모션 | 09 revealRules/aos/scrollTrigger | 06-interaction |
| §5 인터랙션 | **09 전체**(sectionInteractions·scrollLinked·selfTestWidgets·hiddenDialogs·swiperStates·hoverPanels·클릭 후 변화) | 05-components, 06-interaction |
| §6 페이지 | 09 sectionInteractions + pages/ + 01-site-structure | 04-content-inventory |
| §7 컴포넌트 | 05-components | 09 |
| §8 NFR | 07-performance-a11y + lighthouse.json | — |
| 콘텐츠 verbatim | 09 숨김 모달/Swiper 순회/자가진단 + pages/_modals.md + pages/*.md | 04-content-inventory |

## 검증 게이트 (작성 후 자가 점검)

- [ ] ★실측 표기 전수가 09(또는 runtime JSON)에 근거 존재
- [ ] 페이지 매트릭스(§6.0)가 pages.json 전 페이지를 커버 (누락 0)
- [ ] 09 커버리지의 미탐 잔여가 헤더 ⚠️로 승계됨 (또는 "미탐 없음")
- [ ] 숨김 모달 인벤토리의 모달 전수가 §5/§6에 반영 (본문 200자+ 모달 누락 = blocker)
- [ ] Swiper 연동 패널 N종이 콘텐츠 명세에 전수 반영 (1개 축소 = blocker)
- [ ] [추정]/[미확인] 표기 규약 준수, 창작 카피 0건
- [ ] §9 인수 기준이 §5·§6과 1:1 대응
