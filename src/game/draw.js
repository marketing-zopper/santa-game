// Canvas drawing helpers — ported unchanged from the original index.html.
import { PH, PH_GOLD, SHIELD, SPR, ok } from './sprites.js';

export function drawPhone(c, kind, gold, t) {
  const w = 30, h = 54;
  if (gold) {
    const gl = c.createRadialGradient(0, 0, 4, 0, 0, 46); gl.addColorStop(0, 'rgba(255,200,60,.6)'); gl.addColorStop(1, 'rgba(255,200,60,0)');
    c.fillStyle = gl; c.beginPath(); c.arc(0, 0, 46, 0, 7); c.fill();
  }
  const im = gold ? PH_GOLD : PH[kind % 2];
  if (ok(im)) c.drawImage(im, -w / 2, -h / 2, w, h);
  else { rr(c, -w / 2, -h / 2, w, h, 7); c.fillStyle = gold ? '#FDB740' : '#1EB1E7'; c.fill(); }
  if (gold) { // sparkle
    const s = 5 + Math.sin(t * 9) * 2; c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(10, -24 - s); c.lineTo(12, -24); c.lineTo(10, -24 + s); c.lineTo(8, -24); c.fill();
    c.beginPath(); c.moveTo(10 - s, -24); c.lineTo(10, -22); c.lineTo(10 + s, -24); c.lineTo(10, -26); c.fill();
  }
}

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

export function drawCoal(c) {
  c.lineWidth = 3; c.strokeStyle = '#151627';
  c.beginPath(); const pts = [[-16, -4], [-10, -14], [2, -16], [14, -9], [17, 3], [9, 14], [-5, 15], [-15, 8]];
  pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
  const g = c.createRadialGradient(-4, -6, 2, 0, 0, 20); g.addColorStop(0, '#4A4B62'); g.addColorStop(1, '#1E1F30');
  c.fillStyle = g; c.fill(); c.stroke();
  c.fillStyle = '#E8414E'; c.beginPath(); c.arc(6, 6, 3, 0, 7); c.arc(-7, 4, 2.2, 0, 7); c.arc(1, -6, 1.8, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,255,255,.28)'; c.beginPath(); c.arc(-7, -8, 3, 0, 7); c.fill();
}

export function drawShield(c, t) {
  const gl = c.createRadialGradient(0, 0, 6, 0, 0, 48); gl.addColorStop(0, 'rgba(30,177,231,.6)'); gl.addColorStop(1, 'rgba(30,177,231,0)');
  c.fillStyle = gl; c.beginPath(); c.arc(0, 0, 48, 0, 7); c.fill();
  const k = 1 + Math.sin(t * 6) * 0.05, w = 42 * k, h = 50 * k;
  if (ok(SHIELD)) c.drawImage(SHIELD, -w / 2, -h / 2, w, h);
}

export function drawSleigh(c, bounce, t, gallop) {
  const s = SPR.s, hop = -Math.abs(Math.sin(t * 9)) * 2 * gallop;
  const squash = 1 - Math.min(0.06, bounce * 0.01);           // little squash when a phone lands in the sack
  c.save(); c.translate(0, 698); c.scale(1 / squash > 1 ? 1 + (1 - squash) * 0.5 : 1, squash); c.translate(0, hop - SPR.bottom * s);
  if (SPR.img.complete && SPR.img.naturalWidth) c.drawImage(SPR.img, -SPR.anchor * s, 0, SPR.w * s, SPR.h * s);
  c.restore();
}
