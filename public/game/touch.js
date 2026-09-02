/* ==================================================================
   Touch controls, shared by the games that need them.

   Undead Nightmare already had a good pair of thumb sticks; this is
   that idea pulled out so Fly Game and Grand Heist get the same thing
   rather than each inventing a worse one. It builds the pads, tracks
   the thumbs, and hands back a plain object of numbers. It knows
   nothing about any game.

   Two rules it exists to enforce, both learned from bad phone ports:

   The pads are small and in the corners. A stick that fills a third of
   the screen is a stick you cannot see the game through, and the thumb
   never travels more than about fifty pixels anyway, so the base only
   has to be big enough to find without looking.

   Nothing is invisible. Drag-anywhere controls test well with the
   person who wrote them and nobody else, because there is no way to
   discover them and no way to tell whether you are holding them. Every
   control here is drawn, labelled, and lights up while it is held.
   ================================================================== */

(function () {
  'use strict';

  const coarse = () =>
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  function el(tag, cls, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  /* One stick. Reports a vector in the unit circle, y down like the
     screen, with a dead zone so resting a thumb is not an input. */
  function makeStick(root, knob, dead, onMove, onEnd) {
    let id = null, ox = 0, oy = 0;
    const reach = root.offsetWidth ? root.offsetWidth * 0.42 : 48;

    const place = (cx, cy) => {
      let dx = cx - ox, dy = cy - oy;
      const m = Math.hypot(dx, dy);
      const lim = reach;
      if (m > lim) { dx = dx / m * lim; dy = dy / m * lim; }
      knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      let nx = dx / lim, ny = dy / lim;
      const n = Math.hypot(nx, ny);
      if (n < dead) { nx = 0; ny = 0; }
      else {
        // Rescale past the dead zone, so the first useful position is a
        // small input rather than a jump to a quarter deflection.
        const k = (n - dead) / (1 - dead) / n;
        nx *= k; ny *= k;
      }
      onMove(nx, ny);
    };

    const grab = (pid, cx, cy) => {
      id = pid;
      const r = root.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
      root.classList.add('is-on');
      place(cx, cy);
    };

    const release = () => {
      if (id === null) return;
      id = null;
      knob.style.transform = '';
      root.classList.remove('is-on');
      onEnd();
    };

    if (window.PointerEvent) {
      root.addEventListener('pointerdown', e => {
        if (id !== null) return;
        // Capture keeps the thumb bound to this pad once it slides off
        // it, which it always does. Not every engine has it; a failure
        // here must not take the rest of the handler with it.
        try { root.setPointerCapture(e.pointerId); } catch (err) {}
        grab(e.pointerId, e.clientX, e.clientY);
        e.preventDefault();
      });
      root.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        place(e.clientX, e.clientY);
        e.preventDefault();
      });
      const end = e => { if (e.pointerId === id) { release(); e.preventDefault(); } };
      root.addEventListener('pointerup', end);
      root.addEventListener('pointercancel', end);
      root.addEventListener('lostpointercapture', e => { if (e.pointerId === id) release(); });
    } else {
      const find = list => {
        for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
        return null;
      };
      root.addEventListener('touchstart', e => {
        if (id !== null) return;
        const t = e.changedTouches[0];
        grab(t.identifier, t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      // On the document, because without capture the events stop
      // targeting the pad the moment the thumb leaves it.
      document.addEventListener('touchmove', e => {
        const t = find(e.touches);
        if (!t) return;
        place(t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      const endT = e => { if (find(e.changedTouches)) release(); };
      document.addEventListener('touchend', endT);
      document.addEventListener('touchcancel', endT);
    }

    return { release };
  }

  /* A button. Held state for things like a trigger, plus a press
     callback for things like reload. */
  function makeButton(node, state, key, onPress) {
    const down = e => {
      state[key] = true;
      node.classList.add('is-on');
      if (onPress) onPress();
      e.preventDefault();
    };
    const up = e => {
      state[key] = false;
      node.classList.remove('is-on');
      if (e) e.preventDefault();
    };
    if (window.PointerEvent) {
      node.addEventListener('pointerdown', e => {
        try { node.setPointerCapture(e.pointerId); } catch (err) {}
        down(e);
      });
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
      node.addEventListener('lostpointercapture', () => up());
    } else {
      node.addEventListener('touchstart', down, { passive: false });
      node.addEventListener('touchend', up, { passive: false });
      node.addEventListener('touchcancel', up, { passive: false });
    }
  }

  /* spec: {
       theme:   a class put on the layer, so each game can colour it
       sticks:  [{ id, side: 'left'|'right', label, dead }]
       buttons: [{ id, label, side, big, onPress }]
     }
     Returns { el, sticks: {id:{x,y}}, buttons: {id:bool}, show(v), isTouch } */
  function createTouchLayer(host, spec) {
    const layer = el('div', 'tl' + (spec.theme ? ' ' + spec.theme : ''));
    layer.setAttribute('aria-hidden', 'true');
    const sticks = {}, buttons = {};

    for (const s of spec.sticks || []) {
      const root = el('div', 'tl-stick tl-' + s.side, layer);
      const base = el('div', 'tl-base', root);
      el('span', 'tl-label', base).textContent = s.label || '';
      const knob = el('div', 'tl-knob', root);
      const v = { x: 0, y: 0 };
      sticks[s.id] = v;
      makeStick(root, knob, s.dead == null ? 0.16 : s.dead,
        (nx, ny) => { v.x = nx; v.y = ny; },
        () => { v.x = 0; v.y = 0; });
    }

    // Buttons stack in a column on their side, above the stick.
    const stacks = {};
    for (const b of spec.buttons || []) {
      if (!stacks[b.side]) stacks[b.side] = el('div', 'tl-stack tl-stack-' + b.side, layer);
      const node = el('button', 'tl-btn' + (b.big ? ' is-big' : ''), stacks[b.side]);
      node.type = 'button';
      node.textContent = b.label;
      buttons[b.id] = false;
      makeButton(node, buttons, b.id, b.onPress);
    }

    host.appendChild(layer);

    const api = {
      el: layer,
      sticks,
      buttons,
      isTouch: coarse(),
      show(v) { layer.classList.toggle('is-live', !!v && api.isTouch); },
    };
    return api;
  }

  window.createTouchLayer = createTouchLayer;
  window.isCoarsePointer = coarse;
})();
