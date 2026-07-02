/*
 * tokenize.js — 라이브 DOM computedStyle 덤프 → 구조화 디자인 토큰.
 *
 * browser_analyze_site.js 의 런타임 패스가 수집한 computedStyle 샘플을 입력으로,
 * 색(클러스터링+역할분류)·타이포 스케일·간격/radius/shadow 스케일·모션 토큰을
 * 추출하고, WCAG 대비와 디자인 스코어(A–F)를 계산한 뒤,
 * 기계가독 산출물(DTCG / Tailwind / CSS 변수)과 한국어 마크다운 리포트를 만든다.
 *
 * 핵심 추출/분류 로직은 design-extract(designlang, MIT, (c) Manavarya Singh)의
 * colors/typography/motion/scoring 추출기 접근을 참조해 자체 포팅했다.
 * 외부 의존성 없음(순수 Node).
 */

"use strict";

// ============================================================
// 색 파싱 / 변환 / 대비
// ============================================================

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** "rgb(…)", "rgba(…)", "#abc", "#aabbcc", "hsl(…)" → {r,g,b,a} (0–255, a 0–1) 또는 null */
function parseColor(value) {
  if (!value || typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  let m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length >= 3) {
      return {
        r: clamp(parseFloat(parts[0]), 0, 255),
        g: clamp(parseFloat(parts[1]), 0, 255),
        b: clamp(parseFloat(parts[2]), 0, 255),
        a: parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1,
      };
    }
  }

  m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 4) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  m = v.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const h = parseFloat(parts[0]);
      const s = parseFloat(parts[1]) / 100;
      const l = parseFloat(parts[2]) / 100;
      const a = parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1;
      return { ...hslToRgb(h, s, l), a };
    }
  }
  return null;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + mm) * 255), g: Math.round((g + mm) * 255), b: Math.round((b + mm) * 255) };
}

function rgbToHex({ r, g, b }) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function colorDistance(a, b) {
  // 가중 유클리드(인지 근사) — design-extract 의 접근 동일
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

function relLuminance({ r, g, b }) {
  const ch = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(a, b) {
  const l1 = relLuminance(a), l2 = relLuminance(b);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ============================================================
// 색 클러스터링 + 역할 분류
// ============================================================

function clusterColors(entries, threshold = 16) {
  // entries: [{ parsed, hex, count, interactiveBg }]
  const clusters = [];
  const sorted = [...entries].sort((a, b) => b.count - a.count);
  for (const e of sorted) {
    let placed = null;
    for (const c of clusters) {
      if (colorDistance(e.parsed, c.representative) <= threshold) { placed = c; break; }
    }
    if (placed) {
      placed.members.push(e);
      placed.count += e.count;
      placed.interactiveBg += e.interactiveBg || 0;
    } else {
      clusters.push({
        representative: e.parsed,
        hex: e.hex,
        members: [e],
        count: e.count,
        interactiveBg: e.interactiveBg || 0,
      });
    }
  }
  return clusters;
}

function classifyColors(colorRecords) {
  // colorRecords: Map hex -> { hex, parsed, count, contexts:Set, interactiveBg }
  const entries = [...colorRecords.values()].filter((e) => e.parsed && e.parsed.a > 0.1);
  const clusters = clusterColors(entries, 16);
  for (const c of clusters) {
    const { h, s, l } = rgbToHsl(c.representative);
    c.hsl = { h, s, l };
  }

  const neutrals = [];
  const chromatic = [];
  for (const c of clusters) {
    const chromaticEnough = c.hsl.s > 18 && c.hsl.l > 6 && c.hsl.l < 96;
    (chromaticEnough ? chromatic : neutrals).push(c);
  }

  // primary: interactive 배경 빈도 최상위(없으면 채도×빈도 최상위 chromatic)
  chromatic.sort((a, b) => (b.interactiveBg - a.interactiveBg) || (b.count - a.count));
  let primary = chromatic.find((c) => c.interactiveBg > 0) || chromatic[0] || null;

  const accents = chromatic.filter((c) => c !== primary).slice(0, 6);
  neutrals.sort((a, b) => a.hsl.l - b.hsl.l);

  return {
    all: clusters.map((c) => ({ hex: rgbToHex(c.representative), count: c.count, hsl: c.hsl })),
    primary: primary ? rgbToHex(primary.representative) : null,
    accents: accents.map((c) => ({ hex: rgbToHex(c.representative), count: c.count })),
    neutrals: neutrals.map((c) => ({ hex: rgbToHex(c.representative), count: c.count, l: c.hsl.l })),
    totalUnique: colorRecords.size,
    clusterCount: clusters.length,
  };
}

// ============================================================
// 수치 스케일(타입/간격/radius) 추출
// ============================================================

function pxNum(v) {
  if (v == null) return null;
  const m = String(v).match(/^(-?\d+\.?\d*)px$/);
  return m ? parseFloat(m[1]) : null;
}

function buildScale(values, { round = true, min = 0, drop0 = false } = {}) {
  const counts = new Map();
  for (const raw of values) {
    let n = pxNum(raw);
    if (n == null || n < min) continue;
    if (drop0 && n === 0) continue;
    if (round) n = Math.round(n);
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => ({ value, count }));
}

// ============================================================
// 모션 토큰
// ============================================================

function msOf(v) {
  if (!v) return 0;
  const m = String(v).match(/(-?\d+\.?\d*)(m?s)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] === "s" ? n * 1000 : n;
}

const DURATION_NAMES = [
  { max: 80, name: "instant" }, { max: 150, name: "xs" }, { max: 250, name: "sm" },
  { max: 400, name: "md" }, { max: 700, name: "lg" }, { max: 1200, name: "xl" }, { max: Infinity, name: "xxl" },
];
function nameDuration(ms) { return DURATION_NAMES.find((d) => ms <= d.max).name; }

function classifyEasing(raw) {
  if (!raw || raw === "linear") return { family: "linear", raw: raw || "linear" };
  if (/ease-in-out/.test(raw)) return { family: "ease-in-out", raw };
  if (/ease-out/.test(raw)) return { family: "ease-out", raw };
  if (/ease-in/.test(raw)) return { family: "ease-in", raw };
  if (raw === "ease") return { family: "ease", raw };
  const m = raw.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) return { family: "custom", raw };
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  if (y1 < 0 || y2 > 1 || y2 < 0 || y1 > 1) return { family: "spring", raw, overshoot: true };
  if (x1 < 0.2 && x2 > 0.8) return { family: "ease-in-out", raw };
  if (x1 < 0.2 && y1 < 0.2) return { family: "ease-out", raw };
  if (x2 > 0.8 && y2 > 0.8) return { family: "ease-in", raw };
  return { family: "custom", raw };
}

function extractMotion(motionSamples) {
  const durations = new Map();
  const easings = new Map();
  let hasSpring = false;
  const animationNames = new Set();

  for (const s of motionSamples) {
    for (const d of String(s.transitionDuration || "").split(",")) {
      const ms = msOf(d.trim());
      if (ms > 0) durations.set(ms, (durations.get(ms) || 0) + 1);
    }
    for (const d of String(s.animationDuration || "").split(",")) {
      const ms = msOf(d.trim());
      if (ms > 0) durations.set(ms, (durations.get(ms) || 0) + 1);
    }
    for (const e of String(s.transitionTimingFunction || "").split(/,(?![^(]*\))/)) {
      const t = e.trim();
      if (t) { const c = classifyEasing(t); if (c.overshoot) hasSpring = true; easings.set(t, (easings.get(t) || 0) + 1); }
    }
    for (const e of String(s.animationTimingFunction || "").split(/,(?![^(]*\))/)) {
      const t = e.trim();
      if (t) { const c = classifyEasing(t); if (c.overshoot) hasSpring = true; easings.set(t, (easings.get(t) || 0) + 1); }
    }
    if (s.animationName && s.animationName !== "none") {
      String(s.animationName).split(",").forEach((n) => { const v = n.trim(); if (v && v !== "none") animationNames.add(v); });
    }
  }

  const durationTokens = [...durations.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, count]) => ({ ms, name: nameDuration(ms), count }));
  const easingTokens = [...easings.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([raw, count]) => ({ ...classifyEasing(raw), count }));

  return {
    durations: durationTokens,
    easings: easingTokens,
    hasSpring,
    animationNames: [...animationNames].slice(0, 20),
  };
}

// ============================================================
// 디자인 스코어 (A–F)
// ============================================================

function letterGrade(score) {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

function scoreDesign(tokens) {
  const scores = {};
  const issues = [];

  // 1. 컬러 규율
  const colorCount = tokens.colors.totalUnique;
  if (colorCount <= 12) scores.colorDiscipline = 100;
  else if (colorCount <= 25) scores.colorDiscipline = 92;
  else if (colorCount <= 40) scores.colorDiscipline = 80;
  else if (colorCount <= 60) scores.colorDiscipline = 65;
  else if (colorCount <= 100) scores.colorDiscipline = 50;
  else { scores.colorDiscipline = 35; issues.push(`고유 색 ${colorCount}개 — 팔레트 정리 권장`); }
  if (!tokens.colors.primary) { scores.colorDiscipline -= 15; issues.push("대표(primary) 브랜드 색 미검출"); }

  // 2. 타이포 일관성
  const fontCount = tokens.typography.families.length;
  if (fontCount <= 2) scores.typographyConsistency = 100;
  else if (fontCount <= 3) scores.typographyConsistency = 80;
  else { scores.typographyConsistency = 55; issues.push(`폰트 패밀리 ${fontCount}종 — 2종(제목/본문) 권장`); }
  const weightCount = tokens.typography.weights.length;
  if (weightCount > 5) { scores.typographyConsistency -= 12; issues.push(`폰트 굵기 ${weightCount}종 — 3종 표준화 권장`); }
  const scaleSize = tokens.typography.sizeScale.length;
  if (scaleSize > 14) { scores.typographyConsistency -= 8; issues.push(`타입 스케일 ${scaleSize}단 — 통합 검토 권장`); }

  // 3. 간격 규율 (스케일이 좁을수록 규율 높음)
  const spacingSteps = tokens.spacing.length;
  if (spacingSteps <= 8) scores.spacingConsistency = 100;
  else if (spacingSteps <= 14) scores.spacingConsistency = 88;
  else if (spacingSteps <= 22) scores.spacingConsistency = 72;
  else { scores.spacingConsistency = 55; issues.push(`간격 값 ${spacingSteps}종 — 4/8px 그리드로 정렬 권장`); }

  // 4. Shadow(엘리베이션) 일관성 — 실제 프로덕션 사이트는 hover/focus 변형 포함 10~18종이 흔함
  const shadowCount = tokens.shadowsTotal != null ? tokens.shadowsTotal : tokens.shadows.length;
  if (shadowCount === 0) scores.shadowConsistency = 85;
  else if (shadowCount <= 5) scores.shadowConsistency = 100;
  else if (shadowCount <= 10) scores.shadowConsistency = 90;
  else if (shadowCount <= 18) scores.shadowConsistency = 78;
  else if (shadowCount <= 28) scores.shadowConsistency = 62;
  else { scores.shadowConsistency = 50; issues.push(`그림자 ${shadowCount}종 — 3단계(sm/md/lg) 엘리베이션으로 정리 권장`); }

  // 5. Radius 일관성
  const radiiCount = tokens.radius.length;
  if (radiiCount <= 4) scores.radiusConsistency = 100;
  else if (radiiCount <= 7) scores.radiusConsistency = 90;
  else if (radiiCount <= 10) scores.radiusConsistency = 80;
  else if (radiiCount <= 15) scores.radiusConsistency = 65;
  else { scores.radiusConsistency = 45; issues.push(`radius ${radiiCount}종 — 3~4개로 표준화 권장`); }

  // 6. 대비(접근성)
  const fails = tokens.contrast.filter((c) => c.ratio < 4.5).length;
  const total = tokens.contrast.length || 1;
  const passRate = 1 - fails / total;
  scores.accessibility = Math.round(passRate * 100);
  if (fails > 0) issues.push(`대비 4.5:1 미달 색쌍 ${fails}/${total}개`);

  // 7. 모션 일관성
  const dur = tokens.motion.durations.length;
  if (dur === 0) scores.motionConsistency = 80;
  else if (dur <= 4) scores.motionConsistency = 100;
  else if (dur <= 7) scores.motionConsistency = 85;
  else { scores.motionConsistency = 65; issues.push(`전이 시간 ${dur}종 — 토큰화로 정리 권장`); }

  for (const k of Object.keys(scores)) scores[k] = Math.round(clamp(scores[k], 0, 100));

  // 가중 평균 — design-extract scoring.js 비중을 7카테고리로 보정(합 100)
  const weights = {
    colorDiscipline: 18, typographyConsistency: 18, spacingConsistency: 16,
    accessibility: 15, motionConsistency: 13, shadowConsistency: 10, radiusConsistency: 10,
  };
  let totalWeight = 0, weightedSum = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (scores[k] !== undefined) { weightedSum += scores[k] * w; totalWeight += w; }
  }
  const overall = totalWeight ? Math.round(weightedSum / totalWeight) : 0;
  return { scores, overall, grade: letterGrade(overall), issues };
}

// ============================================================
// 메인 토큰화: computedStyle 덤프 → tokens 객체
// ============================================================

function tokenizeFromSamples(samples) {
  const colorRecords = new Map();
  const addColor = (value, ctx, interactive) => {
    const parsed = parseColor(value);
    if (!parsed || parsed.a === 0) return;
    const hex = rgbToHex(parsed);
    if (!colorRecords.has(hex)) colorRecords.set(hex, { hex, parsed, count: 0, contexts: new Set(), interactiveBg: 0 });
    const e = colorRecords.get(hex);
    e.count++;
    e.contexts.add(ctx);
    if (interactive && ctx === "background") e.interactiveBg++;
  };

  const fontFamilies = new Map();
  const fontWeights = new Set();
  const fontSizes = [];
  const lineHeights = [];
  const letterSpacings = [];
  const spacingValues = [];
  const radiusValues = [];
  const shadows = new Map();
  const gradients = new Map();
  const motionSamples = [];

  for (const s of samples) {
    const interactive = !!s.interactive;
    addColor(s.color, "text");
    addColor(s.backgroundColor, "background", interactive);
    addColor(s.borderColor, "border");

    if (s.backgroundImage && /gradient/.test(s.backgroundImage)) {
      gradients.set(s.backgroundImage, (gradients.get(s.backgroundImage) || 0) + 1);
    }

    if (s.fontFamily) {
      const primary = String(s.fontFamily).split(",")[0].trim().replace(/^["']|["']$/g, "");
      if (primary && !/^(inherit|initial|-apple-system|system-ui|sans-serif|serif|monospace)$/i.test(primary)) {
        fontFamilies.set(primary, (fontFamilies.get(primary) || 0) + 1);
      }
    }
    if (s.fontWeight && /^\d+$/.test(String(s.fontWeight))) fontWeights.add(Number(s.fontWeight));
    if (s.fontSize) fontSizes.push(s.fontSize);
    if (s.lineHeight) lineHeights.push(s.lineHeight);
    if (s.letterSpacing && s.letterSpacing !== "normal") letterSpacings.push(s.letterSpacing);

    [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.marginTop, s.marginBottom, s.gap].forEach((v) => {
      if (v) spacingValues.push(v);
    });
    if (s.borderRadius) String(s.borderRadius).split(/\s+/).forEach((v) => radiusValues.push(v));
    if (s.boxShadow && s.boxShadow !== "none") shadows.set(s.boxShadow, (shadows.get(s.boxShadow) || 0) + 1);

    if ((s.transitionDuration && s.transitionDuration !== "0s") || (s.animationName && s.animationName !== "none")) {
      motionSamples.push(s);
    }
  }

  const colors = classifyColors(colorRecords);

  // 대비: 각 대표색이 흰/검 중 "더 나은 배경"에서 텍스트로 쓰일 때의 대비.
  // (자기 자신 대비 같은 무의미 쌍을 배제하고, 색마다 최적 배경 1개만 평가)
  const contrast = [];
  const white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 };
  for (const c of colors.all.slice(0, 16)) {
    const parsed = parseColor(c.hex);
    if (!parsed) continue;
    const vsWhite = contrastRatio(parsed, white);
    const vsBlack = contrastRatio(parsed, black);
    const onWhite = vsWhite >= vsBlack;
    contrast.push({
      fg: c.hex,
      bg: onWhite ? "#ffffff" : "#000000",
      ratio: Math.round((onWhite ? vsWhite : vsBlack) * 100) / 100,
    });
  }

  const typography = {
    families: [...fontFamilies.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    weights: [...fontWeights].sort((a, b) => a - b),
    sizeScale: buildScale(fontSizes, { round: true, min: 6 }),
    lineHeightSamples: buildScale(lineHeights, { round: false, min: 0 }).slice(0, 12),
    letterSpacingSamples: [...new Set(letterSpacings)].slice(0, 8),
  };

  const spacing = buildScale(spacingValues, { round: true, min: 0, drop0: true });
  const radius = buildScale(radiusValues, { round: true, min: 0, drop0: true });
  const shadowTokens = [...shadows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([raw, count]) => ({ raw, count }));
  const gradientTokens = [...gradients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([raw, count]) => ({ raw, count }));
  const motion = extractMotion(motionSamples);

  const tokens = {
    meta: { generatedAt: new Date().toISOString(), sampleCount: samples.length },
    colors,
    typography,
    spacing,
    radius,
    shadows: shadowTokens,
    shadowsTotal: shadows.size,
    gradients: gradientTokens,
    motion,
    contrast,
  };
  tokens.score = scoreDesign(tokens);
  return tokens;
}

// ============================================================
// 포매터: DTCG / Tailwind / CSS 변수
// ============================================================

function toDTCG(tokens) {
  const out = {
    $metadata: { generatedAt: tokens.meta.generatedAt, tool: "reserch/tokenize.js", spec: "DTCG" },
    color: { primitive: {}, semantic: {} },
    fontFamily: {},
    fontSize: {},
    spacing: {},
    radius: {},
    shadow: {},
    duration: {},
    easing: {},
  };
  tokens.colors.all.slice(0, 30).forEach((c, i) => {
    out.color.primitive[`color-${String(i + 1).padStart(2, "0")}`] = { $value: c.hex, $type: "color" };
  });
  if (tokens.colors.primary) out.color.semantic.primary = { $value: tokens.colors.primary, $type: "color" };
  tokens.colors.accents.slice(0, 4).forEach((a, i) => {
    out.color.semantic[`accent-${i + 1}`] = { $value: a.hex, $type: "color" };
  });
  tokens.typography.families.forEach((f, i) => {
    out.fontFamily[i === 0 ? "base" : `family-${i + 1}`] = { $value: f.name, $type: "fontFamily" };
  });
  tokens.typography.sizeScale.forEach((s, i) => {
    out.fontSize[`size-${String(i + 1).padStart(2, "0")}`] = { $value: `${s.value}px`, $type: "dimension" };
  });
  tokens.spacing.forEach((s, i) => {
    out.spacing[`space-${String(i + 1).padStart(2, "0")}`] = { $value: `${s.value}px`, $type: "dimension" };
  });
  tokens.radius.forEach((r, i) => {
    out.radius[`radius-${String(i + 1).padStart(2, "0")}`] = { $value: `${r.value}px`, $type: "dimension" };
  });
  tokens.shadows.forEach((s, i) => {
    out.shadow[`shadow-${String(i + 1).padStart(2, "0")}`] = { $value: s.raw, $type: "shadow" };
  });
  tokens.motion.durations.forEach((d) => {
    out.duration[d.name] = { $value: `${d.ms}ms`, $type: "duration" };
  });
  tokens.motion.easings.slice(0, 6).forEach((e, i) => {
    out.easing[e.family === "custom" ? `easing-${i + 1}` : e.family] = { $value: e.raw, $type: "cubicBezier" };
  });
  return out;
}

function toTailwind(tokens) {
  const colors = {};
  if (tokens.colors.primary) colors.primary = tokens.colors.primary;
  tokens.colors.accents.slice(0, 4).forEach((a, i) => { colors[`accent-${i + 1}`] = a.hex; });
  tokens.colors.neutrals.slice(0, 8).forEach((n, i) => { colors[`neutral-${i + 1}`] = n.hex; });

  const fontSize = {};
  tokens.typography.sizeScale.forEach((s, i) => { fontSize[`s${i + 1}`] = `${s.value}px`; });
  const spacing = {};
  tokens.spacing.forEach((s) => { spacing[String(s.value)] = `${s.value}px`; });
  const borderRadius = {};
  tokens.radius.forEach((r, i) => { borderRadius[`r${i + 1}`] = `${r.value}px`; });
  const boxShadow = {};
  tokens.shadows.forEach((s, i) => { boxShadow[`s${i + 1}`] = s.raw; });
  const transitionDuration = {};
  tokens.motion.durations.forEach((d) => { transitionDuration[d.name] = `${d.ms}ms`; });

  const preset = {
    theme: {
      extend: {
        colors,
        fontFamily: tokens.typography.families.length ? { sans: [tokens.typography.families[0].name, "sans-serif"] } : {},
        fontSize,
        spacing,
        borderRadius,
        boxShadow,
        transitionDuration,
      },
    },
  };
  return `/* 자동 생성: reserch/tokenize.js — 라이브 DOM에서 추출한 디자인 토큰.\n   Tailwind preset 으로 사용: presets: [require('./tokens.tailwind.js')] */\nmodule.exports = ${JSON.stringify(preset, null, 2)};\n`;
}

function toCSSVars(tokens) {
  const lines = [":root {"];
  if (tokens.colors.primary) lines.push(`  --color-primary: ${tokens.colors.primary};`);
  tokens.colors.accents.slice(0, 4).forEach((a, i) => lines.push(`  --color-accent-${i + 1}: ${a.hex};`));
  tokens.colors.neutrals.slice(0, 8).forEach((n, i) => lines.push(`  --color-neutral-${i + 1}: ${n.hex};`));
  if (tokens.typography.families[0]) lines.push(`  --font-base: "${tokens.typography.families[0].name}", sans-serif;`);
  tokens.typography.sizeScale.forEach((s, i) => lines.push(`  --font-size-${i + 1}: ${s.value}px;`));
  tokens.spacing.forEach((s, i) => lines.push(`  --space-${i + 1}: ${s.value}px;`));
  tokens.radius.forEach((r, i) => lines.push(`  --radius-${i + 1}: ${r.value}px;`));
  tokens.shadows.forEach((s, i) => lines.push(`  --shadow-${i + 1}: ${s.raw};`));
  tokens.motion.durations.forEach((d) => lines.push(`  --duration-${d.name}: ${d.ms}ms;`));
  lines.push("}");
  return `/* 자동 생성: reserch/tokenize.js */\n${lines.join("\n")}\n`;
}

function toMarkdown(tokens, baseUrl) {
  const s = tokens.score;
  const L = [];
  L.push("# 구조화 디자인 토큰 (computedStyle 기반)", "");
  L.push(`**분석 대상:** ${baseUrl || "(n/a)"}`);
  L.push(`**생성:** ${tokens.meta.generatedAt}`);
  L.push(`**수집 요소 샘플:** ${tokens.meta.sampleCount}개`, "");
  L.push("> 이 파일은 Playwright Chromium에서 실제 렌더된 요소의 `getComputedStyle`을 전수 수집해 결정론적으로 토큰화한 결과입니다. 정적 CSS regex가 놓치는 '실제 사용된' 색·타이포·간격·모션을 1차 근거로 삼으세요. 기계가독 산출물은 `tokens.dtcg.json` / `tokens.tailwind.js` / `tokens.css` 참조.", "");

  L.push(`## 🏅 디자인 스코어: **${s.grade}** (${s.overall}/100)`, "");
  L.push("| 카테고리 | 점수 |", "|---|---|");
  const labels = { colorDiscipline: "컬러 규율", typographyConsistency: "타이포 일관성", spacingConsistency: "간격 규율", shadowConsistency: "엘리베이션(그림자) 일관성", radiusConsistency: "Radius 일관성", accessibility: "접근성(대비)", motionConsistency: "모션 일관성" };
  for (const [k, v] of Object.entries(s.scores)) L.push(`| ${labels[k] || k} | ${v} |`);
  if (s.issues.length) { L.push("", "**개선 포인트:**"); s.issues.forEach((i) => L.push(`- ${i}`)); }
  L.push("");

  L.push("## 🎨 컬러", "");
  L.push(`- **Primary:** ${tokens.colors.primary || "(미검출)"}`);
  if (tokens.colors.accents.length) L.push(`- **Accents:** ${tokens.colors.accents.map((a) => a.hex).join(", ")}`);
  if (tokens.colors.neutrals.length) L.push(`- **Neutrals:** ${tokens.colors.neutrals.slice(0, 8).map((n) => n.hex).join(", ")}`);
  L.push(`- 고유 색 ${tokens.colors.totalUnique}개 → ${tokens.colors.clusterCount}개 클러스터로 정리`, "");

  L.push("## 🔤 타이포그래피", "");
  L.push(`- **패밀리:** ${tokens.typography.families.map((f) => `${f.name}(${f.count})`).join(", ") || "(미검출)"}`);
  L.push(`- **굵기:** ${tokens.typography.weights.join(", ") || "(미검출)"}`);
  L.push(`- **사이즈 스케일:** ${tokens.typography.sizeScale.map((x) => `${x.value}px`).join(" · ") || "(미검출)"}`, "");

  L.push("## 📏 간격 / Radius / Shadow", "");
  L.push(`- **간격 스케일(px):** ${tokens.spacing.map((x) => x.value).join(" · ") || "(미검출)"}`);
  L.push(`- **Radius(px):** ${tokens.radius.map((x) => x.value).join(" · ") || "(미검출)"}`);
  L.push(`- **Shadow:** ${tokens.shadows.length}종`);
  tokens.shadows.slice(0, 5).forEach((sh) => L.push(`  - \`${sh.raw}\``));
  L.push("");

  L.push("## 🎬 모션", "");
  L.push(`- **전이 시간:** ${tokens.motion.durations.map((d) => `${d.ms}ms(${d.name})`).join(" · ") || "(없음)"}`);
  L.push(`- **이징:** ${tokens.motion.easings.slice(0, 6).map((e) => e.family).join(", ") || "(없음)"}`);
  L.push(`- **스프링/오버슈트:** ${tokens.motion.hasSpring ? "있음" : "없음"}`);
  if (tokens.motion.animationNames.length) L.push(`- **@keyframes:** ${tokens.motion.animationNames.join(", ")}`);
  L.push("");

  L.push("## ♿ WCAG 대비 (각 색을 텍스트로 쓸 때 최적 배경)", "");
  L.push("> ❌는 해당 색이 흰/검 어느 배경에서도 본문 텍스트(AA 4.5:1)로 부적합함을 뜻합니다 — 보통 밝은 배경용 색입니다.", "");
  L.push("| 색 | 최적 배경 | 대비 | 본문 AA |", "|---|---|---|---|");
  tokens.contrast.slice(0, 16).forEach((c) => L.push(`| ${c.fg} | ${c.bg} | ${c.ratio}:1 | ${c.ratio >= 4.5 ? "✅" : "❌"} |`));
  L.push("");

  return L.join("\n") + "\n";
}

// ============================================================
// 공개 API
// ============================================================

function buildArtifacts(samples, baseUrl) {
  const tokens = tokenizeFromSamples(samples);
  return {
    tokens,
    files: {
      "tokens.raw.json": JSON.stringify(tokens, null, 2),
      "tokens.dtcg.json": JSON.stringify(toDTCG(tokens), null, 2),
      "tokens.tailwind.js": toTailwind(tokens),
      "tokens.css": toCSSVars(tokens),
      "10-design-tokens-structured.md": toMarkdown(tokens, baseUrl),
    },
  };
}

module.exports = {
  buildArtifacts,
  tokenizeFromSamples,
  // 테스트/재사용을 위한 내부 노출
  parseColor, rgbToHex, rgbToHsl, contrastRatio, classifyColors,
  classifyEasing, extractMotion, scoreDesign, toDTCG, toTailwind, toCSSVars,
};
