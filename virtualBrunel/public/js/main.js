import { createAnimator } from './animator.js';
import { createConsole } from './console.js';
import { createEmgPanel } from './emg/panel.js';
import { createHandModel } from './hand-model.js';
import { createHud } from './hud.js';
import { createLog } from './log.js';
import { createScene } from './scene.js';

const $ = (id) => document.getElementById(id);

// EMG mode drives the hand from the simulated band; API mode swaps in the request builder.
function onMode(mode) {
  $('emg').hidden = mode !== 'emg';
  $('console').hidden = mode !== 'api';
  emg.setEnabled(mode === 'emg');
}

const hud = createHud($('hud'), $('joints'), { onMode });
const log = createLog($('log'));
const emg = createEmgPanel($('emg'));
createConsole($('console'));
hud.setMode('emg');

const model = createHandModel();
const animator = createAnimator();
let ready = false;

createScene($('scene'), (dt) => {
  if (!ready) return;
  const pose = animator.step(dt);
  model.setPose(pose);
  hud.setPose(pose);
}).add(model.group);

// Hand state and the request log arrive over server-sent events; the page never polls.
const events = new EventSource('ui/events');
events.onopen = () => hud.setConnected(true);
events.onerror = () => hud.setConnected(false);
events.addEventListener('history', (event) => log.load(JSON.parse(event.data)));
events.addEventListener('request', (event) => log.add(JSON.parse(event.data)));
events.addEventListener('state', (event) => {
  const state = JSON.parse(event.data);
  animator.sync(state.joints);
  hud.update(state);
  model.setAlert(Boolean(state.estop));
  emg.setHalted(Boolean(state.estop) || state.offline);
  ready = true;
});
