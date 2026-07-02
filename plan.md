# Plan — 런타임 수집기 전수 캡처 보강

원칙: "가드로 방어"가 아니라 **수집기가 직접 전수 캡처** + **못 본 것은 커버리지로 가시화**.

## scripts/browser_analyze_site.js

- [x] 1. 클릭 후보 우선순위화·중복제거 (`prioritizeClickCandidates`, Node측)
  - 내부 페이지 이동 링크(크롤러가 커버) 제외, 모달 트리거/`onclick`/`#앵커`/`aria-controls`/`data-toggle`/tab·button 우선
  - 숨김 모달의 트리거는 최우선 주입. `DEFAULT_MAX_CLICKS` 14→24
- [x] 2. 숨김 모달 인벤토리 (`hiddenDialogs` in `collectPageSignals`)
  - visible 필터 없이 전수 수집(본문 500자) + 트리거 역매핑(`href="#id"`, `aria-controls`, `data-target`, onclick 내 id/class 참조)
- [x] 3. Swiper 상태 순회 (`traverseSwipers`)
  - 인스턴스별 `slideTo(i)` 전 슬라이드 순회(캡: swiper 6개·슬라이드 16장) → 슬라이드별 활성 텍스트 + **외부 연동 패널**(가시성이 슬라이드에 따라 변하는 콘텐츠 요소) 전문 캡처
- [x] 4. `changedEnough` 강화 — `stateFingerprint`(visible 텍스트 길이, active/on/open 클래스 수, dialog 텍스트) 비교 추가
- [x] 5. 클릭으로 열린 dialog 본문 캡처 — dialog text 90→300자 + `newDialogs` 기록
- [x] 6. 호버 확장 패널 실측 (`exploreHoverPanels`) — interactionPatterns 후보에 실제 hover, 폭 변화율·펼침 콘텐츠·스크린샷
- [x] 7. `collectScrollLinked` — 스크롤 위치 3→5개, 후보를 각 위치에서 재수집(키 병합)
- [x] 8. `sectionInteractions` 폴백 — 규약 셀렉터 매칭 실패 시 main/body 직계 자식(높이>200px)
- [x] 9. 커버리지 자가진단 (`coverage`) — 발견 vs 실측 집계 + 미탐 후보 목록 → md "커버리지" 섹션
- [x] 10. `markdownReport` 신규 섹션: 숨김 모달 인벤토리 / Swiper 상태 순회 / 호버 확장 실측 / 커버리지

## 하네스 동기화

- [x] 11. CLAUDE.md — 캡처 범위 ⑦~⑩ 추가 + 변경 이력 행
- [x] 12. renewal-qa SKILL.md — 최신성 판정에 신규 섹션 포함 + "커버리지 미탐 잔여" 점검 추가
- [x] 13. tech-analysis / content-analysis SKILL.md — (A) 상태 교체형 문구를 "요청하라"에서 "09의 Swiper 상태 순회 실측을 소비하라"로 갱신

## 검증

- [x] 14. `node scripts/browser_analyze_site.js https://www.afneyeclinic.com --site-name runtime_smoke --max-pages 1` 스모크 — hiddenDialogs·swiperStates·coverage 실데이터 확인 (모달 5종 전수+트리거, Swiper 13장 외부 패널 13종 전문, 커버리지 표 생성 확인)
