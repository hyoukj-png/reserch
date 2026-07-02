/*
 * section_roles.js — 라이브 DOM에서 수집한 섹션 메타데이터에 의미 역할을 자동 부여.
 *
 * browser_analyze_site.js 가 페이지별로 수집한 enriched 섹션
 * ({ tag, className, id, text, headings, cardCount, buttonCount, bounds })을 입력으로,
 * hero / feature-grid / pricing-table / faq / stats / steps / comparison / gallery /
 * logo-wall / testimonial / cta / nav / footer 등의 역할 라벨을 휴리스틱으로 분류한다.
 * content-analysis 스킬의 IA(정보구조) 해석에 "자동 섹션 라벨 시드"로 제공된다(에이전트가 한국어로 재해석).
 *
 * 분류 로직은 design-extract(designlang, MIT, (c) Manavarya Singh)의
 * extractors/section-roles.js 접근을 참조해 자체 포팅했고, 한국어 사이트 적중률을 위해
 * FAQ/STEPS/PRICING/CTA/TESTIMONIAL 정규식에 한국어 키워드를 보강했다. 외부 의존성 없음(순수 Node).
 */

"use strict";

const CTA_RE = /\b(get started|sign ?up|try (free|it|now)|start (free|trial|now)|book a demo|request demo|contact sales|talk to sales|learn more|watch demo)\b|문의하기|상담\s?신청|시작하기|무료\s?(체험|상담|신청)|자세히\s?보기|더\s?알아보기|바로\s?가기/i;
const STATS_RE = /\b(\d[\d,.]*[+%]|\d+x\b|\$\d+[MBK]\b)|\d[\d,.]*\s?(만|억|개|건|명|곳)\b/i;
const FAQ_RE = /\b(frequently asked|faq|common questions|questions & answers)\b|자주\s?(묻는|하는)\s?질문|문의\s?사항/i;
const STEPS_RE = /\b(step\s?\d|how it works|\d\s*\.\s+[A-Z])\b|이용\s?방법|진행\s?(순서|절차)|\d\s?단계/i;
const COMPARE_RE = /\b(vs\.?|compared to|free vs|basic vs|enterprise vs)\b|비교(하기|표)?|요금제\s?비교/i;
const TESTIMONIAL_RE = /(".{20,}"|".{20,}"|—\s?[A-Z][a-z]+\s+[A-Z][a-z]+|ceo|founder|head of)|고객\s?(후기|사례|리뷰)|이용\s?후기|추천사/i;
const PRICING_RE = /(\$\s?\d|€\s?\d|£\s?\d|₩\s?\d|per\s?(month|user|seat)|\/mo\b|\/month|billed)|요금(제|안내)?|가격(표|안내)?|\d[\d,]*\s?원\b|월\s?\d/i;

function blob(s) {
  return `${s.className || ""} ${s.id || ""}`.toLowerCase();
}

function detectLogoWall(s) {
  // 로고월: 텍스트는 짧고 작은 이미지/카드가 한 줄에 여러 개.
  if ((s.cardCount || 0) >= 5 && (s.text || "").length < 300 &&
    /(trusted by|used by|customers|as seen in|logos?|partners|clients)|고객사|파트너|함께한|도입\s?(기업|고객)/i.test(`${s.text || ""} ${blob(s)}`)) {
    return true;
  }
  return false;
}

function classifyRole(s, existingRole, pageType) {
  const text = (s.text || "").slice(0, 2000);
  const b = blob(s);
  const headings = s.headings || [];

  // 랜드마크 우선
  if (s.tag === "footer" || /(^|\s)footer/.test(b)) return { role: "footer", confidence: 0.95 };
  if (s.tag === "nav" || /^nav|header-?nav|top-?bar|gnb/.test(b)) return { role: "nav", confidence: 0.9 };

  // 클래스/콘텐츠 기반 강한 힌트
  if (/logo-?(wall|cloud|grid|strip)|trusted-?by/.test(b) || detectLogoWall(s)) {
    return { role: "logo-wall", confidence: 0.85 };
  }
  if (/bento/.test(b)) return { role: "bento", subrole: "features", confidence: 0.75 };
  if (/gallery|carousel|slider|swiper|slick/.test(b)) return { role: "gallery", confidence: 0.7 };
  if (/stat(s|istic)|metric|number|counter/.test(b) && STATS_RE.test(text)) return { role: "stats", confidence: 0.85 };
  if (FAQ_RE.test(text) || /\bfaq\b|accordion/.test(b)) return { role: "faq", confidence: 0.85 };
  if (STEPS_RE.test(text) && (s.cardCount || 0) >= 3) return { role: "steps", confidence: 0.75 };
  // 가격 토큰(₩/원/$/요금)이 실제로 있으면 비교(comparison)보다 pricing-table 을 우선 — 요금 비교 섹션 오분류 방지
  if (PRICING_RE.test(text) && (s.cardCount || 0) >= 2) return { role: "pricing-table", confidence: 0.9 };
  if (/pricing|plan|요금/.test(b) && PRICING_RE.test(text)) return { role: "pricing-table", confidence: 0.85 };
  if (COMPARE_RE.test(text) && (s.cardCount || 0) >= 2) return { role: "comparison", confidence: 0.7 };

  if (TESTIMONIAL_RE.test(text) || /testimonial|review|quote|후기/.test(b)) {
    return { role: "testimonial", confidence: 0.8 };
  }
  if (/hero|visual|main-?banner|kv\b/.test(b) ||
    (headings.length >= 1 && (s.buttonCount || 0) >= 1 && s.bounds && s.bounds.h > 300 && s.bounds.y < 500)) {
    return { role: "hero", confidence: 0.85 };
  }
  if ((s.cardCount || 0) >= 3 && (/(feature|benefit|what you get|why )|특징|기능|장점|서비스\s?소개/i.test(text) || /feature|grid|service/.test(b))) {
    return { role: "feature-grid", confidence: 0.8 };
  }
  if (CTA_RE.test(text) && (s.buttonCount || 0) >= 1 && text.length < 600) {
    return { role: "cta", confidence: 0.75 };
  }
  if (pageType === "blog" && (s.cardCount || 0) >= 3) {
    return { role: "blog-grid", confidence: 0.75 };
  }

  if (existingRole && existingRole !== "content") {
    return { role: existingRole, confidence: 0.4 };
  }
  return { role: "content", confidence: 0.3 };
}

function extractSlots(s) {
  const slots = {};
  const headings = s.headings || [];
  if (headings.length) slots.heading = headings[0];
  if (headings.length > 1) slots.subheadings = headings.slice(1, 4);
  if (s.buttonCount > 0) slots.ctaCount = s.buttonCount;
  const text = s.text || "";
  const firstPara = text.split(/\n{2,}/)[0];
  if (firstPara && firstPara.length < 400 && firstPara !== slots.heading) {
    slots.lede = firstPara.trim().slice(0, 240);
  }
  return slots;
}

/**
 * sections: [{ tag, className, id, text, headings:[], cardCount, buttonCount, bounds:{x,y,w,h} }]
 * regions:  (선택) 동일 인덱스의 기존 거친 라벨 배열
 * pageIntent: (선택) { type } — 예: { type: "blog" }
 */
function extractSectionRoles(sections = [], regions = [], pageIntent = null) {
  const pageType = pageIntent && pageIntent.type;
  const labeled = sections.map((s, i) => {
    const existing = regions[i] ? regions[i].role : null;
    const classified = classifyRole(s, existing, pageType);
    return {
      index: i,
      tag: s.tag,
      role: classified.role,
      subrole: classified.subrole || null,
      confidence: Number((classified.confidence || 0).toFixed(3)),
      heading: (s.headings && s.headings[0]) || null,
      bounds: s.bounds || null,
      buttonCount: s.buttonCount || 0,
      cardCount: s.cardCount || 0,
      slots: extractSlots(s),
      needsSmart: (classified.confidence || 0) < 0.5,
    };
  });

  const byRole = {};
  for (const r of labeled) byRole[r.role] = (byRole[r.role] || 0) + 1;

  return {
    sections: labeled,
    counts: byRole,
    readingOrder: labeled
      .filter((r) => r.bounds)
      .sort((a, b) => (a.bounds && a.bounds.y || 0) - (b.bounds && b.bounds.y || 0))
      .map((r) => r.role),
  };
}

module.exports = { extractSectionRoles, classifyRole, extractSlots };
