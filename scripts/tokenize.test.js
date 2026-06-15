/*
 * tokenize.test.js — 토큰화 핵심 로직 단언 테스트.
 * 실행: node scripts/tokenize.test.js   (외부 의존성 없음)
 */
"use strict";
const assert = require("assert");
const t = require("./tokenize");

// 색 파싱 / 변환
assert.deepStrictEqual(t.parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
assert.deepStrictEqual(t.parseColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
assert.strictEqual(t.rgbToHex(t.parseColor("rgb(37,99,235)")), "#2563eb");
assert.strictEqual(t.parseColor("hsl(0,100%,50%)").r, 255);

// WCAG 대비
assert.strictEqual(Math.round(t.contrastRatio(t.parseColor("#000"), t.parseColor("#fff"))), 21);

// 이징 분류 (overshoot → spring)
assert.strictEqual(t.classifyEasing("cubic-bezier(0.34,1.56,0.64,1)").family, "spring");
assert.strictEqual(t.classifyEasing("ease-out").family, "ease-out");
assert.strictEqual(t.classifyEasing("linear").family, "linear");

// primary 식별: interactive 배경 빈도가 높은 색이 primary
const cls = t.classifyColors(new Map([
  ["#2563eb", { hex: "#2563eb", parsed: t.parseColor("#2563eb"), count: 5, interactiveBg: 5 }],
  ["#808080", { hex: "#808080", parsed: t.parseColor("#808080"), count: 50, interactiveBg: 0 }],
]));
assert.strictEqual(cls.primary, "#2563eb");
assert.ok(cls.neutrals.some((n) => n.hex === "#808080"), "무채색은 neutral로 분류");

// 모션 추출
const motion = t.extractMotion([
  { transitionDuration: "0.2s", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)", animationName: "none" },
]);
assert.strictEqual(motion.hasSpring, true);
assert.strictEqual(motion.durations[0].ms, 200);

// 산출물 생성 + DTCG 유효성
const { tokens, files } = t.buildArtifacts([
  { interactive: true, backgroundColor: "rgb(37,99,235)", color: "rgb(255,255,255)", fontFamily: "Inter", fontSize: "16px", fontWeight: "600", paddingTop: "12px", borderRadius: "8px", transitionDuration: "0.2s", transitionTimingFunction: "ease-out" },
], "https://example.com");
assert.ok(tokens.score.grade, "스코어 등급 존재");
const dtcg = JSON.parse(files["tokens.dtcg.json"]);
assert.strictEqual(dtcg.color.semantic.primary.$type, "color");
assert.ok(files["tokens.tailwind.js"].includes("theme"), "tailwind preset 형태");
assert.ok(files["tokens.css"].includes(":root"), "css 변수");

console.log("✅ tokenize: 모든 단언 통과");
