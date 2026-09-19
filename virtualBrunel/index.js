import { createApi } from './src/api.js';
import { Hand } from './src/hand.js';
import { createStore } from './src/store.js';
import { createUi } from './src/ui.js';

// Builds a virtual hand and returns a single (req, res) handler: the viewer lives at /
// and /ui/*, the Brunel Hand API owns every other path. `storePath` is the JSON file
// standing in for EEPROM (custom gestures); omit it to keep them in memory.
export function createBrunelHand({ storePath } = {}) {
  const hand = new Hand({ store: createStore(storePath) });
  const ui = createUi(hand);
  const api = createApi(hand, { onRequest: ui.logRequest });

  return {
    hand,
    handle: (req, res) => ui.handle(req, res) || api(req, res),
  };
}

export { createApi, createStore, createUi, Hand };
