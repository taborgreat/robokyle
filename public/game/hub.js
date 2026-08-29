/* ==================================================================
   RoboKyle Arcade hub, pointer lighting.

   Two effects, both driven by CSS custom properties so the stylesheet
   owns every appearance decision and this file only reports where the
   pointer is:

     --mx / --my   on .stage, for the room light
     --rx / --ry   on a card, for the tilt
     --px / --py   on a card, for the specular sheen

   Everything degrades cleanly. With this script blocked the light sits
   in the middle of the room, cards do not tilt, and the page is exactly
   the CSS defaults.
   ================================================================== */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A coarse pointer has no hover to track, and tilting on tap feels broken.
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduced || !fine) return;

  var stage = document.querySelector('.stage');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.game-card'));

  /* ===== room light ===== */

  if (stage) {
    var px = 0, py = 0, queued = false;

    window.addEventListener('pointermove', function (e) {
      px = e.clientX;
      py = e.clientY;
      // Coalesce to one write per frame; pointermove fires far faster.
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        stage.style.setProperty('--mx', (px / window.innerWidth * 100).toFixed(2) + '%');
        stage.style.setProperty('--my', (py / window.innerHeight * 100).toFixed(2) + '%');
      });
    }, { passive: true });
  }

  /* ===== cabinet tilt ===== */

  var MAX = 5;   // degrees; past this it stops reading as a solid object

  cards.forEach(function (card) {
    var frame = null;

    function track(e) {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        var r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;

        var x = (e.clientX - r.left) / r.width;    // 0 at the left edge
        var y = (e.clientY - r.top) / r.height;    // 0 at the top edge

        // Tilt away from the pointer, so the near corner lifts toward it.
        card.style.setProperty('--ry', ((x - 0.5) * 2 * MAX).toFixed(2) + 'deg');
        card.style.setProperty('--rx', ((0.5 - y) * 2 * MAX).toFixed(2) + 'deg');
        card.style.setProperty('--px', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--py', (y * 100).toFixed(1) + '%');
      });
    }

    card.addEventListener('pointerenter', function () {
      card.classList.add('is-tilting');
    });

    card.addEventListener('pointermove', track, { passive: true });

    card.addEventListener('pointerleave', function () {
      if (frame) { cancelAnimationFrame(frame); frame = null; }
      // Drop the class first so the transition eases it back to flat.
      card.classList.remove('is-tilting');
      card.style.removeProperty('--rx');
      card.style.removeProperty('--ry');
    });
  });
})();
