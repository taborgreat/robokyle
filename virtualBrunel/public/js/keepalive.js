import { api } from './api-client.js';

// Well inside the hand's 2000 ms watchdog, even when a background tab throttles timers to 1 s.
const INTERVAL_MS = 500;

export function createKeepalive() {
  let timer = null;
  const beat = () => api('POST', '/safety/keepalive');

  return {
    get on() {
      return timer !== null;
    },
    set(on) {
      if (on === this.on) return;
      clearInterval(timer);
      timer = on ? setInterval(beat, INTERVAL_MS) : null;
      if (on) beat();
    },
  };
}
