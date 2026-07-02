/*
 * section_roles.test.js — 섹션 역할 분류 단언 테스트.
 * 실행: node scripts/section_roles.test.js   (외부 의존성 없음)
 */
"use strict";
const assert = require("assert");
const { extractSectionRoles } = require("./section_roles");

const sections = [
  { tag: "section", className: "hero", id: "", text: "더 빠른 분석을 시작하세요", headings: ["더 빠른 분석"], cardCount: 0, buttonCount: 2, bounds: { x: 0, y: 0, w: 1200, h: 600 } },
  { tag: "section", className: "features grid", id: "", text: "주요 기능 특징 장점", headings: ["주요 기능"], cardCount: 4, buttonCount: 0, bounds: { x: 0, y: 600, w: 1200, h: 500 } },
  { tag: "section", className: "pricing", id: "price", text: "요금제 비교 월 9,900원 / 월 19,900원", headings: ["요금 안내"], cardCount: 3, buttonCount: 3, bounds: { x: 0, y: 1100, w: 1200, h: 500 } },
  { tag: "section", className: "faq", id: "", text: "자주 묻는 질문", headings: ["FAQ"], cardCount: 6, buttonCount: 0, bounds: { x: 0, y: 1600, w: 1200, h: 400 } },
  { tag: "footer", className: "footer", id: "", text: "회사 정보 © 2026", headings: [], cardCount: 0, buttonCount: 8, bounds: { x: 0, y: 2000, w: 1200, h: 300 } },
];

const result = extractSectionRoles(sections);
const roles = result.sections.map((s) => s.role);

assert.strictEqual(roles[0], "hero", "첫 섹션은 hero");
assert.strictEqual(roles[1], "feature-grid", "두번째는 feature-grid");
assert.strictEqual(roles[2], "pricing-table", "세번째는 pricing-table");
assert.strictEqual(roles[3], "faq", "네번째는 faq");
assert.strictEqual(roles[4], "footer", "마지막은 footer");

// 읽기 순서는 y좌표 기준 정렬
assert.deepStrictEqual(result.readingOrder, ["hero", "feature-grid", "pricing-table", "faq", "footer"]);
// counts 집계
assert.strictEqual(result.counts.faq, 1);
// 슬롯에 헤딩/ledе 보존
assert.strictEqual(result.sections[0].slots.heading, "더 빠른 분석");

console.log("✅ section_roles: 모든 단언 통과");
