// 첫 화면 봉사 장면 (2026-11-12): 2D vector people with joints (shoulder, elbow, hip, knee) moved over time, so each scene
// shows the work being done: 공원 쓰레기 줍기 → 어르신 말벗 → 유기견 산책 → 도서관 책 정리. Plain DOM/SVG, no library.
// Made as a mockup first (claude artifact), then moved here. Edges fade into the page through a soft mask.
/* eslint-disable */
export function mountMotion(svg, opts = {}) {
const clock = { time: 0, frame: 0, dt: 0 };
const NS = 'http://www.w3.org/2000/svg';
const R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = u => 0.5 - Math.cos(Math.PI * clamp(u, 0, 1)) / 2;
const lerp = (a, b, u) => a + (b - a) * u;
const win = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
const tf = (n, x, y, a = 0, s = 1, sy) => n.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${a.toFixed(2)}) scale(${s} ${sy ?? s})`);
/** A limb segment pointing down from (0,0), length L, width w1 → w2, rounded ends. */
function seg(L, w1, w2) {
  const a = w1 / 2, b = w2 / 2;
  return `M ${-a} 0 A ${a} ${a} 0 0 1 ${a} 0 L ${b} ${L} A ${b} ${b} 0 0 1 ${-b} ${L} Z`;
}
/** Where a point inside node sits in the svg's own coordinates. */
function gpos(node, x = 0, y = 0) {
  const m = svg.getScreenCTM().inverse().multiply(node.getScreenCTM());
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}
/** 2-bone IK in svg space: shoulder s, target t, lengths L1 L2. Angles use the rig's convention (0 = pointing down). */
function ik(s, t, L1, L2, bend = 1) {
  let dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy);
  d = clamp(d, Math.abs(L1 - L2) + 0.5, L1 + L2 - 0.5);
  const base = Math.atan2(-dx, dy);
  const c = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const a1 = base + bend * c;
  const ex = s.x - Math.sin(a1) * L1, ey = s.y + Math.cos(a1) * L1;
  const a2 = Math.atan2(-(t.x - ex), t.y - ey);
  return [a1 / R, a2 / R];
}
/** Keyframes → pose at t. Each key carries forward the previous key's values; numbers ease, the rest switch. */
function track(keys) {
  const full = []; let acc = {};
  for (const [t, p] of keys) { acc = { ...acc, ...p }; full.push([t, acc]); }
  return t => {
    if (t <= full[0][0]) return full[0][1];
    for (let i = 0; i < full.length - 1; i++) {
      const [t0, a] = full[i], [t1, b] = full[i + 1];
      if (t <= t1) {
        const u = ease((t - t0) / (t1 - t0)), o = {};
        for (const k in b) o[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? lerp(a[k], b[k], u) : (u < 1 ? a[k] ?? b[k] : b[k]);
        return o;
      }
    }
    return full[full.length - 1][1];
  };
}

/* ---------- people ---------- */
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(clamp(v * f, 0, 255))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
const MOUTH = { smile: 'M -5 0 Q 0 4.5 5 0', open: 'M -5 -1 Q 0 8 5 -1 Z', laugh: 'M -6 -2 Q 0 11 6 -2 Z', o: 'M -2.6 1 a 2.6 3 0 1 0 5.2 0 a 2.6 3 0 1 0 -5.2 0', calm: 'M -4 1 Q 0 2.5 4 1' };
function person(parent, o) {
  const P = { o };
  P.root = el('g', {}, parent);
  P.body = el('g', {}, P.root);
  const legs = {}, arms = {};
  const leg = (side) => {
    const back = side === 'b', pants = back ? shade(o.pants, 0.82) : o.pants, shoe = back ? shade(o.shoe, 0.85) : o.shoe;
    const thigh = el('g', {}, P.body); el('path', { d: seg(58, 24, 18), fill: pants }, thigh);
    const knee = el('g', {}, thigh); el('path', { d: seg(52, 18, 14), fill: pants }, knee);
    const foot = el('g', {}, knee);
    el('path', { d: 'M -8 -2 Q -9 -9 -1 -9 L 6 -9 Q 20 -7 21 3 L 21 6 L -9 6 Z', fill: shoe }, foot);
    el('rect', { x: -9, y: 4, width: 30, height: 4, rx: 2, fill: back ? '#9a9f9b' : '#c9cdc8' }, foot);
    legs[side] = { thigh, knee, foot };
  };
  leg('b'); leg('f');
  P.torso = el('g', {}, P.body);
  const arm = (side) => {
    const back = side === 'b', sleeve = back ? shade(o.top, 0.86) : o.top, sk = back ? shade(o.skin, 0.9) : o.skin;
    const up = el('g', {}, P.torso); el('path', { d: seg(40, 16, 13), fill: sleeve }, up);
    const el_ = el('g', {}, up); el('path', { d: seg(37, 12.5, 10.5), fill: sk }, el_);
    const hand = el('g', {}, el_); el('ellipse', { cx: 0, cy: 3, rx: 7, ry: 7.5, fill: sk }, hand);
    const tip = el('g', {}, hand); tf(tip, 0, 7);
    arms[side] = { up, el: el_, hand, tip };
    return up;
  };
  arm('b');
  // torso
  el('path', { d: 'M -19 6 Q -24 -40 -17 -76 Q -13 -92 2 -92 Q 17 -92 21 -76 Q 26 -40 19 6 Z', fill: o.top }, P.torso);
  if (o.vest) {
    el('path', { d: 'M -20 4 Q -24 -40 -17 -74 Q -14 -86 -6 -89 L 3 -58 L 11 -89 Q 19 -86 21 -74 Q 25 -40 19 4 Z', fill: o.vest }, P.torso);
    el('path', { d: 'M -22 -38 L 23 -38 L 23 -30 L -22 -30 Z', fill: '#d6ee8c', opacity: 0.9 }, P.torso);
    el('rect', { x: 8, y: -66, width: 9, height: 6, rx: 1.5, fill: '#ffffff', opacity: 0.9 }, P.torso);
  }
  if (o.cardigan) {
    el('path', { d: 'M 3 -88 L 6 6', stroke: shade(o.top, 0.8), 'stroke-width': 2 }, P.torso);
    for (const y of [-60, -40, -20]) el('circle', { cx: 8, cy: y, r: 2.2, fill: shade(o.top, 0.7) }, P.torso);
  }
  el('path', { d: 'M -20 -2 L 20 -2 L 19 8 Q 0 13 -19 8 Z', fill: o.pants }, P.torso);
  // neck + head
  el('rect', { x: -5, y: -100, width: 11, height: 12, rx: 4, fill: shade(o.skin, 0.92) }, P.torso);
  P.head = el('g', {}, P.torso);
  const H = P.head;
  if (o.hair === 'pony') { P.pony = el('g', {}, H); tf(P.pony, -18, -30); el('path', { d: 'M 0 0 Q -14 6 -12 26 Q -4 18 4 4 Z', fill: o.hairColor }, P.pony); }
  el('ellipse', { cx: 3, cy: -22, rx: 21, ry: 23, fill: o.skin }, H);
  el('ellipse', { cx: -9, cy: -20, rx: 4.5, ry: 6, fill: shade(o.skin, 0.9) }, H);
  const hc = o.hairColor;
  if (o.hair === 'short') el('path', { d: 'M -18 -18 Q -22 -44 2 -46 Q 26 -46 25 -26 Q 16 -34 4 -33 Q -4 -26 -12 -26 Q -14 -20 -18 -18 Z', fill: hc }, H);
  if (o.hair === 'pony') el('path', { d: 'M -18 -16 Q -24 -46 4 -46 Q 27 -44 25 -24 Q 14 -36 0 -32 Q -8 -30 -12 -22 Z', fill: hc }, H);
  if (o.hair === 'elder') { el('path', { d: 'M -18 -14 Q -22 -34 -12 -40 Q -4 -30 -10 -16 Z', fill: hc }, H); el('path', { d: 'M -6 -42 Q 6 -48 18 -40 Q 8 -42 -6 -38 Z', fill: hc }, H); }
  if (o.hair === 'kid') el('path', { d: 'M -18 -16 Q -22 -46 4 -46 Q 26 -45 25 -22 Q 18 -30 8 -31 Q 2 -24 -10 -27 Q -14 -20 -18 -16 Z', fill: hc }, H);
  if (o.cap) { el('path', { d: 'M -19 -26 Q -18 -48 4 -48 Q 25 -47 25 -28 Z', fill: o.cap }, H); el('path', { d: 'M 18 -30 L 38 -27 Q 36 -23 18 -24 Z', fill: shade(o.cap, 0.8) }, H); }
  P.eye = el('ellipse', { cx: 13, cy: -23, rx: 2.3, ry: 2.9, fill: '#1d2420' }, H);
  el('path', { d: 'M 9 -30 Q 13 -32 17 -30', stroke: hc === '#dcdcd6' ? '#8d8d88' : hc, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }, H);
  el('path', { d: 'M 23 -21 Q 28 -16 23 -14', fill: shade(o.skin, 0.88) }, H);
  el('circle', { cx: 12, cy: -13, r: 4.5, fill: '#f08a7a', opacity: 0.28 }, H);
  if (o.glasses) { el('circle', { cx: 14, cy: -23, r: 6, fill: 'none', stroke: '#5b5146', 'stroke-width': 1.8 }, H); el('path', { d: 'M 8 -24 L -6 -24', stroke: '#5b5146', 'stroke-width': 1.6 }, H); }
  P.mouthG = el('g', {}, H); tf(P.mouthG, 15, -10);
  P.mouth = el('path', { d: MOUTH.smile, fill: '#7a3b33', stroke: '#7a3b33', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, P.mouthG);
  arm('f');
  P.legs = legs; P.arms = arms;
  return P;
}
const STAND = { x: 0, y: 332, s: 1, f: 1, lean: 3, head: 0, fT: 0, fS: 0, bT: 0, bS: 0, fU: 6, fL: -12, fH: 0, bU: -4, bL: -10, bH: 0, mouth: 'smile', blink: 0, hang: 0 };
/** Apply a pose. Feet stay level with the ground unless fF/bF say otherwise; a hanging back hand keeps its bag upright. */
const SMOOTH = ['lean', 'head', 'fU', 'fL', 'fH', 'bU', 'bL', 'bH'];
function pose(P, p) {
  const q = { ...STAND, ...p };
  // Breathing: a slow sway of the body and head so nobody stands frozen.
  const br = Math.sin(clock.time * 1.7 + (P.seed ??= Math.random() * 6));
  q.lean += br * 0.9; q.head += br * 1.4; q.fU += br * 1.2; q.bU -= br * 1.2;
  // Arms and head follow their target a little late (no robotic snapping); legs stay exact so feet do not slide.
  if (P.frame !== clock.frame) { P.prev = P.cur; P.frame = clock.frame; }
  if (P.prev && clock.dt > 0 && clock.dt < 0.2) {
    const a = 1 - Math.exp(-clock.dt * 13);
    for (const k of SMOOTH) q[k] = P.prev[k] + (q[k] - P.prev[k]) * a;
  }
  P.cur = {}; for (const k of SMOOTH) P.cur[k] = q[k];
  P.body.setAttribute('transform', `translate(${q.x.toFixed(2)} ${q.y.toFixed(2)}) scale(${q.f * q.s} ${q.s})`);
  const L = P.legs, A = P.arms;
  tf(L.b.thigh, -3, 0, q.bT); tf(L.b.knee, 0, 58, q.bS); tf(L.b.foot, 0, 52, q.bF ?? -(q.bT + q.bS));
  tf(L.f.thigh, 3, 0, q.fT); tf(L.f.knee, 0, 58, q.fS); tf(L.f.foot, 0, 52, q.fF ?? -(q.fT + q.fS));
  tf(P.torso, 0, 0, q.lean);
  tf(P.head, 2, -96, q.head);
  tf(A.b.up, -2, -80, q.bU); tf(A.b.el, 0, 40, q.bL); tf(A.b.hand, 0, 37, q.hang ? -(q.lean + q.bU + q.bL) : q.bH);
  tf(A.f.up, 4, -80, q.fU); tf(A.f.el, 0, 40, q.fL); tf(A.f.hand, 0, 37, q.fH);
  P.mouth.setAttribute('d', MOUTH[q.mouth] || MOUTH.smile);
  P.mouth.setAttribute('fill', q.mouth === 'smile' || q.mouth === 'calm' ? 'none' : '#7a3b33');
  P.eye.setAttribute('ry', q.blink > 0.5 ? 0.6 : 2.9);
  if (P.pony) tf(P.pony, -18, -30, q.pony || 0);
}
/** Shoulder of the front arm in svg space for a pose (facing right, scale 1). */
function shoulder(q) {
  const a = q.lean * R;
  return { x: q.x + 4 * Math.cos(a) + 80 * Math.sin(a), y: q.y + 4 * Math.sin(a) - 80 * Math.cos(a) };
}
/** Walk cycle on top of a pose: amp 0..1, phase in radians. */
function walk(q, ph, amp) {
  if (amp <= 0) return q;
  const s = Math.sin(ph), c = Math.cos(ph);
  q.fT += -24 * s * amp; q.bT += 24 * s * amp;
  q.fS += (8 + 30 * Math.max(0, Math.sin(ph + 1.9))) * amp; q.bS += (8 + 30 * Math.max(0, Math.sin(ph + 1.9 + Math.PI))) * amp;
  q.fU += 16 * s * amp; q.bU += -16 * s * amp;
  q.fL += (-6 - 12 * Math.max(0, s)) * amp; q.bL += (-6 - 12 * Math.max(0, -s)) * amp;
  q.y += -3.5 * Math.abs(c) * amp; q.lean += 2 * amp;
  return q;
}
const blinkAt = t => ((t * 1000) % 3700) < 130 ? 1 : 0;
const talkMouth = (t, rate = 7) => Math.sin(t * rate * 2 * Math.PI) > 0 ? 'open' : 'o';

/* ---------- scenery ---------- */
function defs() {
  const d = el('defs', {}, svg);
  const lin = (id, stops, x2 = 0, y2 = 1) => { const g = el('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, d); stops.forEach(([o, c, op]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op ?? 1 }, g)); };
  lin('sky1', [[0, '#e6f2ea'], [1, '#f3f2ea']]);
  lin('sky2', [[0, '#f6ece0'], [1, '#f3f1ea']]);
  lin('sky3', [[0, '#e3f0f2'], [1, '#eff3ea']]);
  lin('wall', [[0, '#f3ece0'], [1, '#ece2d0']]);
  lin('beam', [[0, '#fff6d8', 0.55], [1, '#fff6d8', 0]]);
  lin('grass', [[0, '#a9cf98'], [1, '#8fbf86']]);
  const r = el('radialGradient', { id: 'sun', cx: 0.5, cy: 0.5, r: 0.5 }, d);
  el('stop', { offset: 0, 'stop-color': '#fff7d6' }, r); el('stop', { offset: 1, 'stop-color': '#fff7d6', 'stop-opacity': 0 }, r);
  const fade = el('radialGradient', { id: 'vfade', cx: 0.5, cy: 0.5, r: 0.5 }, d);
  el('stop', { offset: 0.56, 'stop-color': '#fff' }, fade); el('stop', { offset: 1, 'stop-color': '#000' }, fade);
  const m = el('mask', { id: 'vmask', maskContentUnits: 'userSpaceOnUse' }, d); el('rect', { x: 0, y: 0, width: 720, height: 540, fill: 'url(#vfade)' }, m);
  const sh = el('radialGradient', { id: 'shadow', cx: 0.5, cy: 0.5, r: 0.5 }, d);
  el('stop', { offset: 0, 'stop-color': '#1d2420', 'stop-opacity': 0.22 }, sh); el('stop', { offset: 1, 'stop-color': '#1d2420', 'stop-opacity': 0 }, sh);
}
function tree(g, x, y, s, c = ['#6fa384', '#88b99a', '#5d9274']) {
  const t = el('g', {}, g); tf(t, x, y, 0, s);
  el('path', { d: 'M -7 0 L -5 -78 Q 0 -84 5 -78 L 8 0 Z', fill: '#8a6a4f' }, t);
  el('path', { d: 'M 0 -60 L 16 -84', stroke: '#8a6a4f', 'stroke-width': 4, 'stroke-linecap': 'round' }, t);
  el('circle', { cx: -22, cy: -92, r: 30, fill: c[2] }, t); el('circle', { cx: 18, cy: -100, r: 34, fill: c[0] }, t);
  el('circle', { cx: -4, cy: -124, r: 30, fill: c[1] }, t); el('circle', { cx: 26, cy: -78, r: 20, fill: c[2] }, t);
  return t;
}
function bush(g, x, y, s, c = '#7fb08f') { const b = el('g', {}, g); tf(b, x, y, 0, s); el('path', { d: 'M -34 0 Q -40 -26 -16 -28 Q -8 -46 12 -38 Q 34 -40 34 -16 Q 42 -4 34 0 Z', fill: c }, b); return b; }
function groundShadow(g, x, y, w) { return el('ellipse', { cx: x, cy: y, rx: w, ry: w * 0.16, fill: 'url(#shadow)' }, g); }

/* ---------- scene 1: 공원 쓰레기 줍기 ---------- */
function sceneLitter(g) {
  el('rect', { x: 0, y: 0, width: 720, height: 540, fill: 'url(#sky1)' }, g);
  el('circle', { cx: 590, cy: 110, r: 110, fill: 'url(#sun)' }, g);
  el('path', { d: 'M 0 330 Q 140 270 300 310 Q 470 250 720 300 L 720 540 L 0 540 Z', fill: '#c3dfc0' }, g);
  tree(g, 80, 360, 1.15); tree(g, 650, 350, 0.95, ['#7fae94', '#97c3a6', '#6f9f86']); tree(g, 560, 330, 0.55);
  el('path', { d: 'M 0 380 Q 360 350 720 372 L 720 540 L 0 540 Z', fill: 'url(#grass)' }, g);
  el('path', { d: 'M -20 470 Q 360 410 740 450 L 740 500 Q 360 460 -20 520 Z', fill: '#efe5cf' }, g);
  bush(g, 690, 420, 1.1); bush(g, 30, 430, 0.9, '#73a685');
  // helper sweeping far back
  const F = person(g, { skin: '#e6b58f', hairColor: '#4a2f22', hair: 'pony', top: '#f7f4ec', vest: '#3a8a63', pants: '#4b5470', shoe: '#ffffff' });
  const broom = el('g', {}, F.arms.f.tip); el('path', { d: 'M 0 -10 L 0 70', stroke: '#9a7651', 'stroke-width': 4, 'stroke-linecap': 'round' }, broom); el('path', { d: 'M -12 66 L 12 66 L 16 88 L -16 88 Z', fill: '#d9b86c' }, broom);
  const sh1 = groundShadow(g, 0, 0, 30);
  // litter
  const can = el('g', {}, g); el('rect', { x: -6, y: -15, width: 12, height: 17, rx: 2.5, fill: '#e0574f' }, can); el('rect', { x: -6, y: -15, width: 12, height: 3.5, fill: '#b13f39' }, can); el('rect', { x: -2, y: -11, width: 3, height: 9, fill: '#fff', opacity: 0.6 }, can);
  const paper = el('g', {}, g); el('path', { d: 'M -11 0 L -6 -10 L 4 -12 L 12 -4 L 8 2 Z', fill: '#f7f4ea', stroke: '#cdc6b3', 'stroke-width': 1.4 }, paper);
  const sh2 = groundShadow(g, 0, 0, 44);
  const V = person(g, { skin: '#f1c3a0', hairColor: '#2b2220', hair: 'short', top: '#f7f4ec', vest: '#2f7a55', pants: '#34435a', shoe: '#f4f4f2', cap: '#2f7a55' });
  // bag in the back hand, tongs in the front hand
  const bag = el('g', {}, V.arms.b.tip);
  el('path', { d: 'M -5 -4 Q 0 -12 5 -4', stroke: '#cfc8b4', 'stroke-width': 3, fill: 'none' }, bag);
  const bagBody = el('g', {}, bag);
  el('path', { d: 'M -17 -2 L 17 -2 L 20 46 Q 0 54 -20 46 Z', fill: '#f4f2ea', stroke: '#d2ccba', 'stroke-width': 1.6 }, bagBody);
  const fill = el('path', { d: 'M -19 30 L 19 30 L 20 46 Q 0 54 -20 46 Z', fill: '#a9cdb5' }, bagBody);
  const mouthMark = el('g', {}, bag); tf(mouthMark, 0, 2);
  const tongs = el('g', {}, V.arms.f.tip); tf(tongs, 0, -3);
  el('path', { d: 'M -2 0 L -2 64 M 2 0 L 2 64', stroke: '#7c817d', 'stroke-width': 3, 'stroke-linecap': 'round' }, tongs);
  const jawL = el('path', { d: 'M -2 62 L -8 72', stroke: '#7c817d', 'stroke-width': 3, 'stroke-linecap': 'round' }, tongs);
  const jawR = el('path', { d: 'M 2 62 L 8 72', stroke: '#7c817d', 'stroke-width': 3, 'stroke-linecap': 'round' }, tongs);
  const tip = el('g', {}, tongs); tf(tip, 0, 70);
  const heldCan = can.cloneNode(true); tip.appendChild(heldCan); heldCan.setAttribute('transform', 'translate(0 6) rotate(90)');
  const heldPaper = paper.cloneNode(true); tip.appendChild(heldPaper); heldPaper.setAttribute('transform', 'translate(0 4)');
  const falling = el('g', {}, g);
  const sparks = [0, 1].map(() => { const s = el('g', {}, g); el('path', { d: 'M 0 -9 L 2 -2 L 9 0 L 2 2 L 0 9 L -2 2 L -9 0 L -2 -2 Z', fill: '#f2b35c' }, s); return s; });
  const leaves = [0, 1, 2, 3].map(i => { const l = el('path', { d: 'M 0 0 Q 7 -7 14 0 Q 7 7 0 0 Z', fill: i % 2 ? '#8fbea3' : '#e3b25f' }, g); return l; });
  const CAN = { x: 470, y: 452 }, PAPER = { x: 598, y: 446 };
  const key = track([
    [0, { x: 150, walk: 1, lean: 4, ikw: 0, tx: 420, ty: 400, bagw: 0, bU: -22, bL: -18, fU: 10, fL: -24, mouth: 'smile', jaw: 1 }],
    [1.85, { x: 350, walk: 1 }],
    [2.1, { x: 362, walk: 0 }],
    [2.75, { lean: 64, y: 348, fT: -30, fS: 46, bT: -14, bS: 34, ikw: 1, tx: CAN.x, ty: CAN.y - 6, bU: -58, bL: -20, head: -14 }],
    [2.95, { jaw: 0 }],
    [3.65, { lean: 6, y: 332, fT: 0, fS: 0, bT: 0, bS: 0, bagw: 1, bU: -30, bL: -30, head: 6 }],
    [4.1, { jaw: 0 }],
    [4.25, { jaw: 1 }],
    [4.75, { ikw: 0, bagw: 0, fU: 10, fL: -24, head: 0 }],
    [4.8, { walk: 1 }],
    [6.0, { x: 482, walk: 1 }],
    [6.25, { x: 488, walk: 0 }],
    [6.9, { lean: 62, y: 348, fT: -30, fS: 46, bT: -14, bS: 34, ikw: 1, tx: PAPER.x, ty: PAPER.y - 4, bU: -58, bL: -20, head: -14 }],
    [7.1, { jaw: 0 }],
    [7.8, { lean: 6, y: 332, fT: 0, fS: 0, bT: 0, bS: 0, bagw: 1, bU: -30, bL: -30, head: 6 }],
    [8.2, { jaw: 0 }],
    [8.35, { jaw: 1 }],
    [9, { ikw: 0, bagw: 0, fU: 10, fL: -24, head: -4, mouth: 'open' }],
  ]);
  let phase = 0, last = 0;
  return t => {
    const k = key(t);
    const q = { ...STAND, ...k, hang: 1, blink: blinkAt(t) };
    // walking phase follows distance so feet do not slide
    if (t < last) phase = 0; last = t;
    phase = (k.x - 150) / 64 * Math.PI;
    walk(q, phase, k.walk);
    pose(V, q);
    const mouth = gpos(mouthMark);
    if (k.ikw > 0) {
      const target = { x: lerp(k.tx, mouth.x - 2, k.bagw), y: lerp(k.ty, mouth.y - 14, k.bagw) };
      const [a1, a2] = ik(shoulder(q), target, 40, 37 + 7 + 4 + 64, -1);
      q.fU = lerp(q.fU, a1 - q.lean, k.ikw); q.fL = lerp(q.fL, a2 - a1, k.ikw); q.fH = 0;
      pose(V, q);
    }
    tf(jawL, 0, 0, k.jaw * -8); tf(jawR, 0, 0, k.jaw * 8);
    jawL.setAttribute('transform', `rotate(${(k.jaw * 14).toFixed(1)} -2 62)`); jawR.setAttribute('transform', `rotate(${(-k.jaw * 14).toFixed(1)} 2 62)`);
    // litter state
    const canHeld = t >= 2.95 && t < 4.15, paperHeld = t >= 7.1 && t < 8.25;
    can.style.display = t < 2.95 ? '' : 'none'; tf(can, CAN.x, CAN.y);
    paper.style.display = t < 7.1 ? '' : 'none'; tf(paper, PAPER.x, PAPER.y);
    heldCan.style.display = canHeld ? '' : 'none'; heldPaper.style.display = paperHeld ? '' : 'none';
    // fall into the bag
    falling.innerHTML = '';
    for (const [t0, item] of [[4.15, can], [8.25, paper]]) {
      if (t >= t0 && t < t0 + 0.32) {
        const u = (t - t0) / 0.32, from = gpos(tip), to = gpos(mouthMark);
        const c = item.cloneNode(true); c.style.display = ''; falling.appendChild(c);
        tf(c, lerp(from.x, to.x, u), lerp(from.y + 6, to.y + 10, u * u), u * 120, 1 - u * 0.2);
      }
    }
    const filled = (t >= 4.45 ? 1 : 0) + (t >= 8.55 ? 1 : 0);
    fill.setAttribute('d', `M -19 ${38 - filled * 12} L 19 ${38 - filled * 12} L 20 46 Q 0 54 -20 46 Z`);
    const bump = Math.max(0, 1 - Math.abs(t - 4.47) * 6) + Math.max(0, 1 - Math.abs(t - 8.57) * 6);
    tf(bagBody, 0, 0, 0, 1 + bump * 0.08, 1 - bump * 0.05);
    sparks.forEach((s, i) => { const t0 = i ? 7.15 : 3.0, at = i ? PAPER : CAN, u = win(t, t0, t0 + 0.8); s.style.opacity = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0; tf(s, at.x, at.y - 14 - u * 18, u * 90, 0.6 + u * 0.6); });
    tf(sh1, 0, 0); sh1.setAttribute('cx', 0);
    const sx = q.x + 10; sh2.setAttribute('cx', sx); sh2.setAttribute('cy', 456);
    // helper sweeping (scaled, far back)
    const sw = Math.sin(t * 5.2);
    pose(F, { x: 236, y: 380, s: 0.68, f: 1, lean: 16, fT: -6, bT: 8, fU: -30 + sw * 22, fL: -30, fH: 20 - sw * 10, bU: -40 + sw * 14, bL: -50, head: 8, mouth: 'smile', blink: blinkAt(t + 1.3) });
    sh1.setAttribute('cx', 240); sh1.setAttribute('cy', 412); sh1.setAttribute('rx', 26);
    leaves.forEach((l, i) => { const p = ((t * 0.11 + i * 0.27) % 1); tf(l, 80 + i * 170 + Math.sin(p * 9 + i) * 30, -20 + p * 520, p * 540 + i * 40, 0.9); });
  };
}

/* ---------- scene 2: 어르신 말벗 ---------- */
function sceneTalk(g) {
  el('rect', { x: 0, y: 0, width: 720, height: 540, fill: 'url(#sky2)' }, g);
  el('circle', { cx: 140, cy: 120, r: 120, fill: 'url(#sun)' }, g);
  el('path', { d: 'M 0 360 Q 200 320 420 350 Q 600 320 720 340 L 720 540 L 0 540 Z', fill: '#cfe0bd' }, g);
  tree(g, 620, 410, 1.35, ['#79aa86', '#93c09e', '#679a77']);
  bush(g, 60, 440, 1.2, '#86b691');
  // lamp
  el('rect', { x: 92, y: 210, width: 6, height: 230, fill: '#55605a' }, g); el('path', { d: 'M 82 214 L 108 214 L 102 196 L 88 196 Z', fill: '#55605a' }, g); el('circle', { cx: 95, cy: 220, r: 8, fill: '#ffe9a8' }, g);
  el('path', { d: 'M 0 452 Q 360 430 720 452 L 720 540 L 0 540 Z', fill: '#e9dcc0' }, g);
  // flowers
  for (let i = 0; i < 9; i++) { const f = el('g', {}, g); tf(f, 520 + i * 22, 452 - (i % 3) * 4); el('path', { d: 'M 0 0 L 0 -16', stroke: '#6f9f74', 'stroke-width': 2 }, f); el('circle', { cx: 0, cy: -18, r: 5, fill: ['#f4a4a4', '#f7d27a', '#c7a6e8'][i % 3] }, f); }
  groundShadow(g, 360, 456, 160);
  // bench back
  const bench = el('g', {}, g);
  el('rect', { x: 196, y: 318, width: 330, height: 13, rx: 6, fill: '#b47d4f' }, bench); el('rect', { x: 196, y: 338, width: 330, height: 13, rx: 6, fill: '#c08a5b' }, bench);
  el('rect', { x: 214, y: 318, width: 8, height: 70, fill: '#6e5a48' }, bench); el('rect', { x: 500, y: 318, width: 8, height: 70, fill: '#6e5a48' }, bench);
  const E = person(g, { skin: '#e9b995', hairColor: '#dcdcd6', hair: 'elder', top: '#b9805f', cardigan: true, pants: '#666a74', shoe: '#5a4b40', glasses: true });
  const W = person(g, { skin: '#f3c9a8', hairColor: '#3b2a22', hair: 'pony', top: '#f7f4ec', vest: '#2f7a55', pants: '#3d4a63', shoe: '#ffffff' });
  // seat in front of the people's hips
  el('rect', { x: 190, y: 384, width: 342, height: 15, rx: 6, fill: '#c99561' }, g);
  el('rect', { x: 214, y: 396, width: 9, height: 56, fill: '#6e5a48' }, g); el('rect', { x: 500, y: 396, width: 9, height: 56, fill: '#6e5a48' }, g);
  // cane
  el('path', { d: 'M 214 452 L 236 330 Q 240 318 250 324', stroke: '#7a5a3f', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, g);
  // thermos on the bench
  const thermos = el('g', {}, g); tf(thermos, 470, 384); el('rect', { x: -8, y: -36, width: 16, height: 36, rx: 5, fill: '#4f8fb3' }, thermos); el('rect', { x: -6, y: -42, width: 12, height: 8, rx: 2, fill: '#2f6f8f' }, thermos);
  const cup = el('g', {}, g); el('path', { d: 'M -7 -10 L 7 -10 L 5.5 4 L -5.5 4 Z', fill: '#ffffff', stroke: '#d9d2c2', 'stroke-width': 1.3 }, cup); el('path', { d: 'M 7 -6 Q 12 -6 12 -2 Q 12 2 6.5 1', stroke: '#d9d2c2', 'stroke-width': 1.6, fill: 'none' }, cup);
  const steam = [0, 1, 2].map(i => el('path', { d: 'M 0 0 q 3 -5 0 -10 q -3 -5 0 -10', stroke: '#ffffff', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', opacity: 0.8 }, cup));
  const eHand = el('g', {}, E.arms.f.tip), wHand = el('g', {}, W.arms.f.tip);
  // bubbles with small pictures
  const bubble = (pic) => { const b = el('g', {}, g); el('path', { d: 'M -34 -26 H 34 Q 46 -26 46 -14 V 10 Q 46 22 34 22 H 4 L -6 34 L -8 22 H -34 Q -46 22 -46 10 V -14 Q -46 -26 -34 -26 Z', fill: '#ffffff', stroke: '#e3dccb', 'stroke-width': 2 }, b); pic(el('g', {}, b)); return b; };
  const b1 = bubble(p => { el('circle', { cx: -12, cy: -2, r: 9, fill: '#f6c35b' }, p); for (let i = 0; i < 8; i++) el('path', { d: 'M 0 -14 L 0 -18', stroke: '#f6c35b', 'stroke-width': 2.4, 'stroke-linecap': 'round', transform: `translate(-12 -2) rotate(${i * 45})` }, p); el('path', { d: 'M 6 6 Q 12 -12 22 6 Z', fill: '#7fb08f' }, p); });
  const b2 = bubble(p => { el('rect', { x: -22, y: -16, width: 30, height: 24, rx: 3, fill: '#e8eef8', stroke: '#9fb3d4', 'stroke-width': 1.5 }, p); el('circle', { cx: -14, cy: -7, r: 3, fill: '#f6c35b' }, p); el('path', { d: 'M -22 6 L -10 -4 L -2 4 L 8 -6 L 8 8 L -22 8 Z', fill: '#7fb08f' }, p); el('path', { d: 'M 18 -6 c -4 -6 -12 -1 -8 5 l 8 7 l 8 -7 c 4 -6 -4 -11 -8 -5 z', fill: '#e8796b' }, p); });
  const b3 = bubble(p => { el('path', { d: 'M -16 8 V -12 L 10 -16 V 4', stroke: '#2f6f52', 'stroke-width': 3, fill: 'none' }, p); el('ellipse', { cx: -20, cy: 8, rx: 6, ry: 4.5, fill: '#2f6f52' }, p); el('ellipse', { cx: 6, cy: 4, rx: 6, ry: 4.5, fill: '#2f6f52' }, p); });
  const hearts = [0, 1, 2].map(() => { const h = el('path', { d: 'M 0 -4 c -5 -8 -16 -2 -10 6 l 10 9 l 10 -9 c 6 -8 -5 -14 -10 -6 z', fill: '#ec7f70' }, g); return h; });
  const SIT = { y: 378, fT: -86, fS: 84, bT: -80, bS: 80 };
  const eKey = track([
    [0, { ...SIT, x: 286, lean: -2, head: 2, fU: -20, fL: -60, bU: -10, bL: -50, mouth: 'smile' }],
    [1.9, { fU: -20, fL: -60 }],
    [2.4, { fU: -64, fL: -10, head: 6 }],
    [2.9, { fU: -30, fL: -60, head: 0 }],
    [3.3, { head: -8, lean: -6 }],
    [3.9, { head: -12 }],
    [4.4, { fU: -24, fL: -62, head: 0, lean: -2 }],
  ]);
  const wKey = track([
    [0, { ...SIT, x: 436, f: -1, lean: 2, head: -2, fU: -40, fL: -40, bU: -8, bL: -40, pony: 0 }],
    [1.6, { fU: -40, fL: -40 }],
    [2.3, { fU: -74, fL: -6, lean: 10, head: 6 }],
    [2.7, { fU: -40, fL: -40, lean: 2, head: 0 }],
  ]);
  return t => {
    const e = eKey(t), w = wKey(t);
    const laugh = win(t, 4.7, 5.0) * (1 - win(t, 6.6, 6.9));
    const shake = Math.sin(t * 22) * laugh;
    const eTalk = (t > 0.2 && t < 1.4) || (t > 7.0 && t < 8.4), wTalk = (t > 1.5 && t < 2.1) || (t > 5.3 && t < 6.2) === false && (t > 5.3 && t < 6.2) || (t > 8.5);
    const eq = { ...STAND, ...e, lean: e.lean + shake * 3, head: e.head + shake * 4 + (eTalk ? Math.sin(t * 9) * 2 : 0), mouth: laugh > 0.3 ? 'laugh' : eTalk ? talkMouth(t) : (t > 3.3 && t < 3.95 ? 'o' : 'smile'), blink: laugh > 0.3 ? 1 : blinkAt(t), fH: (t > 7 && t < 8.4) ? Math.sin(t * 8) * 18 : 0 };
    pose(E, eq);
    const sip = win(t, 2.9, 3.3) * (1 - win(t, 3.95, 4.4));
    if (sip > 0) { const m = gpos(E.mouthG); const [a1, a2] = ik(shoulder(eq), { x: m.x + 2, y: m.y + 8 }, 40, 44, -1); eq.fU = lerp(eq.fU, a1 - eq.lean, sip); eq.fL = lerp(eq.fL, a2 - a1, sip); pose(E, eq); }
    const wGesture = (t > 5.3 && t < 6.6) ? Math.sin(t * 7) * 12 : 0;
    pose(W, { ...w, lean: w.lean + shake * 3, head: w.head - shake * 4 + (wTalk ? Math.sin(t * 9 + 1) * 2 : 0), mouth: laugh > 0.3 ? 'laugh' : wTalk ? talkMouth(t + 0.3) : 'smile', blink: laugh > 0.3 ? 1 : blinkAt(t + 0.8), pony: Math.sin(t * 3) * 6 + shake * 10, fU: w.fU + wGesture });
    // the cup: from the thermos to her hand, to his hand, to his mouth
    const at = (n, dx = 0, dy = 0) => { const p = gpos(n); return { x: p.x + dx, y: p.y + dy }; };
    let p;
    const th = { x: 470, y: 340 }, wp = at(wHand, 0, -2), ep = at(eHand, 0, -2);
    if (t < 1.4) p = th;
    else if (t < 1.8) { const u = ease(win(t, 1.4, 1.8)); p = { x: lerp(th.x, wp.x, u), y: lerp(th.y, wp.y, u) }; }
    else if (t < 2.25) p = wp;
    else if (t < 2.45) { const u = ease(win(t, 2.25, 2.45)); p = { x: lerp(wp.x, ep.x, u), y: lerp(wp.y, ep.y, u) }; }
    else p = ep;
    const tilt = t > 3.3 && t < 3.95 ? -30 * Math.sin(win(t, 3.3, 3.95) * Math.PI) : 0;
    tf(cup, p.x, p.y, tilt);
    steam.forEach((s, i) => { const u = ((t * 0.8 + i * 0.33) % 1); s.setAttribute('transform', `translate(${-3 + i * 3} ${-12 - u * 16})`); s.setAttribute('opacity', (1 - u) * 0.75); });
    const pop = (b, a, z, x, y) => { const u = win(t, a, a + 0.35), v = 1 - win(t, z - 0.25, z); const s = u < 1 ? 1.1 * Math.sin(u * Math.PI * 0.5) + (u > 0.8 ? 0 : 0) : 1; const k = Math.min(u, v); b.style.opacity = k; tf(b, x, y - (1 - k) * 8, 0, Math.max(0.01, Math.min(1, s) * (0.6 + 0.4 * k))); };
    pop(b1, 0.3, 1.5, 250, 196);
    pop(b2, 5.3, 6.6, 470, 190);
    pop(b3, 7.1, 8.6, 250, 196);
    hearts.forEach((h, i) => { const u = win(t, 4.8 + i * 0.35, 6.4 + i * 0.35); h.style.opacity = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0; tf(h, 352 + (i - 1) * 26 + Math.sin(u * 8 + i) * 8, 250 - u * 90, Math.sin(u * 6) * 12, 0.8 + i * 0.12); });
  };
}

/* ---------- scene 3: 유기견 산책 ---------- */
function dog(parent) {
  const D = {}; D.root = el('g', {}, parent);
  const fur = '#d6a06a', far = '#bf8a57', belly = '#f1d4ac';
  const leg = (x, back, farSide) => { const up = el('g', {}, D.root); tf(up, x, 0); el('path', { d: seg(20, back ? 15 : 12, 10), fill: farSide ? far : fur }, up); const lo = el('g', {}, up); tf(lo, 0, 19); el('path', { d: seg(18, 9.5, 8), fill: farSide ? far : fur }, lo); el('ellipse', { cx: 2, cy: 19, rx: 6.5, ry: 4, fill: farSide ? '#a8774a' : '#c48e5a' }, lo); return { up, lo }; };
  D.lf = leg(-24, true, true); D.rf = leg(26, false, true);
  D.tail = el('g', {}, D.root); tf(D.tail, -40, -12); el('path', { d: 'M 0 0 Q -14 -8 -12 -26 Q -10 -30 -6 -26 Q -8 -12 4 -4 Z', fill: fur }, D.tail);
  D.bodyG = el('g', {}, D.root);
  el('path', { d: 'M -44 -10 Q -46 -34 -14 -34 L 22 -34 Q 46 -34 46 -10 Q 46 8 22 8 L -22 8 Q -44 8 -44 -10 Z', fill: fur }, D.bodyG);
  el('path', { d: 'M -30 4 Q 0 14 30 4 Q 0 -2 -30 4 Z', fill: belly }, D.bodyG);
  D.lb = leg(-28, true, false); D.rb = leg(24, false, false);
  D.head = el('g', {}, D.root); tf(D.head, 40, -30);
  el('path', { d: 'M -10 10 L -2 -10 L 8 -10 L 10 12 Z', fill: fur }, D.head);
  el('rect', { x: -9, y: -2, width: 20, height: 7, rx: 3, fill: '#e2574c' }, D.head);
  D.collar = el('g', {}, D.head); tf(D.collar, 6, 2); el('circle', { cx: 0, cy: 4, r: 3.4, fill: '#f6c35b' }, D.collar);
  el('ellipse', { cx: 8, cy: -26, rx: 19, ry: 17, fill: fur }, D.head);
  el('ellipse', { cx: 24, cy: -20, rx: 13, ry: 9, fill: belly }, D.head);
  el('ellipse', { cx: 35, cy: -24, rx: 4.6, ry: 3.8, fill: '#2a1f1a' }, D.head);
  D.eye = el('ellipse', { cx: 15, cy: -31, rx: 2.6, ry: 3.2, fill: '#2a1f1a' }, D.head);
  D.tongue = el('path', { d: 'M 24 -12 Q 27 -2 31 -12 Z', fill: '#ec7f7f' }, D.head);
  D.ear = el('g', {}, D.head); tf(D.ear, -2, -38); el('path', { d: 'M 0 0 Q -14 4 -12 26 Q -2 26 6 4 Z', fill: '#a8774a' }, D.ear);
  D.top = el('g', {}, D.head); tf(D.top, 6, -42);
  return D;
}
function sceneWalk(g) {
  el('rect', { x: 0, y: 0, width: 720, height: 540, fill: 'url(#sky3)' }, g);
  const clouds = el('g', {}, g);
  for (let i = 0; i < 4; i++) { const c = el('path', { d: 'M 0 0 Q 6 -20 26 -14 Q 38 -32 60 -18 Q 82 -22 82 0 Z', fill: '#ffffff', opacity: 0.9 }, clouds); c.dataset.x = i * 240; c.dataset.y = 70 + (i % 2) * 40; }
  const hills = el('g', {}, g);
  for (let i = 0; i < 2; i++) el('path', { d: `M ${i * 720} 330 Q ${i * 720 + 180} 270 ${i * 720 + 360} 316 Q ${i * 720 + 540} 270 ${i * 720 + 720} 330 L ${i * 720 + 720} 540 L ${i * 720} 540 Z`, fill: '#bcd9b8' }, hills);
  const trees = el('g', {}, g);
  for (let i = 0; i < 6; i++) tree(trees, i * 240 + 40, 392, i % 2 ? 0.8 : 1.05, i % 2 ? ['#7fae94', '#97c3a6', '#6f9f86'] : undefined);
  el('path', { d: 'M 0 392 L 720 392 L 720 540 L 0 540 Z', fill: 'url(#grass)' }, g);
  el('path', { d: 'M 0 436 L 720 436 L 720 500 L 0 500 Z', fill: '#ede3cc' }, g);
  const near = el('g', {}, g);
  for (let i = 0; i < 6; i++) { const x = i * 240; bush(near, x + 120, 430, 0.8, i % 2 ? '#7fb08f' : '#6ea582'); const lamp = el('g', {}, near); tf(lamp, x + 200, 432); el('rect', { x: -3, y: -150, width: 6, height: 150, fill: '#55605a' }, lamp); el('circle', { cx: 0, cy: -154, r: 9, fill: '#ffe9a8', stroke: '#55605a', 'stroke-width': 3 }, lamp); }
  const tiles = el('g', {}, g);
  for (let i = 0; i < 24; i++) el('rect', { x: i * 60, y: 466, width: 34, height: 4, rx: 2, fill: '#ddd0b2' }, tiles);
  const shV = groundShadow(g, 300, 470, 40), shD = groundShadow(g, 470, 470, 52);
  const D = dog(g);
  const V = person(g, { skin: '#f1c3a0', hairColor: '#2b2220', hair: 'short', top: '#f7f4ec', vest: '#2f7a55', pants: '#34435a', shoe: '#f4f4f2' });
  const leash = el('path', { d: '', stroke: '#e2574c', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, g);
  g.insertBefore(leash, V.root);
  const hand = el('g', {}, V.arms.f.tip);
  const butterflies = [0, 1].map(i => { const b = el('g', {}, g); const w1 = el('path', { d: 'M 0 0 Q -12 -14 -14 -2 Q -10 6 0 0 Z', fill: i ? '#f6c35b' : '#9fb3e8' }, b); const w2 = el('path', { d: 'M 0 0 Q 12 -14 14 -2 Q 10 6 0 0 Z', fill: i ? '#f2a65a' : '#7f97d6' }, b); return { b, w1, w2 }; });
  const notes = [0, 1].map(() => el('path', { d: 'M 0 -4 c -5 -8 -16 -2 -10 6 l 10 9 l 10 -9 c 6 -8 -5 -14 -10 -6 z', fill: '#ec7f70' }, g));
  const V0 = 118, STOP = 5.4, SLOW = 0.9;
  const dist = t => t < STOP ? V0 * t : V0 * STOP + V0 * SLOW * (Math.min(1, (t - STOP) / SLOW) - Math.pow(Math.min(1, (t - STOP) / SLOW), 2) / 2);
  const speed = t => t < STOP ? 1 : Math.max(0, 1 - (t - STOP) / SLOW);
  const vKey = track([
    [0, { x: 290, y: 332, lean: 4, crouch: 0, ikw: 0, step: 0 }],
    [6.2, { x: 290, step: 1 }],
    [6.9, { x: 340, step: 1 }],
    [7.0, { step: 0, crouch: 0, ikw: 0 }],
    [7.5, { crouch: 1, ikw: 1 }],
    [8.3, { crouch: 1, ikw: 1 }],
    [9, { crouch: 0.2, ikw: 0.3 }],
  ]);
  return t => {
    const s = dist(t), sp = speed(t), ph = s / 66 * Math.PI;
    const k = vKey(t);
    const q = { ...STAND, x: k.x, y: k.y + k.crouch * 40, lean: 4 + k.crouch * 24, fU: 18, fL: -38, bU: -4, bL: -12, blink: blinkAt(t), mouth: t > 7.5 && t < 8.6 ? 'open' : 'smile', head: k.crouch * 12 };
    q.fT = -k.crouch * 84; q.fS = k.crouch * 104; q.bT = k.crouch * 18; q.bS = k.crouch * 92; q.bF = -(q.bT + q.bS) + k.crouch * 60;
    walk(q, ph + (k.x - 290) / 60 * Math.PI, Math.max(sp, k.step));
    // dog: trot, then sit and look up
    const dp = ph * 1.5, sit = win(t, 5.9, 6.4) * (1 - win(t, 8.6, 9));
    const dy = 432 - 36 + Math.abs(Math.sin(dp)) * -3 * sp;
    tf(D.root, 470, dy + sit * 6, -sit * 22);
    const tr = (L, ph2) => { tf(L.up, +L.up.getAttribute('data-x') || 0, 0); };
    const legA = (L, x, a, b) => { tf(L.up, x, 0, a); tf(L.lo, 0, 19, b); };
    const A = 26 * sp, s1 = Math.sin(dp), s2 = Math.sin(dp + Math.PI);
    legA(D.lf, -24, -A * s2 + sit * -70, Math.max(0, -s2) * 30 * sp + sit * 120);
    legA(D.lb, -28, -A * s1 + sit * -80, Math.max(0, -s1) * 30 * sp + sit * 120);
    legA(D.rf, 26, A * s1 + sit * 20, -Math.max(0, s1) * 26 * sp);
    legA(D.rb, 24, A * s2 + sit * 22, -Math.max(0, s2) * 26 * sp);
    const pat = win(t, 7.6, 8.4) > 0 && t < 8.4;
    tf(D.head, 40, -30, sit * 18 - (pat ? 6 : 0) + Math.sin(dp * 2) * 2 * sp);
    tf(D.ear, -2, -38, 10 + Math.sin(dp * 2) * 14 * sp + (pat ? Math.sin(t * 12) * 6 : 0));
    tf(D.tail, -40, -12, Math.sin(t * (sit > 0.5 ? 26 : 12)) * (sit > 0.5 ? 22 : 14));
    D.eye.setAttribute('ry', pat ? 0.7 : 3.2);
    D.tongue.style.opacity = sp > 0.2 || pat ? 1 : 0;
    pose(V, q);
    if (k.ikw > 0) {
      const top = gpos(D.top), wob = pat ? Math.sin(t * 11) * 5 : 0;
      const [a1, a2] = ik(shoulder(q), { x: top.x - 4, y: top.y - 8 + wob }, 40, 44, -1);
      q.fU = lerp(q.fU, a1 - q.lean, k.ikw); q.fL = lerp(q.fL, a2 - a1, k.ikw); q.fH = lerp(0, -20, k.ikw);
      pose(V, q);
    }
    const h = gpos(hand), c = gpos(D.collar), slack = clamp(1 - Math.hypot(c.x - h.x, c.y - h.y) / 200, 0, 1);
    leash.setAttribute('d', `M ${h.x.toFixed(1)} ${h.y.toFixed(1)} Q ${((h.x + c.x) / 2).toFixed(1)} ${(Math.max(h.y, c.y) + 14 + slack * 50).toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`);
    // parallax
    const wrap = (x, w) => ((x % w) + w) % w;
    tf(hills, -wrap(s * 0.15, 720), 0);
    tf(trees, -wrap(s * 0.45, 480), 0);
    tf(near, -wrap(s, 480), 0);
    tf(tiles, -wrap(s, 60), 0);
    [...clouds.children].forEach(c => tf(c, wrap(+c.dataset.x - s * 0.06 - t * 6, 960) - 120, +c.dataset.y));
    shV.setAttribute('cx', q.x + 6); shD.setAttribute('cx', 470);
    butterflies.forEach(({ b, w1, w2 }, i) => { const u = t * 0.6 + i * 2; tf(b, 120 + i * 360 + Math.sin(u) * 60, 200 + Math.sin(u * 1.7) * 40 + i * 30, Math.sin(u * 2) * 12); const f = Math.abs(Math.sin(t * 16 + i)); w1.setAttribute('transform', `scale(${0.3 + f * 0.7} 1)`); w2.setAttribute('transform', `scale(${0.3 + f * 0.7} 1)`); });
    notes.forEach((n, i) => { const u = win(t, 7.4 + i * 0.4, 8.6 + i * 0.4); n.style.opacity = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0; tf(n, 500 + i * 26, 360 - u * 70, 0, 0.8); });
  };
}

/* ---------- scene 4: 도서관 책 정리 ---------- */
function book(parent, color) { const b = el('g', {}, parent); el('rect', { x: -8, y: -27, width: 16, height: 54, rx: 2, fill: color }, b); el('rect', { x: -8, y: -19, width: 16, height: 3, fill: '#ffffff', opacity: 0.55 }, b); el('rect', { x: -8, y: 15, width: 16, height: 3, fill: '#ffffff', opacity: 0.55 }, b); return b; }
function sceneBooks(g) {
  el('rect', { x: 0, y: 0, width: 720, height: 540, fill: 'url(#wall)' }, g);
  // window and light
  el('rect', { x: 70, y: 70, width: 150, height: 180, rx: 10, fill: '#cfe4ef' }, g); el('path', { d: 'M 145 70 V 250 M 70 160 H 220', stroke: '#f1e6d2', 'stroke-width': 8 }, g);
  el('path', { d: 'M 70 250 L 220 250 L 380 452 L 120 452 Z', fill: 'url(#beam)' }, g);
  el('rect', { x: 0, y: 452, width: 720, height: 88, fill: '#d9c4a1' }, g);
  for (let i = 0; i < 8; i++) el('rect', { x: i * 96, y: 452, width: 2, height: 88, fill: '#cbb48f' }, g);
  // shelf
  const shelf = el('g', {}, g);
  el('rect', { x: 468, y: 120, width: 216, height: 332, rx: 8, fill: '#a9774e' }, shelf); el('rect', { x: 478, y: 130, width: 196, height: 314, rx: 4, fill: '#f6ecd9' }, shelf);
  const rows = [210, 300, 390];
  rows.forEach(y => el('rect', { x: 478, y, width: 196, height: 10, fill: '#a9774e' }, shelf));
  const palette = ['#7fae94', '#f0a050', '#5b8bd0', '#d9534f', '#c7b9a6', '#8fbea3', '#e8c46b', '#5d6470', '#c58ab0'];
  const slots = [{ y: 210, x: 512 }, { y: 300, x: 504 }];
  rows.forEach((y, r) => { let x = 484; let i = r * 3; while (x < 664) { const w = 14 + ((i * 7) % 6); const skip = slots.some(s => s.y === y && x <= s.x + 4 && x + w >= s.x - 12); if (!skip) { const h = 58 - ((i * 5) % 14); el('rect', { x, y: y - h, width: w, height: h, rx: 2, fill: palette[i % palette.length] }, shelf); } else { x += 6; } x += w + 2; i++; } });
  // plant + lamp
  const plant = el('g', {}, g); tf(plant, 640, 120); el('path', { d: 'M -14 0 L 14 0 L 10 -20 L -10 -20 Z', fill: '#d98a5a' }, plant); for (let i = 0; i < 5; i++) el('path', { d: 'M 0 -20 Q 6 -40 0 -54', stroke: '#6f9f74', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round', transform: `translate(0 0) rotate(${-40 + i * 20} 0 -20)` }, plant);
  // child on a bean bag
  const bean = el('g', {}, g); tf(bean, 170, 446); el('path', { d: 'M -60 0 Q -70 -40 -30 -46 Q 0 -60 30 -46 Q 70 -40 60 0 Z', fill: '#f0a050' }, bean); el('path', { d: 'M -40 -14 Q 0 -4 40 -14', stroke: '#e08c3a', 'stroke-width': 3, fill: 'none' }, bean);
  const C = person(g, { skin: '#f3cfae', hairColor: '#3a2a22', hair: 'kid', top: '#5b8bd0', pants: '#e8c46b', shoe: '#ffffff' });
  const open = el('g', {}, C.arms.f.tip); tf(open, 4, -4);
  el('path', { d: 'M -18 0 L 0 4 L 18 0 L 18 -22 L 0 -18 L -18 -22 Z', fill: '#ffffff', stroke: '#d6cfbf', 'stroke-width': 1.4 }, open);
  el('path', { d: 'M 0 4 V -18', stroke: '#d6cfbf', 'stroke-width': 1.4 }, open);
  const page = el('path', { d: 'M 0 4 L 18 0 L 18 -22 L 0 -18 Z', fill: '#f7f4ec', stroke: '#d6cfbf', 'stroke-width': 1.2 }, open);
  el('path', { d: 'M -18 -24 L 0 -20 L 18 -24 L 18 -21 L 0 -17 L -18 -21 Z', fill: '#7fae94' }, open);
  // cart
  const cart = el('g', {}, g); tf(cart, 450, 452);
  const V = person(g, { skin: '#e9b896', hairColor: '#1f1a18', hair: 'short', top: '#f7f4ec', vest: '#2f7a55', pants: '#34435a', shoe: '#f4f4f2' });
  el('rect', { x: -44, y: -76, width: 88, height: 8, rx: 3, fill: '#8a8f8b' }, cart); el('rect', { x: -40, y: -70, width: 80, height: 46, rx: 4, fill: '#b9bfbb' }, cart); el('rect', { x: -44, y: -28, width: 88, height: 6, rx: 3, fill: '#8a8f8b' }, cart);
  el('circle', { cx: -30, cy: -8, r: 8, fill: '#55605a' }, cart); el('circle', { cx: 30, cy: -8, r: 8, fill: '#55605a' }, cart);
  el('rect', { x: -38, y: -90, width: 50, height: 14, rx: 2, fill: '#7fae94' }, cart);
  const b1 = book(g, '#9b6fc0'), b2 = book(g, '#e07a5f');
  const hand = el('g', {}, V.arms.f.tip);
  const motes = [0, 1, 2, 3, 4].map(() => el('circle', { r: 2, fill: '#fff6d8' }, g));
  const CART1 = { x: 436, y: 372, a: 90 }, CART2 = { x: 462, y: 372, a: 90 };
  const vKey = track([
    [0, { x: 356, y: 332, lean: 2, ikw: 0, tx: 420, ty: 330, walk: 0, fU: 6, fL: -14, bU: -4, bL: -10 }],
    [0.4, {}],
    [1.15, { lean: 46, y: 342, fT: -22, fS: 34, bT: -8, bS: 24, ikw: 1, tx: CART1.x - 6, ty: CART1.y + 2, head: -8 }],
    [1.35, {}],
    [2.0, { lean: 4, y: 332, fT: 0, fS: 0, bT: 0, bS: 0, tx: 410, ty: 284, head: 0 }],
    [2.1, { walk: 1 }],
    [2.8, { x: 408, walk: 1 }],
    [2.95, { walk: 0 }],
    [3.55, { tx: slots[0].x - 8, ty: slots[0].y - 26, y: 326, head: -14, bU: -10 }],
    [3.95, { tx: slots[0].x - 2, ty: slots[0].y - 26 }],
    [4.4, { tx: 430, ty: 300, y: 332, head: 0 }],
    [4.5, { walk: 1 }],
    [4.95, { x: 380, walk: 1 }],
    [5.05, { walk: 0 }],
    [5.7, { lean: 46, y: 342, fT: -22, fS: 34, bT: -8, bS: 24, tx: CART2.x - 6, ty: CART2.y + 2, head: -8 }],
    [5.9, {}],
    [6.5, { lean: 4, y: 332, fT: 0, fS: 0, bT: 0, bS: 0, tx: 420, ty: 300, head: 0 }],
    [6.6, { walk: 1 }],
    [7.0, { x: 412, walk: 1 }],
    [7.1, { walk: 0 }],
    [7.6, { tx: slots[1].x - 8, ty: slots[1].y - 26, head: -6 }],
    [8.0, { tx: slots[1].x - 2, ty: slots[1].y - 26 }],
    [8.5, { ikw: 0, fU: 6, fL: -14, head: 0 }],
  ]);
  return t => {
    const k = vKey(t);
    const q = { ...STAND, ...k, blink: blinkAt(t), mouth: t > 8.4 ? 'open' : 'smile' };
    walk(q, (k.x - 356) / 30 * Math.PI, k.walk);
    pose(V, q);
    if (k.ikw > 0) { const [a1, a2] = ik(shoulder(q), { x: k.tx, y: k.ty }, 40, 44, -1); q.fU = lerp(q.fU, a1 - q.lean, k.ikw); q.fL = lerp(q.fL, a2 - a1, k.ikw); q.fH = 0; pose(V, q); }
    const hp = gpos(hand);
    const place = (b, from, slot, tGrab, tIn, tDone) => {
      let x, y, a;
      if (t < tGrab) { x = from.x; y = from.y; a = from.a; }
      else if (t < tIn) { const u = ease(win(t, tGrab, tGrab + 0.5)); x = lerp(from.x, hp.x + 4, Math.min(1, u * 1.4)); y = lerp(from.y, hp.y - 4, Math.min(1, u * 1.4)); a = lerp(from.a, 0, u); x = t > tGrab + 0.36 ? hp.x + 4 : x; y = t > tGrab + 0.36 ? hp.y - 4 : y; }
      else { const u = ease(win(t, tIn, tDone)); x = lerp(hp.x + 4, slot.x, u); y = lerp(hp.y - 4, slot.y - 27, u); a = 0; if (t >= tDone) { x = slot.x; y = slot.y - 27; } }
      tf(b, x, y, a);
    };
    place(b1, CART1, slots[0], 1.2, 3.6, 3.95);
    place(b2, CART2, slots[1], 5.75, 7.65, 8.0);
    // child reading, turns a page every 1.6s, looks up at the end
    const flip = (t % 1.6) / 1.6, fl = flip > 0.75 ? (flip - 0.75) / 0.25 : 0;
    page.setAttribute('transform', `scale(${(1 - fl * 2).toFixed(2)} 1)`);
    const look = win(t, 8.2, 8.6);
    pose(C, { x: 168, y: 410, s: 0.66, lean: -10 + look * 6, fT: -82, fS: 70, bT: -76, bS: 74, fU: -46 - look * 60, fL: -70 + look * 40, bU: -40, bL: -70, head: 14 - look * 22, mouth: look > 0.5 ? 'open' : 'calm', blink: blinkAt(t + 0.5), fH: look * 20 });
    motes.forEach((m, i) => { const u = ((t * 0.05 + i * 0.21) % 1); m.setAttribute('cx', 120 + i * 50 + Math.sin(u * 12 + i) * 10); m.setAttribute('cy', 430 - u * 200); m.setAttribute('opacity', Math.sin(u * Math.PI) * 0.8); });
  };
}


/* ---------- stage ---------- */
defs();
const root = el('g', { mask: 'url(#vmask)' }, svg);
const SCENES = [
  { cat: '환경', name: '공원 쓰레기 줍기', build: sceneLitter, len: 9, speed: 0.9 },
  { cat: '복지', name: '어르신 말벗', build: sceneTalk, len: 9, speed: 0.75 },
  { cat: '동물', name: '유기견 산책', build: sceneWalk, len: 9, speed: 0.95 },
  { cat: '교육', name: '도서관 책 정리', build: sceneBooks, len: 9, speed: 0.75 },
];
const FADE = 0.8;
const layers = SCENES.map(s => { const g = el('g', {}, root); return { g, update: s.build(g), dur: s.len / s.speed, speed: s.speed }; });
const total = layers.reduce((a, l) => a + l.dur, 0);
let t = opts.start ?? 0, playing = opts.playing ?? true, last = null, raf = 0, shown = -1;
function render() {
  let T = ((t % total) + total) % total, i = 0;
  while (T >= layers[i].dur) { T -= layers[i].dur; i++; }
  const L = layers[i], j = (i + 1) % layers.length, lt = T * L.speed;
  const out = T > L.dur - FADE ? (T - (L.dur - FADE)) / FADE : 0;
  clock.time = t;
  layers.forEach((x, k) => {
    const on = k === i || (k === j && out > 0);
    x.g.style.display = on ? '' : 'none';
    if (!on) return;
    if (k === i) { x.update(Math.min(lt, 9)); x.g.style.opacity = 1; } else { x.update(0); x.g.style.opacity = ease(out); }
  });
  root.appendChild(layers[out > 0 ? j : i].g);
  if (i !== shown) { shown = i; opts.onScene?.(i); }
  opts.onProgress?.(i, T / L.dur);
}
function frame(now) {
  const dt = last == null ? 0 : Math.min(0.1, (now - last) / 1000);
  last = now;
  clock.dt = playing ? dt : 0; clock.frame++;
  if (playing) t += dt;
  render();
  raf = requestAnimationFrame(frame);
}
clock.frame++; render();
if (opts.animate !== false) raf = requestAnimationFrame(frame);
return {
  scenes: SCENES.map(s => ({ cat: s.cat, name: s.name })),
  play(v) { playing = v; last = null; },
  go(i) { let a = 0; for (let k = 0; k < i; k++) a += layers[k].dur; t = a + 0.01; clock.dt = 0; clock.frame++; render(); },
  seek(i, local) { let a = 0; for (let k = 0; k < i; k++) a += layers[k].dur; t = a + local / layers[i].speed; clock.dt = 0; clock.frame++; render(); },
  destroy() { cancelAnimationFrame(raf); svg.innerHTML = ''; },
};
}
