/* ------------------------------------------------------------------
   Fullscreen, shared by both RoboKyle games.

   Monitors vary enough that a fixed frame is wrong on most of them: on
   a wide screen the game sat in the middle with half the desktop empty,
   and on a short one the bottom of it was below the fold. The CSS sizes
   the frame to whatever room there is; this puts a button on it.

   The button lives inside the frame, so it comes along into fullscreen
   with everything else.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  const frame = document.querySelector('.game-frame');
  if (!frame) return;

  // Not every browser spells these the same way.
  const canGo = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  function request(el) {
    if (el.requestFullscreen) return el.requestFullscreen({ navigationUI: 'hide' });
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    return null;
  }
  function exit() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return null;
  }

  const ICON_IN =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
  const ICON_OUT =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>';

  const btn = document.createElement('button');
  btn.className = 'fs-btn';
  btn.type = 'button';
  frame.appendChild(btn);

  function paint() {
    const on = isFull();
    btn.innerHTML = (on ? ICON_OUT : ICON_IN) +
      '<span>' + (on ? 'Exit' : 'Fullscreen') + '</span>';
    btn.setAttribute('aria-label', on ? 'Leave fullscreen' : 'Play fullscreen');
    btn.title = on ? 'Leave fullscreen (Esc)' : 'Play fullscreen';
    frame.classList.toggle('is-fullscreen', on);
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (isFull()) exit();
    else if (canGo) request(frame);
    else {
      // No fullscreen API: fall back to filling the browser window, which
      // is most of the benefit anyway.
      frame.classList.toggle('is-maxed');
      paintFallback();
      nudge();
    }
  });

  function paintFallback() {
    const on = frame.classList.contains('is-maxed');
    btn.innerHTML = (on ? ICON_OUT : ICON_IN) +
      '<span>' + (on ? 'Exit' : 'Fullscreen') + '</span>';
  }

  // The frame changes size without the window doing so, and the games
  // size their canvas off a resize event, so say one happened.
  function nudge() {
    window.dispatchEvent(new Event('resize'));
    // twice: once now, once after the browser has finished the transition
    setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
  }

  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => {
    document.addEventListener(ev, () => { paint(); nudge(); });
  });

  paint();
})();
