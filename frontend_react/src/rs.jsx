import { useState } from 'react';

/* ============================================================
   RS chrome shared pieces (RuneScape Profile Spec).

   Icons are Tabor-made SVGs dropped into public/assets/icons/
   as skill-<categoryId>.svg and tool-<equipmentItem>.svg. Until
   a file exists the fallback renders — a category-colored initial
   for skills, a line wrench for tools — so nothing waits on art
   and new vocabulary items enter with the generic mark.
   ============================================================ */

/* Fallback codes: Software/Systems and Documentation/Design would both
   collapse to S and D, so the ambiguous four get two letters. */
const SKILL_CODE = { mech: 'M', fab: 'F', elec: 'E', soft: 'So', sys: 'Sy', abil: 'A', docs: 'Do', dsgn: 'De', comm: 'C' };

/* Each icon URL is probed at most once per session: until it resolves the
   fallback shows (no broken-image flash), and the verdict is cached so every
   later mount renders the right thing on first paint with no request. */
const iconState = new Map();   // url -> 'ok' | 'missing'

function useIconProbe(url) {
  const [state, setState] = useState(() => iconState.get(url) || 'probe');
  const settle = (verdict) => { iconState.set(url, verdict); setState(verdict); };
  return [state, settle];
}

export function SkillIcon({ id, name, color, size = 26 }) {
  const url = `/assets/icons/skill-${id}.svg`;
  const [state, settle] = useIconProbe(url);
  if (state === 'ok') return <img className="rs-icon" src={url} alt="" width={size} height={size} />;
  const code = SKILL_CODE[id] || (name || id || '?').slice(0, 1);
  return (
    <span className="rs-icon rs-icon-fallback" aria-hidden="true"
          style={{ width: size, height: size, fontSize: size * (code.length > 1 ? 0.42 : 0.55), '--cat': color || 'var(--ink-mute)' }}>
      {code}
      {state === 'probe' && <img src={url} alt="" style={{ display: 'none' }}
                                 onLoad={() => settle('ok')} onError={() => settle('missing')} />}
    </span>
  );
}

export function ToolIcon({ id, size = 26 }) {
  const url = `/assets/icons/tool-${id}.svg`;
  const [state, settle] = useIconProbe(url);
  if (state === 'ok') return <img className="rs-icon" src={url} alt="" width={size} height={size} />;
  return (
    <>
      <svg className="rs-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a4.6 4.6 0 0 0-6.1 5.9L3 17.8 6.2 21l5.6-5.6a4.6 4.6 0 0 0 5.9-6.1l-3 3-2.1-2.1z" />
      </svg>
      {state === 'probe' && <img src={url} alt="" style={{ display: 'none' }}
                                 onLoad={() => settle('ok')} onError={() => settle('missing')} />}
    </>
  );
}

/* The RS stacked fraction: current level over 99 with the diagonal divider.
   A maxed skill drops the fraction for the single gold 99 (the cell adds its
   permanent category-color outline). */
export function LevelFraction({ level }) {
  if (level >= 99) return <span className="rs-num rs-frac rs-frac-maxed">99</span>;
  return (
    <span className="rs-num rs-frac">
      <span className="rs-frac-cur">{level}</span><span className="rs-frac-div" aria-hidden="true">&#8725;</span><span className="rs-frac-cap">99</span>
    </span>
  );
}
