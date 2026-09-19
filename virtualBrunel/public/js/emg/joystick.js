import { RANGE_DEG } from './wheel.js';

const PX_PER_DEG = 2; // pointer travel standing in for one degree of arm rotation

// Stand-in for the band's IMU while the grip wheel is held open: where the pointer was
// when the co-contraction started is the wheel's centre, and travel from there is the
// arm's roll (x) and pitch (y). Works the same for a mouse and for a finger dragged off
// the hold button. Released, the arm is back at neutral.
export function createJoystick() {
  const pointer = { x: 0, y: 0 };
  let origin = null;

  // Capture phase, so the position is current before any button handler grabs it.
  const track = (event) => Object.assign(pointer, { x: event.clientX, y: event.clientY });
  addEventListener('pointermove', track, true);
  addEventListener('pointerdown', track, true);

  const degrees = (px) => Math.max(-RANGE_DEG, Math.min(RANGE_DEG, px / PX_PER_DEG));

  return {
    grab() {
      origin = { ...pointer };
    },
    release() {
      origin = null;
    },
    get orientation() {
      if (!origin) return { roll: 0, pitch: 0 };
      return { roll: degrees(pointer.x - origin.x), pitch: degrees(origin.y - pointer.y) };
    },
  };
}
