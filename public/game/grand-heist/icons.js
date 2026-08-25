// ============================================================
// RoboKyle: Grand Heist — inline SVG icon set
//
// Every weapon, bag, armour piece and mask gets a silhouette so
// loadouts are readable at a glance instead of being a wall of
// names. 24x24 viewBox, drawn in currentColor.
// ============================================================
(() => {
  'use strict';
  const GH = window.GH;

  const svg = (body, extra) =>
    '<svg class="ico' + (extra ? ' ' + extra : '') + '" viewBox="0 0 24 24" aria-hidden="true" ' +
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    body + '</svg>';

  // ---------- weapons ----------
  const WEAPON = {
    knife: svg('<path d="M4 20l6-6"/><path d="M10 14l7-9 3 3-9 7z" fill="currentColor" fill-opacity=".18"/><path d="M8.6 15.4l1.8 1.8"/>'),
    bat:   svg('<path d="M4 20l4-4"/><path d="M8 16c3-3 6-7 9-10l3 3c-3 3-7 6-10 9z" fill="currentColor" fill-opacity=".18"/>'),
    glock: svg('<path d="M4 9h13v4H9l-1 3H6l1-3H4z" fill="currentColor" fill-opacity=".18"/><path d="M17 11h3"/><path d="M7 13v3"/>'),
    shotgun: svg('<path d="M2 11h18v3H2z" fill="currentColor" fill-opacity=".18"/><path d="M20 12.5h2"/><path d="M7 14l-2 4"/><path d="M12 11V9"/>'),
    smg:   svg('<path d="M3 9h12v3H3z" fill="currentColor" fill-opacity=".18"/><path d="M15 10.5h5"/><path d="M6 12v5"/><path d="M10 12v3h3"/>'),
    rifle: svg('<path d="M2 10h15v3H2z" fill="currentColor" fill-opacity=".18"/><path d="M17 11.5h5"/><path d="M6 13v4"/><path d="M11 13v2h4"/><path d="M8 8h3v2"/>'),
    lmg:   svg('<path d="M2 9h14v3H2z" fill="currentColor" fill-opacity=".18"/><path d="M16 10.5h6"/><rect x="6" y="12" width="7" height="6" rx="1.5" fill="currentColor" fill-opacity=".18"/><path d="M4 7h4"/>'),
    rpg:   svg('<path d="M3 11h13v3H3z" fill="currentColor" fill-opacity=".18"/><path d="M16 12.5c2 0 4-1.5 5-3.5v7c-1-2-3-3.5-5-3.5z" fill="currentColor" fill-opacity=".3"/><path d="M7 14v4"/>'),
    pulse: svg('<path d="M3 10h13v4H3z" fill="currentColor" fill-opacity=".18"/><path d="M16 12h5"/><path d="M6 14v4"/><path d="M11 6l-2 4h3l-2 4"/>'),
    arc:   svg('<path d="M3 10h11v4H3z" fill="currentColor" fill-opacity=".18"/><path d="M14 12h3"/><path d="M18 7l-2 4h3l-3 6"/><path d="M6 14v4"/>'),
    minigun: svg('<circle cx="7" cy="12" r="4" fill="currentColor" fill-opacity=".18"/><path d="M11 10h11"/><path d="M11 12h11"/><path d="M11 14h11"/><path d="M7 16v3"/>'),
    plasma: svg('<path d="M3 10h11v4H3z" fill="currentColor" fill-opacity=".18"/><circle cx="18" cy="12" r="3.5" fill="currentColor" fill-opacity=".3"/><path d="M6 14v4"/>'),
    singularity: svg('<circle cx="15" cy="12" r="4" fill="currentColor" fill-opacity=".35"/><circle cx="15" cy="12" r="7"/><path d="M2 11h6v2H2z" fill="currentColor" fill-opacity=".18"/>'),
  };

  // ---------- bags ----------
  const BAG = {
    none:     svg('<path d="M6 9h12l-1 10H7z"/><path d="M9 9V7a3 3 0 016 0v2"/><path d="M4 4l16 16" stroke-opacity=".55"/>'),
    moneybag: svg('<path d="M8 8h8l2 11H6z" fill="currentColor" fill-opacity=".18"/><path d="M9 8l1-3h4l1 3"/><path d="M12 11v6"/><path d="M10.5 12.5h3"/>'),
    duffel:   svg('<rect x="3" y="9" width="18" height="9" rx="3" fill="currentColor" fill-opacity=".18"/><path d="M9 9V7h6v2"/><path d="M3 13h18"/>'),
    cart:     svg('<path d="M4 6h3l2 9h9" fill="none"/><path d="M7 8h13l-2 6H9z" fill="currentColor" fill-opacity=".18"/><circle cx="11" cy="19" r="1.6"/><circle cx="18" cy="19" r="1.6"/>'),
    nanopack: svg('<rect x="6" y="7" width="12" height="13" rx="3" fill="currentColor" fill-opacity=".18"/><path d="M9 7V5h6v2"/><path d="M9 12h6"/><path d="M9 15h6"/><path d="M12 3v2"/>'),
  };

  // ---------- armour ----------
  const ARMOR = {
    none:   svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M4 4l16 16" stroke-opacity=".55"/>'),
    kevlar: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="currentColor" fill-opacity=".16"/>'),
    heavy:  svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="currentColor" fill-opacity=".3"/><path d="M12 6v13"/><path d="M7 9h10"/>'),
    riot:   svg('<path d="M6 3h12v11c0 4-3 6-6 7-3-1-6-3-6-7z" fill="currentColor" fill-opacity=".2"/><path d="M6 8h12"/><path d="M6 12h12"/>'),
  };

  // ---------- masks ----------
  const MASK = {
    none:      svg('<circle cx="12" cy="11" r="7"/><path d="M9.5 10h.01"/><path d="M14.5 10h.01"/><path d="M9.5 14.5c1.6 1.2 3.4 1.2 5 0"/>'),
    ski:       svg('<path d="M5 9a7 7 0 0114 0v4a7 7 0 01-14 0z" fill="currentColor" fill-opacity=".25"/><rect x="7.5" y="10" width="3.5" height="2" rx="1" fill="currentColor"/><rect x="13" y="10" width="3.5" height="2" rx="1" fill="currentColor"/>'),
    bandana:   svg('<circle cx="12" cy="10" r="6.5"/><path d="M6 12.5h12c-.6 3.5-3 5.5-6 5.5s-5.4-2-6-5.5z" fill="currentColor" fill-opacity=".3"/>'),
    balaclava: svg('<path d="M5 9a7 7 0 0114 0v5a7 7 0 01-14 0z" fill="currentColor" fill-opacity=".35"/><ellipse cx="12" cy="11" rx="4.5" ry="2" fill="none"/>'),
    clown:     svg('<circle cx="12" cy="12" r="7" fill="currentColor" fill-opacity=".18"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M6 6l2 2"/><path d="M18 6l-2 2"/><path d="M8.5 16c2 1.6 5 1.6 7 0"/>'),
    hockey:    svg('<path d="M6 8a6 6 0 0112 0v5a6 6 0 01-12 0z" fill="currentColor" fill-opacity=".2"/><circle cx="9.5" cy="10" r=".9" fill="currentColor"/><circle cx="14.5" cy="10" r=".9" fill="currentColor"/><circle cx="12" cy="13.5" r=".8" fill="currentColor"/>'),
    skull:     svg('<path d="M5 10a7 7 0 0114 0v3l-2 2v3H7v-3l-2-2z" fill="currentColor" fill-opacity=".22"/><circle cx="9.5" cy="10.5" r="1.6" fill="currentColor"/><circle cx="14.5" cy="10.5" r="1.6" fill="currentColor"/><path d="M12 13v2"/>'),
    pig:       svg('<circle cx="12" cy="12" r="7" fill="currentColor" fill-opacity=".18"/><ellipse cx="12" cy="14" rx="3" ry="2.2" fill="currentColor" fill-opacity=".5"/><circle cx="11" cy="14" r=".6" fill="currentColor"/><circle cx="13" cy="14" r=".6" fill="currentColor"/><path d="M7 7l1.5 2"/><path d="M17 7l-1.5 2"/>'),
    gas:       svg('<path d="M6 8a6 6 0 0112 0v3a6 6 0 01-6 6 6 6 0 01-6-6z" fill="currentColor" fill-opacity=".22"/><circle cx="9.5" cy="10" r="1.8"/><circle cx="14.5" cy="10" r="1.8"/><path d="M10 16.5c1.2.8 2.8.8 4 0"/>'),
  };

  // ---------- stats ----------
  const STAT = {
    shooting: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>'),
    health:   svg('<path d="M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z" fill="currentColor" fill-opacity=".2"/>'),
    carry:    svg('<path d="M8 8h8l2 11H6z" fill="currentColor" fill-opacity=".18"/><path d="M9 8l1-3h4l1 3"/><path d="M12 11v6"/><path d="M10.5 12.5h3"/>'),
    level:    svg('<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z" fill="currentColor" fill-opacity=".2"/>'),
    morale:   svg('<path d="M12 3a5 5 0 015 5c0 3-2 4.5-2 7H9c0-2.5-2-4-2-7a5 5 0 015-5z" fill="currentColor" fill-opacity=".2"/><path d="M9.5 18h5"/><path d="M10 21h4"/>'),
    cash:     svg('<rect x="2.5" y="6" width="19" height="12" rx="2" fill="currentColor" fill-opacity=".16"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9v6"/><path d="M18 9v6"/>'),
  };

  const fallback = svg('<circle cx="12" cy="12" r="8"/>');

  GH.icon = {
    weapon: (k) => WEAPON[k] || fallback,
    bag:    (k) => BAG[k] || fallback,
    armor:  (k) => ARMOR[k] || fallback,
    mask:   (k) => MASK[k] || fallback,
    stat:   (k) => STAT[k] || fallback,
    // slot name -> icon, so the shop builder stays generic
    forSlot: (slot, key) => ({
      weapon: WEAPON, bag: BAG, armor: ARMOR, mask: MASK,
    }[slot] || {})[key] || fallback,
  };
})();
