/* ============================================================
   Robo Kyle shared site script
   1. Device detection  -> html classes other CSS/JS can key off
   2. Mobile nav        -> hamburger toggle, focus + escape handling
   3. Footer year
   4. Auth nav          -> swaps "Log in" for the signed-in user's menu
   5. Latest works      -> home page grid, fetched from the API
   ============================================================ */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- 1. Device detection ----------
     We classify on *capability*, not on brittle UA sniffing alone:
       - coarse pointer / no hover  -> touch device
       - viewport width             -> phone vs tablet vs desktop
     UA is only a tiebreaker for iPadOS, which reports a desktop UA.  */
  var MOBILE_MAX = 860; // matches the nav + layout breakpoint in index.css
  var TABLET_MAX = 1024;

  function mq(q) {
    return !!(window.matchMedia && matchMedia(q).matches);
  }

  function touchCapable() {
    return "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
  }

  /* A coarse primary pointer is the strong signal. A touchscreen laptop
     reports a fine pointer too, and there we want the desktop treatment
     so touch capability alone only counts when no fine pointer exists. */
  function isTouchFirst() {
    if (mq("(pointer: coarse)")) return true;
    if (mq("(pointer: fine)") || mq("(hover: hover)")) return false;
    return touchCapable();
  }

  function detect() {
    var w = window.innerWidth || root.clientWidth;
    var touch = isTouchFirst();
    var mobile = touch && w <= MOBILE_MAX;
    var tablet = touch && w > MOBILE_MAX && w <= TABLET_MAX;

    root.classList.toggle("is-touch", !!touch);
    root.classList.toggle("no-touch", !touch);
    root.classList.toggle("is-mobile", !!mobile);
    root.classList.toggle("is-tablet", !!tablet);
    root.classList.toggle("is-desktop", !mobile && !tablet);
    root.classList.toggle(
      "is-portrait",
      w <= (window.innerHeight || root.clientHeight),
    );
    root.classList.toggle(
      "is-landscape",
      w > (window.innerHeight || root.clientHeight),
    );

    // Expose for scripts that need it (the game reads this).
    window.RK = window.RK || {};
    window.RK.device = {
      touch: !!touch,
      mobile: !!mobile,
      tablet: !!tablet,
      desktop: !mobile && !tablet,
      width: w,
    };
  }

  root.classList.add("js");
  detect();

  var resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      detect();
      document.dispatchEvent(
        new CustomEvent("rk:devicechange", { detail: window.RK.device }),
      );
    }, 120);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  /* Real viewport height unit for mobile browsers whose URL bar
     makes 100vh taller than the visible area. */
  function setVH() {
    root.style.setProperty("--vh", window.innerHeight * 0.01 + "px");
  }
  setVH();
  window.addEventListener("resize", setVH);
  window.addEventListener("orientationchange", function () {
    setTimeout(setVH, 200);
  });

  /* ---------- 2. Mobile nav ---------- */
  function initNav() {
    var toggle = document.getElementById("navToggle");
    var menu = document.getElementById("site-menu");
    if (!toggle || !menu) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.classList.toggle("is-open", open);
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Close after picking a destination (matters for same-page #anchors).
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        toggle.getAttribute("aria-expanded") === "true"
      ) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Tapping outside the header closes it.
    document.addEventListener("click", function (e) {
      if (toggle.getAttribute("aria-expanded") !== "true") return;
      if (!e.target.closest(".site-nav")) setOpen(false);
    });

    // Never leave the panel stuck open when we grow back to desktop.
    window.addEventListener("resize", function () {
      if (window.innerWidth > MOBILE_MAX) setOpen(false);
    });
  }

  /* ---------- 5. Latest works on the home page ----------
     The home page is a flat file, so it asks the API directly for the newest
     works and renders the same cards the React list uses. If the API is
     unreachable the section degrades to a plain link rather than an error. */

  var PLACEHOLDER_THUMB =
    '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M32 6l22 12v18L32 44 10 36V18z"/><path d="M32 22l22-4M32 22L10 18M32 22v22"/></svg>';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* One work as one inventory slot: square image (or the placeholder mark),
     Produced count as the gold stack number, examine text on the title. */
  function workSlot(work) {
    var slot = el("a", "ts-slot");
    slot.href = "/works/" + work.id;
    var examine = work.title;
    if (work.description) examine += ". " + work.description.slice(0, 120);
    slot.title = examine;
    slot.setAttribute("aria-label", work.title);

    if (work.thumbUrl) {
      var img = el("img");
      img.src = apiBase() + work.thumbUrl;
      img.alt = "";
      img.loading = "lazy";
      slot.appendChild(img);
    } else {
      var ph = el("span");
      ph.setAttribute("aria-hidden", "true");
      ph.innerHTML = PLACEHOLDER_THUMB;
      slot.appendChild(ph);
    }
    if (work.producedCount > 0)
      slot.appendChild(el("span", "rs-num ts-stack", String(work.producedCount)));
    return slot;
  }

  var HOME_SLOTS = 8;

  function initHomeWorks() {
    var grid = document.getElementById("homeWorks");
    if (!grid || !window.fetch) return;
    var note = document.getElementById("homeWorksNote");

    apiGet("/api/designs?sort=new&limit=" + HOME_SLOTS)
      .then(function (data) {
        var items = (data && data.items) || [];
        var slots = items.map(workSlot);
        /* Empty slots stay visible as open wells: room to grow, not failure. */
        while (slots.length < HOME_SLOTS) {
          var empty = el("span", "ts-slot ts-empty");
          empty.setAttribute("aria-hidden", "true");
          slots.push(empty);
        }
        grid.replaceChildren.apply(grid, slots);
        if (!items.length)
          grid.appendChild(el("p", "stat", "Nothing posted yet. Yours can be the first."));
      })
      .catch(function () {
        if (note) note.textContent = "Could not load the latest works right now.";
      });
  }

  /* ---------- 5b. Title screen: live counters + activity ticker ----------
     Every number is real and every line is a ledger line; the strip simply
     stays hidden if the API is unreachable. */
  function initTitleScreen() {
    var counters = document.getElementById("tsCounters");
    if (!counters || !window.fetch) return;

    apiGet("/api/stats")
      .then(function (s) {
        counters.replaceChildren();
        [
          ["works", s.works, "/works"],
          ["produced", s.produced, null],
          ["creators", s.creators, "/creators"],
          ["open plans", s.openPlans, "/talk"],
        ].forEach(function (row) {
          var span = el(row[2] ? "a" : "span", "ts-counter");
          if (row[2]) span.href = row[2];
          span.appendChild(document.createTextNode(row[0] + " "));
          span.appendChild(el("span", "rs-num", Number(row[1] || 0).toLocaleString()));
          counters.appendChild(span);
        });
        counters.hidden = false;

        var act = document.getElementById("tsActivity");
        var ticker = document.getElementById("tsTicker");
        if (!act || !ticker || !s.activity || !s.activity.length) return;
        ticker.replaceChildren();
        s.activity.forEach(function (ev) {
          var li = el("li");
          li.appendChild(el("span", "rs-num", "+" + ev.amount));
          var text = el("span");
          /* Names wear their standing: total level decides the shade, from
             newcomer grey up to gold. The homepage is a highscores preview. */
          var lvl = Number(ev.level || 0);
          var tier = lvl >= 450 ? "lvl-gold" : lvl >= 150 ? "lvl-high" : lvl >= 20 ? "lvl-mid" : "lvl-new";
          var who = el("a", tier, ev.who);
          who.href = "/user/" + encodeURIComponent(ev.who);
          who.title = "Total level " + lvl;
          text.appendChild(who);
          text.appendChild(document.createTextNode(" " + ev.what + " "));
          var w = el("a", null, ev.title);
          w.href = "/works/" + ev.workId;
          text.appendChild(w);
          li.appendChild(text);
          ticker.appendChild(li);
        });
        act.hidden = false;
      })
      .catch(function () {});
  }

  /* ---------- Current page marker ----------
     Comparing paths beats a hand-written aria-current on every page: nothing
     drifts when a link moves, and index.html and / count as the same place. */
  function samePath(a, b) {
    return a.replace(/\/index\.html$/, "/") === b.replace(/\/index\.html$/, "/");
  }

  function initCurrentPage() {
    var menu = document.getElementById("site-menu");
    if (!menu) return;
    var here = location.pathname;

    /* The home page has no nav item of its own, so the logo carries the marker. */
    var logo = document.querySelector(".site-nav .site-logo");
    if (logo) {
      var logoPath = new URL(logo.getAttribute("href"), location.href).pathname;
      if (samePath(logoPath, here)) logo.setAttribute("aria-current", "page");
      else logo.removeAttribute("aria-current");
    }

    var links = menu.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (/^(mailto:|tel:|https?:)/.test(href)) continue;
      var path;
      try { path = new URL(href, location.href).pathname; } catch (e) { continue; }
      if (samePath(path, here)) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }

  /* ---------- 3. Footer year ---------- */
  function initYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ---------- 4. Auth nav ----------
     The flat pages are static HTML with no bundler, so they can't share the
     React AuthProvider. They only need to answer one question, "is someone
     signed in?", which is a token in localStorage plus one /auth/me call.
     Keeps the nav consistent with Layout.jsx without shipping a bundle. */

  var TOKEN_KEY = "rk_token"; // must match frontend/src/lib/api.js
  var API_URL = "https://api.robokyle.org"; // production API origin; edit on deploy

  /* Local dev comes in more than one shape: the Vite dev server proxies /api on
     its own origin, Live Server and python http.server do not. Rather than sniff
     ports, try same-origin first and fall back to the API's own port. Whichever
     answers is remembered, so later calls go straight there. */
  var DEV_API_URL = "http://localhost:4000";
  var resolvedBase = null;

  function apiCandidates() {
    if (window.RK_API_URL != null)
      return [String(window.RK_API_URL).replace(/\/$/, "")];
    var h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "")
      return ["", DEV_API_URL];
    return [API_URL.replace(/\/$/, "")];
  }

  function apiBase() {
    return resolvedBase != null ? resolvedBase : apiCandidates()[0];
  }

  /* Walks the candidates in order and resolves with the first JSON response. */
  function apiGet(path) {
    var bases = resolvedBase != null ? [resolvedBase] : apiCandidates();
    return bases.reduce(function (chain, base) {
      return chain.catch(function () {
        return fetch(base + path)
          .then(function (res) {
            return res.ok ? res.json() : Promise.reject(res.status);
          })
          .then(function (data) {
            resolvedBase = base;
            return data;
          });
      });
    }, Promise.reject());
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }
  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function initAuthNav() {
    var menu = document.getElementById("site-menu");
    if (!menu) return; // game.html has no site menu
    var link = menu.querySelector('a[href="/login"]');
    if (!link) return;
    var item = link.closest("li");
    if (!item) return;

    var token = getToken();
    if (!token) return; // signed out: "Log in" is already correct

    /* Don't render a username we haven't verified. A stale or forged token
       would otherwise show someone as signed in. Confirm first, then swap. */
    var xhr = new XMLHttpRequest();
    xhr.open("GET", apiBase() + "/api/auth/me", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.onload = function () {
      if (xhr.status !== 200) {
        if (xhr.status === 401) clearToken(); // expired/invalid, not just offline
        return;
      }
      var user;
      try {
        user = JSON.parse(xhr.responseText).user;
      } catch (e) {
        return;
      }
      if (!user || !user.username) return;
      showSignedIn(item, user);
    };
    xhr.onerror = function () {
      /* API down: leave "Log in" rather than lying */
    };
    xhr.send();
  }

  /* Signing in swaps the one auth slot for your name, which links to your profile.
     Nothing is added, so the nav never changes shape between pages. Logging out
     lives on the profile page next to everything else about you. */
  function showSignedIn(item, user) {
    var link = document.createElement("a");
    link.href = "/user/" + encodeURIComponent(user.username);
    link.textContent = "Profile";
    item.replaceChildren(link);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initNav();
      initCurrentPage();
      initYear();
      initAuthNav();
      initHomeWorks();
      initTitleScreen();
    });
  } else {
    initNav();
    initCurrentPage();
    initYear();
    initAuthNav();
    initHomeWorks();
    initTitleScreen();
  }
})();
