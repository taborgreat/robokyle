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


  // ---------- portraits ----------
  // Head-and-shoulders bust, built from the character's own skin, hair,
  // outfit and equipped mask, so two crew never look alike.
  const HAIR_STYLES = ['short', 'crop', 'swept', 'bun', 'braids', 'bald', 'curls'];

  function shadeHex(hex, amt) {
    if (!hex || hex[0] !== '#') return hex || '#888';
    let r = parseInt(hex.substr(1, 2), 16),
        g = parseInt(hex.substr(3, 2), 16),
        b = parseInt(hex.substr(5, 2), 16);
    const cl = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + cl(r) + ',' + cl(g) + ',' + cl(b) + ')';
  }

  function hairShape(style, hair, hairDark) {
    switch (style) {
      case 'bald':
        return '<path d="M17 20c0-5 3-8 7-8s7 3 7 8" fill="' + hairDark + '" opacity=".35"/>';
      case 'crop':
        return '<path d="M16.5 21c0-5.4 3.4-9 7.5-9s7.5 3.6 7.5 9c0 0-2-3-7.5-3s-7.5 3-7.5 3z" fill="' + hair + '"/>';
      case 'swept':
        return '<path d="M16.4 21.5c-.4-6 3.2-10 7.6-10 4 0 6.6 2.2 7.4 5.4-2.6-1.8-7.4-2.2-10 .4-1.2 1.2-1.8 2.8-2 4.2z" fill="' + hair + '"/>' +
               '<path d="M24 11.6c3.2 0 5.6 1.4 6.8 3.6-1.8-1-4-1.2-6-.6" stroke="' + hairDark + '" stroke-width="1" fill="none"/>';
      case 'bun':
        return '<circle cx="24" cy="9.6" r="3.4" fill="' + hair + '"/>' +
               '<path d="M16.6 21c0-5.6 3.3-9.4 7.4-9.4s7.4 3.8 7.4 9.4c0 0-2.2-3.4-7.4-3.4S16.6 21 16.6 21z" fill="' + hair + '"/>';
      case 'braids':
        return '<path d="M16.6 21c0-5.6 3.3-9.4 7.4-9.4s7.4 3.8 7.4 9.4c0 0-2.2-3.4-7.4-3.4S16.6 21 16.6 21z" fill="' + hair + '"/>' +
               '<path d="M16.8 20.5c-1.6 1.8-2 5-1.4 8.2M31.2 20.5c1.6 1.8 2 5 1.4 8.2" stroke="' + hair + '" stroke-width="2.6" stroke-linecap="round" fill="none"/>';
      case 'curls':
        return '<g fill="' + hair + '">' +
               '<circle cx="18.4" cy="17.4" r="3.2"/><circle cx="24" cy="14.6" r="3.6"/>' +
               '<circle cx="29.6" cy="17.4" r="3.2"/><circle cx="20.6" cy="13.8" r="2.6"/>' +
               '<circle cx="27.4" cy="13.8" r="2.6"/></g>';
      default: // short
        return '<path d="M16.6 21.4c0-5.8 3.3-9.8 7.4-9.8s7.4 4 7.4 9.8c0 0-1.4-4.6-7.4-4.6s-7.4 4.6-7.4 4.6z" fill="' + hair + '"/>';
    }
  }

  // Mask overlays, drawn over the face. Each one is the same silhouette
  // the character wears in the world, so the portrait matches the sprite.
  function maskShape(key, mask) {
    const col = mask.color, trim = mask.trim;
    const face = '<path d="M17 22c0-4.2 3.1-7.2 7-7.2s7 3 7 7.2v3.4c0 4.4-3.1 7.6-7 7.6s-7-3.2-7-7.6z" fill="' + col + '"/>';
    switch (key) {
      case 'bandana':
        return '<path d="M17 25.4h14v3.2c0 3.6-3.1 6.4-7 6.4s-7-2.8-7-6.4z" fill="' + col + '"/>' +
               '<path d="M17.4 25.4h13.2" stroke="' + shadeHex(col, -0.2) + '" stroke-width="1"/>';
      case 'ski':
        return face +
               '<rect x="18.6" y="22.4" width="4.4" height="2.6" rx="1.3" fill="#0B0E12"/>' +
               '<rect x="25" y="22.4" width="4.4" height="2.6" rx="1.3" fill="#0B0E12"/>' +
               '<ellipse cx="24" cy="28.4" rx="2.6" ry="1.6" fill="#0B0E12"/>';
      case 'balaclava':
        return face +
               '<ellipse cx="24" cy="24.6" rx="5" ry="2.6" fill="#0B0E12"/>' +
               '<circle cx="21.8" cy="24.4" r=".9" fill="#DDE6EE"/>' +
               '<circle cx="26.2" cy="24.4" r=".9" fill="#DDE6EE"/>';
      case 'clown':
        return face +
               '<circle cx="24" cy="26.6" r="2.4" fill="' + trim + '"/>' +
               '<circle cx="21.4" cy="22.6" r="1.1" fill="#12161C"/>' +
               '<circle cx="26.6" cy="22.6" r="1.1" fill="#12161C"/>' +
               '<path d="M20.6 30c2 1.8 4.8 1.8 6.8 0" stroke="' + trim + '" stroke-width="1.2" fill="none"/>';
      case 'hockey':
        return face +
               '<circle cx="21.6" cy="23" r="1.1" fill="' + trim + '"/>' +
               '<circle cx="26.4" cy="23" r="1.1" fill="' + trim + '"/>' +
               '<circle cx="24" cy="27" r="1" fill="' + trim + '"/>' +
               '<circle cx="21.4" cy="29.6" r=".9" fill="' + trim + '"/>' +
               '<circle cx="26.6" cy="29.6" r=".9" fill="' + trim + '"/>';
      case 'skull':
        return face +
               '<ellipse cx="21.4" cy="23.4" rx="2" ry="2.3" fill="' + trim + '"/>' +
               '<ellipse cx="26.6" cy="23.4" rx="2" ry="2.3" fill="' + trim + '"/>' +
               '<path d="M23.2 26.6h1.6l-.8 2z" fill="' + trim + '"/>' +
               '<path d="M20.8 30h6.4M22 30v2M26 30v2" stroke="' + trim + '" stroke-width="1"/>';
      case 'pig':
        return face +
               '<ellipse cx="24" cy="27.4" rx="3.2" ry="2.4" fill="' + trim + '"/>' +
               '<circle cx="22.9" cy="27.4" r=".65" fill="#5C3238"/>' +
               '<circle cx="25.1" cy="27.4" r=".65" fill="#5C3238"/>' +
               '<circle cx="21.6" cy="22.8" r="1" fill="#3A2126"/>' +
               '<circle cx="26.4" cy="22.8" r="1" fill="#3A2126"/>' +
               '<path d="M18.6 17.4l2 2.6M29.4 17.4l-2 2.6" stroke="' + col + '" stroke-width="2.6" stroke-linecap="round"/>';
      case 'gas':
        return face +
               '<circle cx="21.4" cy="23.4" r="2.4" fill="#0E1216"/>' +
               '<circle cx="26.6" cy="23.4" r="2.4" fill="#0E1216"/>' +
               '<circle cx="21.4" cy="23.4" r="1.1" fill="' + trim + '"/>' +
               '<circle cx="26.6" cy="23.4" r="1.1" fill="' + trim + '"/>' +
               '<ellipse cx="24" cy="29.4" rx="3" ry="2.4" fill="#0E1216"/>' +
               '<circle cx="24" cy="29.4" r="1.2" fill="' + shadeHex(col, -0.2) + '"/>';
      default:
        return face;
    }
  }

  GH.portrait = function (c, opts) {
    const o = opts || {};
    const D2 = window.GH_DATA;
    const isRobo = !!c.isRobo;
    const skin = isRobo ? '#D9A97A' : (c.skin || '#D9A97A');
    const outfit = isRobo ? '#1B2029' : (c.outfit || '#2A2E38');
    const hair = isRobo ? '#F2C75E' : (c.hair || '#3A2A20');
    const hairDark = shadeHex(hair, -0.22);
    const mask = (D2.MASKS && D2.MASKS[c.mask]) || null;
    const masked = !!(mask && mask.color);
    const style = isRobo ? 'spikes' : (c.hairStyle || 'short');

    let inner = '';
    // backdrop
    inner += '<rect width="48" height="48" rx="7" fill="#0E141B"/>';
    inner += '<circle cx="24" cy="19" r="15" fill="' + shadeHex(outfit, 0.06) + '" opacity=".22"/>';

    // shoulders + collar
    inner += '<path d="M6 48v-5c0-6.6 5.6-11 12-12.4h12C36.4 32 42 36.4 42 43v5z" fill="' + outfit + '"/>';
    inner += '<path d="M18 30.6l6 6 6-6c2 .5 3.6 1.2 5 2.1l-11 8.6-11-8.6c1.4-.9 3-1.6 5-2.1z" fill="' + shadeHex(outfit, 0.10) + '"/>';
    // neck
    inner += '<path d="M21 27h6v6.4l-3 2.6-3-2.6z" fill="' + shadeHex(skin, -0.16) + '"/>';

    if (masked) {
      inner += maskShape(c.mask, mask);
      // a little hair still shows above most masks
      if (c.mask !== 'balaclava' && c.mask !== 'gas' && !isRobo) {
        inner += '<path d="M17.2 21.6c.4-5.2 3.6-8.4 6.8-8.4s6.4 3.2 6.8 8.4c-1.6-2.4-4-3.4-6.8-3.4s-5.2 1-6.8 3.4z" fill="' + hair + '"/>';
      }
    } else {
      // face
      inner += '<path d="M17 22c0-4.2 3.1-7.2 7-7.2s7 3 7 7.2v3.4c0 4.4-3.1 7.6-7 7.6s-7-3.2-7-7.6z" fill="' + skin + '"/>';
      // cheek shade + ears
      inner += '<path d="M17 24.6c0 4.6 3.1 8.4 7 8.4v-8.4z" fill="' + shadeHex(skin, -0.08) + '" opacity=".5"/>';
      inner += '<circle cx="16.8" cy="25" r="1.5" fill="' + shadeHex(skin, -0.1) + '"/>';
      inner += '<circle cx="31.2" cy="25" r="1.5" fill="' + shadeHex(skin, -0.1) + '"/>';
      // brows, eyes, mouth
      inner += '<path d="M20.2 22.2h3M24.8 22.2h3" stroke="' + hairDark + '" stroke-width="1.1" stroke-linecap="round"/>';
      inner += '<circle cx="21.7" cy="24.4" r="1.05" fill="#161B22"/>';
      inner += '<circle cx="26.3" cy="24.4" r="1.05" fill="#161B22"/>';
      inner += '<circle cx="22.05" cy="24.05" r=".32" fill="#E8EDF2"/>';
      inner += '<circle cx="26.65" cy="24.05" r=".32" fill="#E8EDF2"/>';
      inner += '<path d="M22.4 29.2c1 .7 2.2 .7 3.2 0" stroke="' + shadeHex(skin, -0.3) + '" stroke-width="1" stroke-linecap="round" fill="none"/>';

      if (isRobo) {
        // his blonde spikes, and the chrome arm on one shoulder
        inner += '<path d="M16.6 21.4c0-5.8 3.3-9.8 7.4-9.8s7.4 4 7.4 9.8c0 0-1.4-4.6-7.4-4.6s-7.4 4.6-7.4 4.6z" fill="' + hair + '"/>';
        inner += '<g fill="' + hair + '">' +
                 '<path d="M17.2 16l-3.4-4 5 1.6z"/>' +
                 '<path d="M21.4 13.2l-1.6-5 4 3.6z"/>' +
                 '<path d="M26.6 13.2l1.6-5-4 3.6z"/>' +
                 '<path d="M30.8 16l3.4-4-5 1.6z"/></g>';
      } else {
        inner += hairShape(style, hair, hairDark);
      }
    }

    if (isRobo) {
      inner += '<path d="M30 32c5 1.8 8 5.6 8 11v5h-8z" fill="#B9C1CC"/>';
      inner += '<path d="M31.6 36.4c2.4 1.2 3.8 3.2 4.2 5.8" stroke="#79828F" stroke-width="1.1" fill="none"/>';
    }

    // rim light + frame
    inner += '<rect x=".6" y=".6" width="46.8" height="46.8" rx="6.6" fill="none" stroke="rgba(255,255,255,.10)"/>';

    return '<svg class="portrait' + (o.big ? ' big' : '') + '" viewBox="0 0 48 48" ' +
           'aria-hidden="true" role="img">' + inner + '</svg>';
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
