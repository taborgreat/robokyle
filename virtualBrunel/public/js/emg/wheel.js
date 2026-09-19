import { DEAD_ZONE_DEG } from './controller.js';

export const RANGE_DEG = 45; // roll / pitch at the wheel's rim
const LABEL_DEG = 30;
const SIZE = 200;

const COLORS = { ring: '#3a4150', text: '#9aa4b5', active: '#ff7a1a', shown: '#ffd2ad', pointer: '#e8ecf3' };

// Draws the grip wheel, with the arm's orientation as a pointer. The wheel is always
// drawn centred; the pointer is placed relative to the orientation it was opened at.
export function createWheel(canvas, grips) {
  const scale = Math.min(devicePixelRatio, 2);
  canvas.width = canvas.height = SIZE * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const px = SIZE / 2 / RANGE_DEG; // pixels per degree
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // wheel: the controller's view of the open wheel, or null when it is closed.
  return function draw(wheel, orientation) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const sector = (2 * Math.PI) / grips.length;
    ctx.globalAlpha = wheel ? 1 : 0.35;

    ctx.strokeStyle = COLORS.ring;
    ctx.beginPath();
    ctx.arc(cx, cy, DEAD_ZONE_DEG * px, 0, 2 * Math.PI);
    ctx.stroke();

    grips.forEach(({ label }, i) => {
      // Sector i is centred on i * sector, measured clockwise from straight up.
      const edge = (i + 0.5) * sector - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(edge) * DEAD_ZONE_DEG * px, cy + Math.sin(edge) * DEAD_ZONE_DEG * px);
      ctx.lineTo(cx + Math.cos(edge) * SIZE, cy + Math.sin(edge) * SIZE);
      ctx.stroke();

      const mid = i * sector - Math.PI / 2;
      ctx.fillStyle = i === wheel?.sector ? COLORS.active : i === wheel?.shown ? COLORS.shown : COLORS.text;
      ctx.font = `${i === wheel?.sector ? 'bold ' : ''}12px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx + Math.cos(mid) * LABEL_DEG * px, cy + Math.sin(mid) * LABEL_DEG * px);
    });

    ctx.globalAlpha = 1;
    const center = wheel?.center ?? { roll: 0, pitch: 0 };
    const x = cx + (orientation.roll - center.roll) * px;
    const y = cy - (orientation.pitch - center.pitch) * px;
    ctx.fillStyle = wheel ? COLORS.active : COLORS.pointer;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
  };
}
