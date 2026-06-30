---
name: benchmark-recipe-writer
description: "분석 결과를 종합하여 BENCHMARK_RECIPE.md, PROJECT_BRIEF.md, 08-renewal-insights.md, COMPLETION_REPORT.md를 작성하는 스킬. 단순 합치기가 아니라 의사결정 근거와 복제용 AI 프롬프트를 자기완결적 형태로 생성한다. synthesizer 에이전트가 사용. 트리거: '벤치마킹 레시피', 'BENCHMARK_RECIPE', 'PROJECT_BRIEF', '복제용 프롬프트', '리뉴얼 인사이트', '종합 리포트'."
---

# Benchmark Recipe Writer — 종합 산출물 작성

세 분석가의 산출물을 통합하여 사용자가 실제로 활용할 수 있는 최종 4개 문서를 작성한다.

## 산출물 4종

| 파일 | 독자 | 목적 |
|------|------|------|
| `08-renewal-insights.md` | PM, 클라이언트 | 리뉴얼 의사결정 근거 (유지/개선/제거 + 우선순위) |
| `BENCHMARK_RECIPE.md` | 다른 프로젝트 개발자 | 이 사이트의 핵심 기능을 다른 곳에 복제하기 위한 레시피 |
| `PROJECT_BRIEF.md` | 다음 단계 디자인/FE/BE 에이전트 | 마스터 지시서 (스택, 디자인 시스템, 사이트 구조) |
| `COMPLETION_REPORT.md` | 사용자 (분석 의뢰자) | 한국어 종합 리포트 |

## 1. 08-renewal-insights.md 작성

### 구조

```markdown
# 리뉴얼 인사이트

## 1. 사이트 한 줄 정의
{무엇을 하는 사이트인가 — 업종, 핵심 서비스, 사용자}

## 2. 유지할 강점 (KEEP)
- {강점1}: 근거 + 이유
- ...

## 3. 개선할 약점 (IMPROVE)
| 우선순위 | 항목 | 현재 | 개선안 | 근거 |
|---------|------|------|--------|------|
| P0 | LCP 4.2s | 느림 | 이미지 최적화, 폰트 preload | Lighthouse |
| P1 | alt 누락 78% | 접근성 낮음 | alt 자동 생성 + 수동 보강 | tech-analyst |

## 4. 제거/통폐합 후보 (REMOVE)
- {thin page 통폐합}: 사유 + 영향 추정
- {레거시 라이브러리 교체}: 사유 + 대체안

## 5. 위험과 제약
- 라이센스, SEO 영향, 마이그레이션 비용

## 6. 권고 로드맵 (3단계)
- Phase A (P0): {즉시 적용}
- Phase B (P1): {디자인/스택 교체}
- Phase C (P2): {신기능}
```

### 작성 원칙

- 모든 권고에 **P0/P1/P2** 또는 **필수/권장/선택** 명시
- 근거는 분석가 산출물 인용 (예: "tech-analyst의 tech_benchmark_map.json에 따르면...")
- 추측 권고 금지 — 데이터로 뒷받침되지 않는 권고는 "추가 조사 필요"로 표시

## 2. BENCHMARK_RECIPE.md 작성

### 구조

```markdown
# 벤치마킹 레시피

## 사이트 한 줄 정의
{무엇을 하는 사이트인가 — 1줄}

## 핵심 기술 매핑 표

| 기술 | 버전 | 카테고리 | 적용 페이지 | 핵심 효과 | 리뉴얼 권장 대체 |
|------|------|---------|-----------|----------|---------------|
| Swiper | 10.x | 슬라이더 | `/`, `/portfolio` | 히어로 캐러셀 + 그리드 | swiper/react (유지) |
| AOS | 2.3 | 스크롤 애니메이션 | 전체 | 페이드인 효과 | Framer Motion (대체) |
| GSAP | 3.x | 고급 애니메이션 | `/about` | 타임라인 시퀀스 | Framer Motion (대체) |

## 복제용 프롬프트 세트

### Prompt 1: 히어로 슬라이더 복제

> 다음 사양에 맞는 풀스크린 히어로 슬라이더를 만들어주세요.
>
> - 라이브러리: swiper/react v10+
> - 슬라이드 수: 3장
> - 자동 재생: 5초 간격
> - 전환 효과: fade
> - 컨트롤: 화살표 + 페이지 인디케이터
> - 컬러: primary=#E47B41, secondary=#091F5B (Tailwind theme.extend에 등록)
> - 타이포: font-sans (Pretendard Variable), h1=48px, body=16px
> - 반응형: 모바일에서 텍스트 32px, 패딩 16px
> - CTA 버튼: primary 배경, 흰색 텍스트, radius 8px, hover시 accent(#EB6C4B)
> - 접근성: alt 텍스트 필수, prefers-reduced-motion 존중

### Prompt 2: 포트폴리오 그리드 카드

> ... (자기완결적, 디자인 토큰·기술·동작 요건 모두 포함)

### Prompt N: ...

## 벤치마킹 시 주의사항

- **라이센스**: {감지된 유료 라이브러리/폰트 목록}
- **이미지 저작권**: 본 분석은 fair use, 재사용 시 별도 검토
- **폰트 호스팅**: CDN 의존 시 가용성 / 셀프호스트 비용 비교
```

### 복제 프롬프트 작성 원칙 (가장 중요)

각 프롬프트는 **자기완결적(self-contained)** 이어야 한다. 다른 프로젝트에 그대로 붙여넣어 LLM에게 줬을 때 추가 컨텍스트 없이 작동해야 한다.

자기완결성 체크리스트:
- [ ] 사용할 기술/라이브러리 명시 (버전 포함)
- [ ] 디자인 토큰 (컬러 hex, 폰트, 타이포 스케일) 인라인 포함
- [ ] 반응형 동작 명시 (모바일 분기점, 변경 사항)
- [ ] 인터랙션 명세 (자동재생/hover/클릭/스크롤)
- [ ] 접근성 요건 (alt, aria, motion 존중)
- [ ] 참조 외부 자원 없음 ("위 표 참조" 같은 표현 금지)

**안티패턴:**

> ❌ "위 디자인 토큰을 사용해서 슬라이더를 만들어주세요"
> ✅ "primary=#E47B41 컬러를 사용한 슬라이더를 다음 명세대로 만들어주세요: ..."

## 3. PROJECT_BRIEF.md 작성

### 8개 필수 섹션

```markdown
# 📂 {사이트명} Renewal — Master Project Brief

**이 문서는 분석 결과를 기반으로 한 마스터 지시서입니다.**
**다음 단계의 디자인/FE/BE 에이전트는 작업 시작 전 반드시 이 문서를 숙지하십시오.**

## 1. 프로젝트 개요
- 클라이언트: {회사명}
- 업종: {업종}
- 핵심 서비스: {서비스 목록}
- 사이트 성격: {포트폴리오/커머스/콘텐츠 등}
- 주요 목표: {리뉴얼의 이유 — 데이터 기반 추론}

## 2. 기술 스택 목표
- Framework: {타깃 — tech-analyst 권장}
- Styling: {Tailwind 등}
- Animation: {Framer Motion 등}
- Components: {Shadcn/UI 등 또는 자체 디자인 시스템}
- Deployment: {Vercel/NAS 등}

## 3. 디자인 시스템 (Tailwind theme.extend 형식)

### 3.1 컬러 팔레트
- `primary`: #E47B41
- `secondary`: #091F5B
- ... (design_tokens.json 그대로 인용)

### 3.2 타이포그래피
- font-sans: Pretendard Variable, Pretendard, system-ui
- h1: 48px / line-height 1.3
- body: 16px / 1.6
- ...

### 3.3 간격·반경·그림자
- 8pt 그리드
- radius: sm 4 / md 8 / lg 16
- shadow.card: 0 4px 12px rgba(0,0,0,0.08)

## 4. 사이트 구조
- 메뉴: 회사소개 / 서비스 / 포트폴리오 / 문의
- URL 깊이: 3
- 페이지 우선순위:
  - P0 (반드시): /, /about, /contact
  - P1 (1차 리뉴얼): /portfolio, /service
  - P2 (추후): /blog/* (페이지 N개)

## 5. 핵심 컴포넌트
- 히어로 슬라이더 (Swiper or 자체 구현)
- 포트폴리오 카드 그리드
- 문의 폼 (검증 + 메일 전송)
- ...

## 6. 인터랙션 요건
- 스크롤 페이드인 (Framer Motion)
- 히어로 자동 슬라이드 (5s)
- 포트폴리오 hover 확대
- prefers-reduced-motion 지원

## 7. 성능·접근성 목표
- Lighthouse Performance ≥ 85 (현재 67)
- LCP ≤ 2.5s, CLS ≤ 0.1
- WCAG 2.1 AA 준수
- alt 텍스트 100%

## 8. 다음 단계 인계
- 디자인: `/design` 또는 figma 인계 시 본 문서 + design_tokens.json 함께 전달
- FE: `/fe` 시작 전 본 문서 + components/* 참조
- BE: 문의 폼 백엔드 — `/be 문의 폼 API` 명령으로 시작
```

## 4. COMPLETION_REPORT.md 작성

```markdown
# {사이트명} 분석 완료 리포트

## 분석 개요
- 대상: {URL}
- 분석 일시: {ISO date}
- 소요 시간: {N분 N초}

## 수집 통계
| 항목 | 결과 |
|------|------|
| 발견 페이지 | {N}개 |
| 다운로드 이미지 | {N}개 |
| PC 스크린샷 | {N}장 |
| Mobile 스크린샷 | {N}장 |
| 기술 스택 항목 | {N}개 |
| CSS 변수 컬러 | {N}개 |
| 감지 폰트 | {목록} |
| Lighthouse Performance | {점수} |

## 핵심 발견 5가지
1. ...
2. ...
3. ...
4. ...
5. ...

## 생성 산출물
- `08-renewal-insights.md` — 리뉴얼 의사결정
- `BENCHMARK_RECIPE.md` — 복제용 레시피
- `PROJECT_BRIEF.md` — 다음 단계 마스터 지시서
- (분석 중간 산출물: `_workspace/`)

## 다음 단계 안내
1. PROJECT_BRIEF.md 검토 후 클라이언트 컨펌
2. `/design` 으로 디자인 단계 시작
3. Contract Freeze 후 `/fe`, `/be` 병렬 진행

## QA 상태
- {PASS / PASS_WITH_WARNINGS / FAIL}
- 발견 이슈: BLOCKER {N} / HIGH {N} / MEDIUM {N} / LOW {N}
- 상세: `_workspace/qa/qa_report.md`
```

## 상충 데이터 처리

분석가 간 결론이 다를 때 (예: tech-analyst는 "Swiper 유지", design-analyst는 "자체 구현 권장"):

1. **삭제 금지** — 양쪽 모두 보존
2. **출처 명시** — "tech-analyst 관점: ... / design-analyst 관점: ..."
3. **추천안 제시** — synthesizer의 종합 판단을 1줄로 덧붙임 ("권장: ...")
4. qa-reviewer가 이를 별도로 검증

## 작성 후 자체 점검

- [ ] BENCHMARK_RECIPE의 모든 프롬프트가 자기완결적 (외부 참조 없음)
- [ ] PROJECT_BRIEF의 8개 섹션 모두 작성됨
- [ ] 08-renewal-insights의 모든 권고에 우선순위 부여
- [ ] design_tokens.json 의 컬러가 PROJECT_BRIEF 3.1에 그대로 반영
- [ ] tech_benchmark_map.json 의 라이브러리가 BENCHMARK_RECIPE 매핑 표에 모두 등장
- [ ] content_map.json 의 메뉴/IA 가 PROJECT_BRIEF 4 에 반영
- [ ] COMPLETION_REPORT 의 통계가 collector_manifest.json 과 일치
- [ ] 사이트명/회사명 표기 통일
- [ ] 모든 본문 한국어, 기술용어만 영문
