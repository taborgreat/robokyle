import { useEffect, useState } from 'react';
import { api } from './lib/api.js';

/* Ports (Ports Spec): the work's two declaration lists.
   `provides`: this work offers an interface a standard defines; the form
   grows exactly the fields that standard declares, nothing more.
   `accepts`: this work connects to that interface; no fields, no
   verification, the proof of an accept is a composite that works. */

export default function PortsEditor({ ports, onChange }) {
  const value = ports && typeof ports === 'object' ? ports : { provides: [], accepts: [] };
  const provides = Array.isArray(value.provides) ? value.provides : [];
  const accepts = Array.isArray(value.accepts) ? value.accepts : [];
  // Standard names/fields for entries that came back from a saved draft bare.
  const [meta, setMeta] = useState({});   // standard id -> {title, portName, fields}

  useEffect(() => {
    const missing = [...provides, ...accepts]
      .map(p => String(p.standard))
      .filter(id => id && !meta[id]);
    for (const id of [...new Set(missing)]) {
      api(`/designs/${id}`)
        .then(d => setMeta(m => ({ ...m, [id]: {
          title: d.title,
          portName: d.standard?.portName || '',
          fields: d.standard?.fields || [],
        } })))
        .catch(() => setMeta(m => ({ ...m, [id]: { title: 'a removed standard', portName: '', fields: [] } })));
    }
  }, [provides, accepts]);   // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (next) => onChange({ provides, accepts, ...next });
  const infoFor = (id) => meta[String(id)] || { title: '…', portName: '', fields: [] };
  const has = (list, id) => list.some(x => String(x.standard) === String(id));

  function addProvides(std) {
    if (has(provides, std.id)) return;
    setMeta(m => ({ ...m, [String(std.id)]: { title: std.title, portName: std.portName || '', fields: m[String(std.id)]?.fields || [] } }));
    patch({ provides: [...provides, { standard: std.id, version: null, fieldValues: {} }] });
  }
  function addAccepts(std) {
    if (has(accepts, std.id)) return;
    setMeta(m => ({ ...m, [String(std.id)]: { title: std.title, portName: std.portName || '', fields: m[String(std.id)]?.fields || [] } }));
    patch({ accepts: [...accepts, { standard: std.id, version: null }] });
  }
  const setValue = (i, name, v) => patch({
    provides: provides.map((p, j) => j === i ? { ...p, fieldValues: { ...(p.fieldValues || {}), [name]: v } } : p),
  });

  return (
    <>
      <div className="field">
        <label>Provides: interfaces this work offers</label>
        {provides.map((p, i) => {
          const info = infoFor(p.standard);
          return (
            <div key={String(p.standard)} className="port-decl">
              <div className="port-decl-head">
                <strong>{info.portName || info.title}</strong>
                <span className="stat">{info.title}</span>
                <button type="button" className="link-btn" aria-label={`Remove ${info.title}`}
                        onClick={() => patch({ provides: provides.filter((_, j) => j !== i) })}>×</button>
              </div>
              {info.fields.length > 0 && (
                <div className="port-fields">
                  {info.fields.map(f => (
                    <label key={f.name} className="port-field">
                      <span>{f.name}{f.unit && ` (${f.unit})`}{f.required && <span className="required-mark">required</span>}</span>
                      <input value={p.fieldValues?.[f.name] ?? ''} onChange={e => setValue(i, f.name, e.target.value)} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <StandardSearch label="+ provide an interface" onPick={addProvides} />
      </div>

      <div className="field">
        <label>Accepts: interfaces this work connects to</label>
        {accepts.map((a, i) => {
          const info = infoFor(a.standard);
          const isBody = (info.portName || '').startsWith('body:');
          const setA = (fields) => patch({ accepts: accepts.map((x, j) => j === i ? { ...x, ...fields } : x) });
          return (
            <div key={String(a.standard)} className="port-decl">
              <div className="port-decl-head">
                <strong>{info.portName || info.title}</strong>
                <span className="stat">{info.title}</span>
                <button type="button" className="link-btn" aria-label={`Remove ${info.title}`}
                        onClick={() => patch({ accepts: accepts.filter((_, j) => j !== i) })}>×</button>
              </div>
              {isBody && (
                <div className="port-fields">
                  <label className="port-field">
                    <span>which side it fits</span>
                    <select aria-label="Laterality" value={a.laterality || 'either'} onChange={e => setA({ laterality: e.target.value })}>
                      <option value="either">either</option>
                      <option value="left">left</option>
                      <option value="right">right</option>
                    </select>
                  </label>
                  {info.fields.map(f => (
                    <label key={f.name} className="port-field">
                      <span>{f.name}{f.unit && f.unit !== 'bool' && ` (${f.unit})`}</span>
                      <input value={a.fieldValues?.[f.name] ?? ''} placeholder={f.unit === 'bool' ? 'yes or no' : ''}
                             onChange={e => setA({ fieldValues: { ...(a.fieldValues || {}), [f.name]: e.target.value } })} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <StandardSearch label="+ accept an interface" onPick={addAccepts} />
      </div>
    </>
  );
}

function StandardSearch({ label, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [browsing, setBrowsing] = useState(false);

  /* Opening the picker lists the standards that exist before anything is
     typed. There will rarely be many, and seeing them is how you learn what
     is available to connect to. Typing narrows the list. */
  async function load(query) {
    try {
      const r = await api(`/designs?${query ? `q=${encodeURIComponent(query)}&` : 'sort=new&'}type=standard&limit=8`);
      setResults(r.items);
      setBrowsing(!query);
    } catch { setResults([]); }
  }
  const openUp = () => { setOpen(true); load(''); };
  const close = () => { setOpen(false); setResults(null); setQ(''); };

  if (!open) return <button type="button" className="link-btn" onClick={openUp}>{label}</button>;
  return (
    <span className="work-picker">
      <input placeholder="type to narrow" value={q} autoFocus onChange={e => setQ(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); load(q.trim()); } }} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(q.trim())}>Find</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
      {results && (results.length === 0
        ? <em> {browsing ? 'no standards exist yet' : 'no standards matched'}</em>
        : <>
            {browsing && <span className="stat"> available: </span>}
            {results.map(w => (
              <button key={w.id} type="button" className="link-btn" style={{ marginLeft: '.5rem' }}
                      onClick={() => { onPick(w); close(); }}>
                {w.portName ? `${w.portName}: ${w.title}` : w.title}
              </button>
            ))}
          </>)}
    </span>
  );
}
