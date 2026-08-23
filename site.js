/* ============================================================
   Robo Kyle — shared site script
   1. Device detection  -> html classes other CSS/JS can key off
   2. Mobile nav        -> hamburger toggle, focus + escape handling
   3. Footer year
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------- 1. Device detection ----------
     We classify on *capability*, not on brittle UA sniffing alone:
       - coarse pointer / no hover  -> touch device
       - viewport width             -> phone vs tablet vs desktop
     UA is only a tiebreaker for iPadOS, which reports a desktop UA.  */
  var MOBILE_MAX = 860;   // matches the nav + layout breakpoint in index.css
  var TABLET_MAX = 1024;

  function mq(q) { return !!(window.matchMedia && matchMedia(q).matches); }

  function touchCapable() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  }

  /* A coarse primary pointer is the strong signal. A touchscreen laptop
     reports a fine pointer too, and there we want the desktop treatment
     — so touch capability alone only counts when no fine pointer exists. */
  function isTouchFirst() {
    if (mq('(pointer: coarse)')) return true;
    if (mq('(pointer: fine)') || mq('(hover: hover)')) return false;
    return touchCapable();
  }

  function detect() {
    var w = window.innerWidth || root.clientWidth;
    var touch = isTouchFirst();
    var mobile = touch && w <= MOBILE_MAX;
    var tablet = touch && w > MOBILE_MAX && w <= TABLET_MAX;

    root.classList.toggle('is-touch',   !!touch);
    root.classList.toggle('no-touch',   !touch);
    root.classList.toggle('is-mobile',  !!mobile);
    root.classList.toggle('is-tablet',  !!tablet);
    root.classList.toggle('is-desktop', !mobile && !tablet);
    root.classList.toggle('is-portrait',  w <= (window.innerHeight || root.clientHeight));
    root.classList.toggle('is-landscape', w >  (window.innerHeight || root.clientHeight));

    // Expose for scripts that need it (the game reads this).
    window.RK = window.RK || {};
    window.RK.device = {
      touch: !!touch,
      mobile: !!mobile,
      tablet: !!tablet,
      desktop: !mobile && !tablet,
      width: w
    };
  }

  root.classList.add('js');
  detect();

  var resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      detect();
      document.dispatchEvent(new CustomEvent('rk:devicechange', { detail: window.RK.device }));
    }, 120);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* Real viewport height unit for mobile browsers whose URL bar
     makes 100vh taller than the visible area. */
  function setVH() {
    root.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
  }
  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', function () { setTimeout(setVH, 200); });

  /* ---------- 2. Mobile nav ---------- */
  function initNav() {
    var toggle = document.getElementById('navToggle');
    var menu = document.getElementById('site-menu');
    if (!toggle || !menu) return;

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.classList.toggle('is-open', open);
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    // Close after picking a destination (matters for same-page #anchors).
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    // Tapping outside the header closes it.
    document.addEventListener('click', function (e) {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (!e.target.closest('.site-nav')) setOpen(false);
    });

    // Never leave the panel stuck open when we grow back to desktop.
    window.addEventListener('resize', function () {
      if (window.innerWidth > MOBILE_MAX) setOpen(false);
    });
  }

  /* ---------- 3. Footer year ---------- */
  function initYear() {
    var el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initNav(); initYear(); });
  } else {
    initNav();
    initYear();
  }
})();
