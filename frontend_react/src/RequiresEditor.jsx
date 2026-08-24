import { api } from './lib/api.js';

/* Delta B: what building this takes. Equipment toggles from the curated
   vocabulary with an optional constraint note; materials are item, quantity,
   unit rows that sum cleanly across composites. Nothing here touches XP. */
export default function RequiresEditor({ config, value, onChange }) {
  const req = value && typeof value === 'object' ? value : { equipment: [], materials: [] };
  const equipment = Array.isArray(req.equipment) ? req.equipment : [];
  const materials = Array.isArray(req.materials) ? req.materials : [];
  const items = config?.xp?.equipmentItems || [];
  const mats = config?.xp?.materialItems || [];
  const units = config?.xp?.materialUnits || [];

  const hasEq = (id) => equipment.some(e => e.item === id);
  const toggleEq = (id) => onChange({
    ...req,
    equipment: hasEq(id) ? equipment.filter(e => e.item !== id) : [...equipment, { item: id, note: '' }],
  });

  return (
    <div className="requires-editor">
      <div className="field">
        <label>Equipment needed</label>
        <small>What a builder must own. This is what the buildable-by-you check reads.</small>
        <div className="need-chips">
          {items.map(id => (
            <button key={id} type="button" className={'tag need-chip' + (hasEq(id) ? ' on' : '')}
                    aria-pressed={hasEq(id)} onClick={() => toggleEq(id)}>{id}</button>
          ))}
        </div>
        {equipment.map((e, i) => (
          <div key={e.item} className="req-note-row">
            <span className="stat">{e.item}</span>
            <input placeholder="constraint note, like: bed 200mm or larger" maxLength={120} value={e.note || ''}
                   onChange={ev => onChange({ ...req, equipment: equipment.map((x, j) => j === i ? { ...x, note: ev.target.value } : x) })} />
          </div>
        ))}
      </div>

      <div className="field">
        <label>Materials consumed</label>
        <small>Quantities sum automatically across kits that include this work.</small>
        {materials.map((m, i) => (
          <div key={i} className="req-mat-row">
            <select aria-label="Material" value={m.item || ''}
                    onChange={ev => onChange({ ...req, materials: materials.map((x, j) => j === i ? { ...x, item: ev.target.value } : x) })}>
              <option value="" disabled>material</option>
              {mats.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
            <input type="number" min="0" step="any" aria-label="Quantity" style={{ width: '5rem' }} value={m.qty ?? ''}
                   onChange={ev => onChange({ ...req, materials: materials.map((x, j) => j === i ? { ...x, qty: Number(ev.target.value) } : x) })} />
            <select aria-label="Unit" value={m.unit || 'count'}
                    onChange={ev => onChange({ ...req, materials: materials.map((x, j) => j === i ? { ...x, unit: ev.target.value } : x) })}>
              {units.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input placeholder="note" maxLength={120} value={m.note || ''}
                   onChange={ev => onChange({ ...req, materials: materials.map((x, j) => j === i ? { ...x, note: ev.target.value } : x) })} />
            <button type="button" className="link-btn" aria-label="Remove material"
                    onClick={() => onChange({ ...req, materials: materials.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        {materials.length < 30 &&
          <button type="button" className="link-btn" onClick={() => onChange({ ...req, materials: [...materials, { item: '', qty: 1, unit: 'count', note: '' }] })}>+ Add a material</button>}
      </div>
    </div>
  );
}
