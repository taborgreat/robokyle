import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';

/* The port hub (Ports Spec §3): a standard's whole ecosystem on one page:
   providers (verified first, sortable by their declared field values),
   consumers, adapters spanning into other standards, and the open plans
   designing around it. A newcomer picks a port, sees everything built
   around it, and knows exactly what to build to plug in. */

export default function PortHub() {
  const { id } = useParams();
  const [hub, setHub] = useState(null);
  const [error, setError] = useState('');
  const [sortField, setSortField] = useState('');

  useEffect(() => {
    api(`/designs/${id}/hub`).then(setHub).catch(e => setError(e.message));
  }, [id]);

  const providers = useMemo(() => {
    if (!hub) return [];
    if (!sortField) return hub.providers;
    // Numeric-aware sort on one declared field, missing values last.
    return [...hub.providers].sort((a, b) => {
      const av = a.fieldValues?.[sortField], bv = b.fieldValues?.[sortField];
      if (av === undefined || av === '') return 1;
      if (bv === undefined || bv === '') return -1;
      return typeof av === 'number' && typeof bv === 'number' ? bv - av : String(av).localeCompare(String(bv));
    });
  }, [hub, sortField]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!hub) return <p className="empty">Loading…</p>;

  const s = hub.standard;
  return (
    <>
      <p className="back-link"><Link to={`/works/${s.id}`}>&larr; {s.title}</Link></p>
      <div className="app-head">
        <div>
          <h1><code>{s.portName}</code> hub</h1>
          <span className="stat">
            Defined by <Link to={`/works/${s.id}`}>{s.title}</Link> (v{s.version})
            {s.author && <> by <Link to={`/user/${s.author}`}>{s.author}</Link></>}
            {' · '}{hub.providers.length} provider{hub.providers.length === 1 ? '' : 's'}
            {' · '}{hub.consumers.length} consumer{hub.consumers.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <Link className="btn btn-primary" to={`/talk/new?type=plan&work=${s.id}`}>Plan something around it</Link>
        </div>
      </div>

      <div className="rs-frame">
        <div className="rs-main">
      <div className="panel">
        <h2>Providers: works offering this interface</h2>
        {s.fields?.length > 0 && (
          <div className="toolbar" style={{ marginBottom: '.5rem' }}>
            <select aria-label="Sort providers by field" value={sortField} onChange={e => setSortField(e.target.value)}>
              <option value="">Verified first</option>
              {s.fields.map(f => <option key={f.name} value={f.name}>by {f.name}{f.unit ? ` (${f.unit})` : ''}</option>)}
            </select>
          </div>
        )}
        {providers.length === 0 ? (
          <p className="stat">Nothing provides this yet. The first work to do so becomes the reference everyone else attaches to.</p>
        ) : (
          <ul className="hub-list">
            {providers.map(w => (
              <li key={String(w.id)}>
                {w.thumbUrl && <img className="hub-thumb" src={fileUrl(w.thumbUrl)} alt="" loading="lazy" />}
                <div>
                  <Link to={`/works/${w.id}`}><strong>{w.title}</strong></Link>
                  {w.verified
                    ? <span className="tag endorsed-tag">✓ verified</span>
                    : <span className="tag" title="Declared by the author; awaiting a qualified review">claimed</span>}
                  <br />
                  <span className="stat">
                    by <Link to={`/user/${w.author}`}>{w.author}</Link> · v{w.version} · ▲ <span className="rs-num">{w.upvoteCount}</span> · <span className="rs-num">{w.downloadCount}</span> downloads
                    {Object.entries(w.fieldValues || {}).map(([k, v]) => ` · ${k}: ${v}`).join('')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

        </div>

        <aside className="rs-side">
      <div className="panel">
        <h2>Consumers: works that connect to it</h2>
        {hub.consumers.length === 0 ? <p className="stat">Nothing accepts this yet.</p> : (
          <ul className="revision-list">
            {hub.consumers.map(w => (
              <li key={String(w.id)}>
                <Link to={`/works/${w.id}`}>{w.title}</Link>
                <span className="stat"> by <Link to={`/user/${w.author}`}>{w.author}</Link></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hub.adapters.length > 0 && (
        <div className="panel">
          <h2>Adapters: bridges into other standards</h2>
          <ul className="revision-list">
            {hub.adapters.map(w => (
              <li key={String(w.id)}>
                <Link to={`/works/${w.id}`}>{w.title}</Link>
                <span className="stat"> by <Link to={`/user/${w.author}`}>{w.author}</Link></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hub.plans.length > 0 && (
        <div className="panel">
          <h2>Being planned around it</h2>
          <ul className="revision-list">
            {hub.plans.map(p => (
              <li key={String(p.id)}>
                <Link to={`/talk/${p.id}`}>{p.title}</Link>
                <span className="stat"> on {p.board}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
        </aside>
      </div>
    </>
  );
}
