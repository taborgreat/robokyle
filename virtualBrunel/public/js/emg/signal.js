// Stand-in for the band's two EMG channels. Holding a channel ramps its effort (0–1)
// up to the configured strength the way a rectified, smoothed EMG envelope rises;
// releasing lets it decay to a noisy resting floor.
const RISE_MS = 70;
const REST_NOISE = 0.04;

export function createSignal(settings) {
  const held = { flex: false, ext: false };
  const effort = { flex: 0, ext: 0 };

  return {
    effort,

    hold(channel, down) {
      held[channel] = down;
    },

    update(dt) {
      const blend = 1 - Math.exp(-dt / RISE_MS);
      for (const channel of ['flex', 'ext']) {
        const level = held[channel] ? settings[`${channel}Strength`] : Math.random() * REST_NOISE;
        effort[channel] += (level - effort[channel]) * blend;
      }
    },
  };
}
