import { lerp } from "../../core/anim";
import type { EyeShape, Badge, RGB, BotStateCfg } from "./states";
import type { Particle } from "./particles";

// ── Constants (MochiConst / PISTES.mochi) ─────────────────────────────────────

export const EYE_W = 0.25;
export const EYE_H = 0.27;
export const EYE_SP = 0.37;
export const EYE_P = -0.12;
export const BASE_TOP: RGB = [0.929, 0.929, 0.937]; // #EDEDEF
export const BASE_BOTTOM: RGB = [0.769, 0.773, 0.792]; // #C4C5CA
export const INK = "rgb(26,20,18)"; // #1A1412
export const MINI_INK = "rgb(16,19,26)"; // #10131A
export const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`;

// ── Small helpers ─────────────────────────────────────────────────────────────

export function hexToRGB(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export const rgba = (c: RGB, a = 1): string =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

export const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

export function roundRectPath(
  x: CanvasRenderingContext2D,
  X: number,
  Y: number,
  W: number,
  H: number,
  R: number,
): void {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

export function heartPath(x: CanvasRenderingContext2D, s: number): void {
  x.beginPath();
  x.moveTo(0, s * 0.38);
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38);
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38);
  x.closePath();
}

export function starPath(x: CanvasRenderingContext2D, ro: number, ri: number): void {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

/** Ray → rounded-rect boundary intersection, for the mailbox morph. */
export function rrPoint(
  ca: number,
  sa: number,
  W: number,
  H: number,
  cr: number,
): { x: number; y: number } {
  const eps = 1e-6;
  const kx = ca >= 0 ? 1 : -1;
  const ky = sa >= 0 ? 1 : -1;
  const cx = kx * (W - cr);
  const cy = ky * (H - cr);

  const dot = ca * cx + sa * cy;
  const disc = dot * dot - (cx * cx + cy * cy - cr * cr);
  if (disc >= 0) {
    const t = dot + Math.sqrt(disc);
    if (t > eps) {
      const px = ca * t;
      const py = sa * t;
      if (Math.abs(px) >= W - cr - eps && Math.abs(py) >= H - cr - eps) return { x: px, y: py };
    }
  }
  if (Math.abs(sa) > eps) {
    const t = (ky * H) / sa;
    if (t > eps) {
      const px = ca * t;
      if (Math.abs(px) <= W - cr + eps) return { x: px, y: ky * H };
    }
  }
  if (Math.abs(ca) > eps) {
    const t = (kx * W) / ca;
    if (t > eps) {
      const py = sa * t;
      if (Math.abs(py) <= H - cr + eps) return { x: kx * W, y: py };
    }
  }
  return { x: kx * W, y: ky * H };
}

export function bodyPath(rx: number, ry: number, R: number, morph = 0): Path2D {
  const n = 72;
  const expN = 2.0 / 2.7;
  const tw = R * 1.0;
  const th = R * 0.94;
  const tr = R * 0.42;
  const p = new Path2D();
  const m = morph;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px0 = rx * (ca >= 0 ? Math.pow(ca, expN) : -Math.pow(-ca, expN));
    const py0 = ry * (sa >= 0 ? Math.pow(sa, expN) : -Math.pow(-sa, expN));
    let px = px0;
    let py = py0;
    if (m >= 0.005) {
      const rr = rrPoint(ca, sa, tw, th, tr);
      px = lerp(px0, rr.x, m);
      py = lerp(py0, rr.y, m);
    }
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

export interface BotRenderState {
  readonly isMini: boolean;
  readonly bodyColor: RGB | null;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly tilt: number;
  readonly open: number;
  readonly sx: number;
  readonly sy: number;
  readonly oy: number;
  readonly ox: number;
  readonly tint: number;
  readonly morph: number;
  readonly hands: number;
  readonly blush: number;
  readonly es: number;
  readonly badgeS: number;
  readonly particleOverhang: number;
  readonly slotH: number;
  readonly slotHTarget: number;
  readonly isChewing: boolean;
  readonly col: RGB;
  readonly cfg: Pick<BotStateCfg, "eye"> | BotStateCfg;
  readonly eyeOverride: EyeShape | null;
  readonly badge: Badge | null;
  readonly particles: readonly Particle[];
  readonly waveStart: number;
  readonly waveUntil: number;
}

/** Hands sit behind the body — drawn before it, in world coordinates. */
export function drawHandsBehind(
  x: CanvasRenderingContext2D,
  R: number,
  rx: number,
  ry: number,
  cx: number,
  cy: number,
  bot: Pick<
    BotRenderState,
    "hands" | "isMini" | "sx" | "sy" | "waveStart" | "waveUntil" | "tilt" | "bodyColor"
  >,
  nowSec = performance.now() / 1000,
): void {
  if (bot.hands <= 0.01 || bot.isMini) return;
  if (R <= 14) return; // meaningless at compact/peek sizes

  const n = nowSec;
  const bodyH = 2 * ry;
  const hew = 0.3 * ry * bot.hands;
  const heh = 0.26 * ry * bot.hands;
  const hwB = rx * bot.sx;
  const hhB = ry * bot.sy;
  const isWaving = n >= bot.waveStart && bot.waveStart > 0 && n < bot.waveUntil;

  for (const sd of [-1, 1]) {
    let localX: number;
    let localY: number;
    let handRot = 0;

    if (sd > 0 && isWaving) {
      const wt = n - bot.waveStart;
      const rise = Math.min(1, wt / 0.18);
      const riseEased = 1 - Math.pow(1 - rise, 3);
      const restX = hwB * 1.08;
      const restY = hhB * 0.7;
      const oscX = Math.cos(13 * wt) * 0.06 * bodyH;
      const oscY = -Math.sin(13 * wt) * 0.14 * bodyH;
      const waveX = hwB * 1.1 + oscX;
      const waveY = -hhB * 0.15 + oscY;
      localX = restX + (waveX - restX) * riseEased;
      localY = restY + (waveY - restY) * riseEased;
      handRot = (-0.5 + Math.sin(13 * wt) * 0.35) * riseEased;
    } else if (sd < 0 && isWaving) {
      const wt = n - bot.waveStart;
      localX = -hwB * 1.08;
      localY = hhB * 0.7 + Math.sin(6 * wt) * 0.04 * bodyH;
    } else {
      localX = sd * hwB * 1.08;
      localY = hhB * 0.7;
    }

    const cosT = Math.cos(bot.tilt);
    const sinT = Math.sin(bot.tilt);
    const worldX = cx + cosT * localX - sinT * localY;
    const worldY = cy + sinT * localX + cosT * localY;

    x.save();
    x.translate(worldX, worldY);
    if (handRot !== 0) x.rotate(handRot);
    const g = x.createLinearGradient(hew * 0.7, -heh * 0.85, -hew * 0.8, heh * 0.9);
    if (bot.bodyColor) {
      g.addColorStop(0, rgba(mix3(bot.bodyColor, [1, 1, 1], 0.35)));
      g.addColorStop(1, rgba(bot.bodyColor));
    } else {
      g.addColorStop(0, rgba(BASE_TOP));
      g.addColorStop(1, rgba(BASE_BOTTOM));
    }
    x.beginPath();
    x.ellipse(0, 0, hew, heh, 0, 0, Math.PI * 2);
    x.fillStyle = g;
    x.fill();
    x.strokeStyle = "rgba(0,0,0,0.08)";
    x.lineWidth = 1;
    x.stroke();
    x.restore();
  }
}

export function drawBody(
  x: CanvasRenderingContext2D,
  body: Path2D,
  R: number,
  rx: number,
  ry: number,
  bot: Pick<BotRenderState, "bodyColor" | "tint" | "morph" | "col">,
): void {
  if (bot.bodyColor) {
    // Mini bots: flat solid fill — no gradient, no reflection, no highlight
    x.fillStyle = rgba(bot.bodyColor, 1);
    x.fill(body);
    return;
  }
  const g = x.createLinearGradient(rx * 0.7, -ry * 0.85, -rx * 0.8, ry * 0.9);
  g.addColorStop(0, rgba(BASE_TOP));
  g.addColorStop(1, rgba(BASE_BOTTOM));
  x.fillStyle = g;
  x.fill(body);

  const effectiveTint = bot.tint * (1 - bot.morph);
  if (effectiveTint > 0.01) {
    const tg = x.createLinearGradient(0, ry, 0, -ry);
    tg.addColorStop(0, rgba(bot.col, 0.72 * effectiveTint));
    tg.addColorStop(1, rgba(bot.col, 0));
    x.fillStyle = tg;
    x.fill(body);
  }

  const sh = x.createRadialGradient(0, 0, R * 0.15, 0, 0, R * 1.25);
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(0.6, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(0,0,0,0.2)");
  x.fillStyle = sh;
  x.fill(body);

  const hl = x.createRadialGradient(rx * 0.34, -ry * 0.46, 0, rx * 0.34, -ry * 0.46, R * 0.42);
  hl.addColorStop(0, "rgba(255,255,255,0.55)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = hl;
  x.fill(body);
}

export function drawEyeShape(
  x: CanvasRenderingContext2D,
  shape: EyeShape,
  w: number,
  h: number,
  sd: number,
  ink: string,
  open = 1,
  nowSec = performance.now() / 1000,
): void {
  const t = nowSec;
  switch (shape) {
    case "wide":
      drawEyeShape(x, "pill", w * 1.16, h * 1.12, sd, ink, open, t);
      break;
    case "pill": {
      const hh = Math.max(h * open, w * 0.3);
      roundRectPath(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2));
      x.fill();
      break;
    }
    case "dot":
      x.beginPath();
      x.arc(0, 0, w * 0.45, 0, Math.PI * 2);
      x.fill();
      break;
    case "line":
      x.rotate(-sd * 0.2);
      roundRectPath(x, -w * 0.78, -w * 0.21, w * 1.56, w * 0.42, w * 0.21);
      x.fill();
      break;
    case "flat":
      roundRectPath(x, -w * 0.72, -w * 0.2, w * 1.44, w * 0.4, w * 0.2);
      x.fill();
      break;
    case "happy":
      x.lineWidth = w * 0.5;
      x.lineCap = "round";
      x.beginPath();
      x.arc(0, h * 0.18, w * 0.82, Math.PI * 1.12, Math.PI * 1.88);
      x.stroke();
      break;
    case "closed":
      x.lineWidth = w * 0.36;
      x.lineCap = "round";
      x.beginPath();
      x.arc(0, -h * 0.08, w * 0.78, Math.PI * 0.15, Math.PI * 0.85);
      x.stroke();
      break;
    case "spiral": {
      x.lineWidth = w * 0.22;
      x.lineCap = "round";
      x.beginPath();
      for (let a = 0; a < 4.4 * Math.PI; a += 0.2) {
        const r = w * 0.06 + a * w * 0.058;
        const aa = a + t * 9 * sd;
        const px = Math.cos(aa) * r;
        const py = Math.sin(aa) * r;
        if (a === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.stroke();
      break;
    }
    case "heart":
      x.fillStyle = "#FF4D6D";
      heartPath(x, w * 1.2);
      x.fill();
      x.fillStyle = ink;
      break;
    case "star":
      x.fillStyle = "#F7B32B";
      x.rotate(t * 1.5 * sd);
      starPath(x, w * 1.05, w * 0.46);
      x.fill();
      x.fillStyle = ink;
      break;
    case "tired":
      roundRectPath(x, -w / 2, -h * 0.02, w, h * 0.38, w / 2);
      x.fill();
      roundRectPath(x, -w * 0.62, -h * 0.1, w * 1.24, w * 0.22, w * 0.11);
      x.fill();
      break;
    case "wink":
      if (sd < 0) {
        const hh = Math.max(h * open, w * 0.3);
        roundRectPath(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2));
        x.fill();
      } else {
        x.lineWidth = w * 0.5;
        x.lineCap = "round";
        x.beginPath();
        x.arc(0, h * 0.18, w * 0.82, Math.PI * 1.12, Math.PI * 1.88);
        x.stroke();
      }
      break;
    case "cup": {
      // Flat top, rounded bottom corners (U shape) — used while the box is open
      const hh = Math.max(h * open, w * 0.3);
      const cr = Math.min(w / 2, hh / 2);
      x.beginPath();
      x.moveTo(-w / 2, -hh / 2);
      x.lineTo(w / 2, -hh / 2);
      x.lineTo(w / 2, hh / 2 - cr);
      x.quadraticCurveTo(w / 2, hh / 2, w / 2 - cr, hh / 2);
      x.lineTo(-w / 2 + cr, hh / 2);
      x.quadraticCurveTo(-w / 2, hh / 2, -w / 2, hh / 2 - cr);
      x.closePath();
      x.fill();
      break;
    }
  }
}

export function drawEyes(
  x: CanvasRenderingContext2D,
  body: Path2D,
  R: number,
  rx: number,
  ry: number,
  bot: Pick<
    BotRenderState,
    | "eyeOverride"
    | "cfg"
    | "morph"
    | "isChewing"
    | "slotHTarget"
    | "slotH"
    | "isMini"
    | "yaw"
    | "pitch"
    | "roll"
    | "es"
    | "open"
  >,
  nowSec = performance.now() / 1000,
): void {
  let shape: EyeShape = bot.eyeOverride ?? bot.cfg.eye;
  if (bot.morph > 0.5) {
    if (bot.isChewing) shape = "happy";
    else if (bot.slotHTarget > 0.05 || bot.slotH > 0.1) shape = "cup";
  }

  x.save();
  x.clip(body);
  const ink = bot.isMini ? MINI_INK : INK;
  x.fillStyle = ink;
  x.strokeStyle = ink;

  for (const sd of [-1, 1]) {
    const eyeYaw = sd * EYE_SP + bot.yaw;
    let eyePitch = EYE_P + bot.pitch + bot.roll;
    eyePitch = (((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const cp = Math.cos(eyePitch);
    if (Math.cos(eyeYaw) * cp <= 0.04) continue;

    const ex = Math.sin(eyeYaw) * cp * rx;
    const ey = -Math.sin(eyePitch) * ry + (bot.morph > 0 ? ry * 0.14 * bot.morph : 0);
    const fx = lerp(Math.max(0.18, Math.cos(eyeYaw)), 1, bot.morph * 0.7);
    const fy = lerp(Math.max(0.18, cp), 1, bot.morph * 0.7);
    const eyeMult = bot.isMini ? 1.9 : 1.0;
    const ew = R * EYE_W * bot.es * eyeMult;
    const eh = R * EYE_H * bot.es * eyeMult;

    x.save();
    x.translate(ex, ey);
    x.scale(fx, fy);
    drawEyeShape(x, shape, ew, eh, sd, ink, bot.open, nowSec);
    x.restore();
  }
  x.restore();
}

/** Mailbox slot: dark pill cut into the box face, with rim and lip highlights. */
export function drawMouth(
  x: CanvasRenderingContext2D,
  body: Path2D,
  R: number,
  bot: Pick<BotRenderState, "morph" | "slotH">,
): void {
  const m = bot.morph;
  const hW = R * 1.8 * m;
  const hH = bot.slotH * R * m;
  const hX = -hW / 2;
  const boxTop = -R * (0.88 + 0.06 * m);
  const hY = boxTop + R * 0.08 * m;

  x.save();
  x.clip(body);

  x.strokeStyle = `rgba(255,255,255,${0.55 * m})`;
  x.lineWidth = 1;
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(-R * 0.9 * m, boxTop + 1);
  x.lineTo(R * 0.9 * m, boxTop + 1);
  x.stroke();

  if (hH > 0.8) {
    const hR = Math.min(hW / 2, hH / 2);
    const g = x.createLinearGradient(0, hY, 0, hY + hH);
    g.addColorStop(0, "rgb(7,8,10)");
    g.addColorStop(1, "rgb(16,19,26)");
    roundRectPath(x, hX, hY, hW, hH, hR);
    x.fillStyle = g;
    x.fill();
    if (hH > 4) {
      const lipR = Math.min(hR, (hW - 2) / 2);
      x.strokeStyle = `rgba(255,255,255,${0.28 * m})`;
      x.beginPath();
      x.moveTo(hX + lipR, hY + hH - 0.5);
      x.lineTo(hX + hW - lipR, hY + hH - 0.5);
      x.stroke();
    }
  }
  x.restore();
}

export function drawBadge(
  x: CanvasRenderingContext2D,
  badge: Badge,
  R: number,
  cx: number,
  cy: number,
  bot: Pick<BotRenderState, "badgeS" | "isMini" | "sx" | "sy">,
  nowSec = performance.now() / 1000,
): void {
  const bs = bot.badgeS * (bot.isMini ? 1.25 : 1);
  const bx = cx - R * 0.72 * bot.sx;
  const by = cy - R * 0.72 * bot.sy;
  const t = nowSec;

  x.save();
  x.translate(bx, by);
  x.scale(bs, bs);
  const col = rgba(badge.color);

  if (badge.kind === "dots") {
    if (bot.isMini) {
      const phase = (t * 2.4) % 1;
      const dotR = R * 0.22 * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, dotR, 0, Math.PI * 2);
      x.fill();
    } else {
      const pw = R * 0.72;
      const ph = R * 0.36;
      roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2);
      x.fillStyle = col;
      x.fill();
      for (let i = 0; i < 3; i++) {
        const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
        const dotR = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2)));
        x.fillStyle = "#fff";
        x.beginPath();
        x.arc((i - 1) * R * 0.18, 0, dotR, 0, Math.PI * 2);
        x.fill();
      }
    }
  } else if (badge.kind === "bang" || badge.kind === "question") {
    x.fillStyle = "#000";
    x.beginPath();
    x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = col;
    x.beginPath();
    x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
    x.fill();
    if (!bot.isMini) {
      x.fillStyle = "#fff";
      x.font = `900 ${R * 0.32}px ${FONT}`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(badge.kind === "bang" ? "!" : "?", 0, R * 0.02);
    }
  } else {
    x.fillStyle = "#000";
    x.beginPath();
    x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = col;
    x.beginPath();
    x.arc(0, 0, R * 0.135, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

export function drawParticles(
  x: CanvasRenderingContext2D,
  particles: readonly Particle[],
  R: number,
  cx: number,
  cy: number,
): void {
  for (const p of particles) {
    if (p.age <= 0) continue;
    const k = p.age / p.life;
    const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    const px = cx + (p.x + p.vx * p.age) * R * 1.3;
    const py = cy + (p.y + p.vy * p.age) * R * 1.3;
    const sz = R * p.size * (1 + k * 0.4);

    x.save();
    x.translate(px, py);
    x.globalAlpha = Math.min(1, Math.max(0, a));
    switch (p.type) {
      case "heart":
        x.rotate(Math.sin(p.age * 6) * 0.3);
        x.fillStyle = "#FF4D6D";
        heartPath(x, sz);
        x.fill();
        break;
      case "star":
        x.rotate(p.rot + p.age * 2);
        x.fillStyle = "#F7B32B";
        starPath(x, sz, sz * 0.45);
        x.fill();
        break;
      case "spark":
        x.rotate(p.rot);
        x.fillStyle = "#fff";
        starPath(x, sz * 0.8, sz * 0.18);
        x.fill();
        break;
      case "sweat":
        x.fillStyle = "#7CC7FF";
        x.beginPath();
        x.moveTo(0, -sz);
        x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6);
        x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz);
        x.fill();
        break;
      case "z":
        x.fillStyle = "rgb(209,219,235)";
        x.font = `700 ${sz * 1.9}px ${FONT}`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText("z", 0, 0);
        break;
    }
    x.restore();
  }
}

/**
 * Draws hands, body, blush, eyes, mouth, badge and particles into a canvas of
 * `W`×`H` CSS pixels (the caller has already applied the DPR transform).
 */
export function drawBot(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  bot: BotRenderState,
  nowSec = performance.now() / 1000,
): void {
  const R = W * 0.3;
  const rx = R * 1.14;
  const ry = R * 0.88;
  const cx = W / 2 + bot.ox * R;
  const cy = H / 2 + bot.particleOverhang / 2 + bot.oy * R + R * 0.06;

  drawHandsBehind(x, R, rx, ry, cx, cy, bot, nowSec);

  x.save();
  x.translate(cx, cy);
  if (bot.tilt !== 0) x.rotate(bot.tilt);
  x.scale(bot.sx, bot.sy);

  const body = bodyPath(rx, ry, R, bot.morph);
  drawBody(x, body, R, rx, ry, bot);

  const blushVal = Math.max(bot.blush, bot.tint * 0.5) * (1 - bot.morph);
  if (blushVal > 0.01) {
    x.save();
    x.clip(body);
    const yOffset = Math.sin(bot.yaw) * rx * 0.8;
    x.fillStyle = `rgba(255,120,150,${0.5 * blushVal})`;
    for (const sd of [-1, 1]) {
      x.beginPath();
      x.ellipse(sd * rx * 0.55 + yOffset, ry * 0.2, R * 0.17, R * 0.1, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  drawEyes(x, body, R, rx, ry, bot, nowSec);
  if (bot.morph > 0.05) drawMouth(x, body, R, bot);

  x.restore();

  if (bot.badge && bot.badgeS > 0.01 && bot.morph < 0.25) {
    drawBadge(x, bot.badge, R, cx, cy, bot, nowSec);
  }
  drawParticles(x, bot.particles, R, cx, cy);
}
