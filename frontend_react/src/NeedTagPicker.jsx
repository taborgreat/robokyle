import { useState } from 'react';

/* The need-tag picker: a curated vocabulary of real needs, grouped, tapped on
   and off. What a person or caregiver actually searches by lives here, not in
   whatever words each author happens to invent. A small free-text add remains
   for the need the list missed; it joins the chips like any other. */
export default function NeedTagPicker({ vocabulary, value, onChange }) {
  const [custom, setCustom] = useState('');
  const selected = new Set(value || []);
  const known = new Set((vocabulary || []).flatMap(g => g.tags));

  const toggle = (tag) => {
    const next = new Set(selected);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    onChange([...next].slice(0, 15));
  };
  const addCustom = () => {
    const tag = custom.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    if (tag) toggle(tag);
    setCustom('');
  };

  return (
    <div className="need-picker">
      {(vocabulary || []).map(g => (
        <div key={g.group} className="need-group">
          <span className="need-group-name">{g.group}</span>
          <div className="need-chips">
            {g.tags.map(tag => (
              <button key={tag} type="button" className={'tag need-chip' + (selected.has(tag) ? ' on' : '')}
                      aria-pressed={selected.has(tag)} onClick={() => toggle(tag)}>{tag}</button>
            ))}
          </div>
        </div>
      ))}
      {[...selected].filter(t => !known.has(t)).length > 0 && (
        <div className="need-group">
          <span className="need-group-name">Your own</span>
          <div className="need-chips">
            {[...selected].filter(t => !known.has(t)).map(tag => (
              <button key={tag} type="button" className="tag need-chip on" aria-pressed="true"
                      onClick={() => toggle(tag)}>{tag}</button>
            ))}
          </div>
        </div>
      )}
      <div className="need-custom">
        <input placeholder="A need the list missed" value={custom} maxLength={40}
               onChange={e => setCustom(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={addCustom}>Add</button>
      </div>
    </div>
  );
}
