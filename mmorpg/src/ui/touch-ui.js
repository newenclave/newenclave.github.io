import { t } from '../core/i18n.js';
import { STICK_MAX, buttonLayout } from '../core/touch.js';

const ROLL_COOLDOWN = 0.8;

export function drawTouchControls(ctx, touch, state, w, h) {
  const p = state.player;

  for (const ptr of touch.pointers.values()) {
    if (ptr.kind === 'button') continue;
    const d = Math.hypot(ptr.x - ptr.ox, ptr.y - ptr.oy) || 1;
    const k = Math.min(1, STICK_MAX / d);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(ptr.ox, ptr.oy, STICK_MAX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ptr.kind === 'aim' ? 'rgba(255,120,100,0.5)' : 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(ptr.ox + (ptr.x - ptr.ox) * k, ptr.oy + (ptr.y - ptr.oy) * k, 24, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  for (const b of buttonLayout(w, h)) {
    ctx.font = b.r > 25 ? 'bold 13px sans-serif' : 'bold 10px sans-serif';
    if ((b.id === 'talk' && !touch.talkVisible) || (b.id === 'boat' && !touch.boatVisible)) continue;
    ctx.fillStyle = b.id === 'talk' ? 'rgba(60,110,60,0.7)' : b.id === 'boat' ? 'rgba(40,90,150,0.75)' : 'rgba(0,0,0,0.45)';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (b.id === 'roll' && p.rollCooldown > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p.rollCooldown / ROLL_COOLDOWN));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(t('touch.' + b.id), b.x, b.y + 5);
    const badge = b.id === 'skills' ? p.skillPoints : b.id === 'hero' ? p.attrPoints : 0; // points to spend
    if (badge > 0) {
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.arc(b.x + b.r * 0.7, b.y - b.r * 0.7, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillText(String(badge), b.x + b.r * 0.7, b.y - b.r * 0.7 + 4);
    }
  }

  if (h > w) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, h / 2 - 20, w, 40);
    ctx.fillStyle = '#ffd54f';
    ctx.font = '14px sans-serif';
    ctx.fillText(t('touch.rotate'), w / 2, h / 2 + 5);
  }
  ctx.textAlign = 'left';
}
