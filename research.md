# Research — 런타임 수집 누락(모달·섹션 인터랙션) 근본 원인

날짜: 2026-07-02 · 대상: `scripts/browser_analyze_site.js` (899줄, 09-runtime-interactions.md 단일 정답 소스)

## 증상
페이지 분석 중 모달·섹션별 인터랙션이 자주 누락됨. 스킬 가드(누락 4유형 A~D)는 "재수집을 요청하라"고 방어할 뿐, 수집기 자체가 해당 상태를 캡처하지 못함.

## 구조적 원인 (코드 근거)

| # | 원인 | 코드 위치 | 결과 |
|---|------|-----------|------|
| 1 | 클릭 후보를 DOM 순서 상위 14개만 탐색(`slice(0, maxClicks)`), 우선순위·중복제거 없음 | `exploreClicks` L562, `DEFAULT_MAX_CLICKS=14` | 헤더 내비 `a[href]`(페이지 이동 — 크롤러가 이미 커버)가 예산을 소진 → 본문 하단 모달 트리거·탭이 클릭 자체가 안 됨 = **모달 누락 최대 원인** |
| 2 | 모달 수집이 `visible` 필터 적용 → 초기 상태에서 `display:none` 모달은 인벤토리 0건 | `dialogs` L194-213 | 숨김 모달은 "클릭으로 우연히 열렸을 때만" 존재가 드러남. 트리거 미클릭 시 완전 누락 |
| 3 | Swiper는 슬라이드 수만 보고(`sectionInteractions.swipers`) **상태 순회를 안 함** | L465-471 | 슬라이드 연동 외부 콘텐츠(장비 `.equip_content` 13종)를 1개만 수집 — 누락 4유형 (A) 미해결 |
| 4 | `changedEnough`가 url/bodyClass/dialog 수/aria-expanded 수만 비교 | L551-558 | 탭·아코디언처럼 클래스 토글로 콘텐츠 교체되는 변화를 "무변화"로 오판 → 스크린샷·기록 생략 |
| 5 | 클릭으로 열린 dialog의 텍스트가 90자 truncation(`textOf`) | L130-133 | 모달이 열려도 **본문이 산출물에 안 남음** — 분석가가 내용을 창작하게 됨 |
| 6 | 가로 확장 패널(`interactionPatterns`)은 기하 시그니처로 "추정"만 하고 hover 실측 없음 | L317-364 | 확장 방향·펼침 콘텐츠 미실측("추정" 표기 상태 지속) |
| 7 | `scrollLinked` 후보를 스크롤 0 위치에서 1회만 선정 | L513-519 | 스크롤 후에야 inline 스타일을 받는 요소는 후보에서 제외 → 패럴랙스 일부 누락 |
| 8 | `sectionInteractions` 셀렉터가 `sec/section/st*` 클래스 규약 의존 | L455 | 규약이 다른 사이트는 섹션 인벤토리가 통째로 빔 |
| 9 | **커버리지 자가진단 없음** — 무엇을 못 봤는지 산출물에 안 남음 | 전체 | 누락이 침묵 속에 발생, QA가 적발 불가 |

## 제약
- 09-runtime-interactions.md / runtime-analysis.json 소비처(tech/design/content 분석 스킬, renewal-qa)는 기존 섹션 제목을 grep 함 → 기존 섹션 제목·구조 유지, 신규 섹션 추가 방식으로 확장.
- Playwright(로컬 node_modules 존재), Node v25. 페이지당 수집 시간이 과도해지지 않도록 상태 순회 캡 필요.
