---
name: design-token-extraction
description: "수집된 사이트 데이터(CSS 변수, Computed Style, 이미지 팔레트, 폰트 메타, 스크린샷)에서 Tailwind/디자인 시스템에 그대로 이식 가능한 디자인 토큰을 추출하는 스킬. 컬러 의미 분류, 타이포 스케일 정규화, 8pt 그리드 추론, 컴포넌트 토큰화 패턴을 포함한다. design-analyst 에이전트가 사용. 트리거: '디자인 토큰', '디자인 시스템 추출', 'Tailwind config 생성', '컬러 팔레트 분류', '타이포 스케일'."
---

# Design Token Extraction — 디자인 시스템 역설계

수집된 원시 데이터(`03-design-tokens.md`, `analysis_data.json`, 스크린샷)에서 즉시 이식 가능한 디자인 토큰을 추출하는 방법론.

## 핵심 원칙

1. **의미 기반 네이밍** — `color-1`, `color-2` 가 아니라 `primary`, `secondary`, `surface-alt`, `text-main` 처럼 역할 기반
2. **이식 가능성** — Tailwind `theme.extend` 또는 CSS Custom Properties 형식으로 즉시 복사 가능
3. **출처 명시** — 각 토큰이 어느 페이지/컴포넌트에서 추출되었는지 기록
4. **시각 검증** — 스크린샷으로 추출된 토큰의 시각적 일치 확인

## 토큰 추출 단계

### 1. 컬러 시스템

**입력 데이터:**
- ★`runtime_extract.json` 의 `palette`(페이지별 textColors/bgColors 실측 빈도) + `## 6. 통합 팔레트`(runtime_extract.md) — **1차 정답**. 페이지(캠페인)별 팔레트 분기를 그대로 포착하므로, 랜딩별 액센트 분기는 이 실측으로 토큰화.
- `analysis_data.json` 의 CSS 변수 (`--primary`, `--bg-1` 등 — 템플릿 잔재 가능, 런타임과 상충 시 런타임 우선)
- Computed Style 에서 추출된 색상 빈도표
- 이미지 팔레트 (Color Thief 결과)

**분류 방법:**

| 의미 | 판별 단서 |
|------|----------|
| `primary` | CTA 버튼, 링크, 강조 텍스트에서 가장 자주 등장하는 채도 높은 색 |
| `secondary` | 헤더 배경, h1, 신뢰감 부여 영역에 쓰이는 안정적 톤 (다크 네이비/그레이 등) |
| `accent` | hover 상태, 알림, 보조 강조에 쓰이는 색 |
| `surface-light` / `surface` / `surface-alt` | 페이지 배경, 섹션 교대 배경 (보통 화이트/오프화이트/연한 파스텔) |
| `text-main` / `text-sub` | 본문 #222 ~ #444 / 보조 #666 ~ #888 |
| `border` | 카드/입력 테두리 #DDD ~ #EEE |
| `success` / `warning` / `danger` | 폼 검증 메시지, 알림 색 (있으면) |

**의사 결정 절차:**
1. CSS 변수에 이미 의미 이름이 있으면(`--brand-primary`) 그대로 매핑
2. 변수가 추상적 이름이면(`--color-1`) Computed Style 의 사용 빈도와 컨텍스트로 추론
3. 변수가 없으면 이미지 팔레트의 상위 5색 + 헤더/푸터 스크린샷 시각 분석

**Tailwind 출력 형식:**

```js
// _workspace/analysis/tailwind.config.snippet.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#E47B41',
        secondary: '#091F5B',
        accent: '#EB6C4B',
        surface: { light: '#FAFDFF', DEFAULT: '#FFFFFF', alt: '#F2FAFF' },
        text: { main: '#222222', sub: '#666666' },
      },
    },
  },
};
```

### 2. 타이포그래피

**입력:**
- ★`runtime_extract.json` 의 `fonts`(페이지별 본문 1순위 computed font-family·usageTop·faceFamilies) + `typeScale`(실측 font-size 빈도·헤딩별 fontSize/lineHeight/fontWeight/letterSpacing·fzUtilities) — **1차 정답**. 본문/헤딩 폰트와 타입스케일은 @font-face 선언 목록이 아니라 **실제 렌더된 computed 값**으로 판정(예: CSS에 Pretendard 선언이 있어도 실측 본문이 Noto Sans KR이면 Noto Sans KR이 본문 폰트). 페이지별 디스플레이 세리프 분기도 usageTop으로 포착.
- 폰트 감지 결과 (`analysis_data.json` 또는 `02-tech-stack.md` — 보조)
- Computed Style 에서 추출된 font-size 빈도표

**정규화 방법:**

1. 감지된 폰트 패밀리를 fallback 체인으로 정리:
   ```
   font-sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'system-ui', 'sans-serif']
   ```
2. font-size 빈도 상위 6개를 h1~h6, body, caption 으로 매핑
3. 비표준 사이즈(예: 14.5px)는 가까운 표준값(14px, 16px)으로 정규화하되, 원본도 함께 기록
4. 행간(line-height) 추출 — 본문 1.5~1.7, 헤딩 1.2~1.4 패턴

**출력 형식:**

```json
{
  "typography": {
    "fontFamilies": {
      "sans": ["Pretendard Variable", "Pretendard", "system-ui", "sans-serif"],
      "serif": null,
      "mono": null
    },
    "fontSize": {
      "h1": "48px", "h2": "36px", "h3": "28px",
      "h4": "22px", "h5": "18px", "h6": "16px",
      "body": "16px", "caption": "14px"
    },
    "lineHeight": { "heading": "1.3", "body": "1.6" },
    "fontWeight": { "regular": 400, "medium": 500, "bold": 700 }
  }
}
```

### 3. 간격·반경·그림자

**8pt/4pt 그리드 추론:**
- Computed Style 에서 추출된 margin/padding 값들을 모아서 GCD 또는 mode 분석
- 가장 흔한 단위가 8의 배수 → 8pt 그리드
- 4의 배수가 더 많고 8의 배수가 드물면 → 4pt 그리드

**스케일 정의 (예시 — 8pt 기준):**

```json
{
  "spacing": {
    "scale": "8pt grid",
    "tokens": {
      "0": "0", "px": "1px",
      "xs": "4px",  "sm": "8px",  "md": "16px",
      "lg": "24px", "xl": "32px", "2xl": "48px", "3xl": "64px"
    }
  }
}
```

**Border Radius:**
- 카드/이미지에서 추출된 border-radius 값을 sm/md/lg/full 4단계로
- `9999px` 또는 `50%` → `full`

**Box Shadow:**
- 카드/모달에서 추출된 shadow 를 단계화: `sm`(미세), `card`(기본 카드), `lg`(모달/팝오버)

### 4. 컴포넌트 토큰

스크린샷과 페이지 본문을 함께 보고 반복 컴포넌트의 토큰을 추출:

| 컴포넌트 | 추출 항목 |
|---------|----------|
| 버튼 | padding (X/Y), border-radius, font-size, 상태별 (default/hover/disabled) 색 |
| 카드 | padding, gap, border-radius, shadow, 호버 효과 |
| 입력 필드 | padding, border, focus 상태, error 상태 |
| 헤더 | 높이, padding-X, 배경(스크롤 전/후), 메뉴 간격 |
| 내비 | 항목 간격, 활성 상태 표시 방식 |

**출력 형식 (선택적, design_tokens.json 의 components 섹션):**

```json
{
  "components": {
    "button": {
      "padding": { "x": "16px", "y": "8px" },
      "radius": "8px",
      "fontSize": "14px",
      "variants": ["primary", "secondary", "ghost"]
    },
    "card": {
      "padding": "24px",
      "radius": "12px",
      "shadow": "0 4px 12px rgba(0,0,0,0.08)"
    }
  }
}
```

### 5. 반응형 분기

- PC와 Mobile 스크린샷을 비교하여 어떤 토큰이 breakpoint에서 변하는지 확인
- 일반적으로 변하는 것: font-size (헤딩만), spacing 일부, 컬럼 수
- 거의 변하지 않는 것: 컬러, font-family, border-radius

```json
{
  "breakpoints": {
    "mobile": "0px",
    "tablet": "768px",
    "desktop": "1280px"
  },
  "responsive_overrides": {
    "h1": { "mobile": "32px", "desktop": "48px" }
  }
}
```

## 시각 검증 절차

1. 추출된 컬러를 `design_tokens.json` 에 정리
2. 스크린샷 중 대표 페이지 1~2개를 Read 도구로 직접 시각 확인
3. primary 컬러가 실제 CTA 버튼에 적용된 색과 일치하는지 확인
4. 본문 텍스트 색이 #222 류와 시각적으로 일치하는지 확인
5. 불일치 발견 시 → 컬러 재추출 + 사유 기록

## 출력 산출물

| 파일 | 형식 | 용도 |
|------|------|------|
| `_workspace/analysis/03_design_system.md` | 마크다운 | 인간 가독, 분석 보고서 |
| `_workspace/analysis/design_tokens.json` | JSON | 머신 가독, PROJECT_BRIEF/synthesizer 입력 |
| `_workspace/analysis/tailwind.config.snippet.js` | JS | 그대로 복사하여 tailwind.config.js 의 `theme.extend` 에 병합 |

## 안티패턴

| 하지 말 것 | 이유 |
|-----------|------|
| 모든 추출된 컬러를 그대로 토큰화 | 노이즈 포함, 의미 없는 변형들로 토큰이 부풀려짐 |
| 의미 없는 이름 (`color-blue-1`) | 다른 프로젝트 이식 시 무용 |
| 시각 검증 없이 출력 | CSS 변수와 실제 적용이 다른 경우 잡지 못함 |
| 컴포넌트 토큰을 모든 변형까지 분리 | 필수 토큰만 — 변형은 PROJECT_BRIEF의 컴포넌트 명세에 위임 |
| 라이센스 미확인 폰트를 그대로 권장 | 리뉴얼 시 법적 리스크 |

## 라이센스 확인

감지된 폰트가 다음 카테고리인지 확인:
- **무료 (Pretendard, Noto Sans KR, system fonts)** — 그대로 권장
- **유료 (Apple SD 산돌고딕, AG, 단국 등 일부)** — PROJECT_BRIEF에 "라이센스 확인 필요" 표시
- **불명** — 폰트 자원 URL이 있으면 출처 명시, 없으면 fallback 권장
