import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const fmtSize = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const FILE_GROUPS = [
  ['model', '3D files'],
  ['doc', 'Documents'],
  ['archive', 'Archives'],
  ['image', 'Images'],
  ['other', 'Other files'],
];

const LINK_GROUPS = [
  ['files', 'Model files'],
  ['video', 'Videos'],
  ['docs', 'Guides & docs'],
  ['parts', 'Parts to buy'],
  ['other', 'Links'],
];

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export default function DesignView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [shot, setShot] = useState(0);

  const load = () => api(`/designs/${id}`).then(setD).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);

  const images = useMemo(() => (d?.files || []).filter(f => f.viewUrl), [d]);
  // Version history reads newest-first: each entry is the edit that produced a version.
  const timeline = useMemo(() => {
    if (!d) return [];
    const entries = [...d.history].reverse().map(h => ({
      version: h.version + 1,
      at: h.createdAt,
      by: h.editedBy?.username,
      changes: h.changes || [],
      note: h.editNote,
      snapshot: { version: h.version, files: h.files || [] },
    }));
    return [...entries, { version: 1, at: d.createdAt, by: d.author.username, changes: ['Published'], note: '' }];
  }, [d]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!d) return <p className="empty">Loading…</p>;

  const mine = d.canEdit;
  const guide = d.guide || {};
  const hasGuide = !!(guide.summary || guide.printSettings || guide.materials?.length || guide.tools?.length || guide.steps?.length);
  const imageById = new Map(images.map(f => [f._id, f]));
  const hero = images[Math.min(shot, images.length - 1)];

  async function vote() {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    const r = await api(`/designs/${id}/upvote`, { method: 'POST' });
    setD({ ...d, upvoted: r.upvoted, upvoteCount: r.upvoteCount });
  }
  async function postComment(e) {
    e.preventDefault();
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    const c = await api(`/designs/${id}/comments`, { method: 'POST', body: { body: comment } });
    setD({ ...d, comments: [...d.comments, c] }); setComment('');
  }
  async function delComment(cid) {
    await api(`/designs/${id}/comments/${cid}`, { method: 'DELETE' });
    setD({ ...d, comments: d.comments.filter(c => c._id !== cid) });
  }
  async function delDesign() {
    if (!confirm('Delete this work and all its files?')) return;
    await api(`/designs/${id}`, { method: 'DELETE' }); nav('/works');
  }

  return (
    <>
      <p><Link to="/works">&larr; All works</Link></p>
      <div className="app-head">
        <div>
          <h1>{d.title}</h1>
          <span className="stat">by <Link to={`/user/${d.author.username}`}><strong>{d.author.username}</strong></Link> · v{d.version} · updated {fmtDate(d.updatedAt)} · {d.downloadCount} downloads</span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className={'btn btn-ghost vote' + (d.upvoted ? ' on' : '')} onClick={vote} aria-pressed={d.upvoted}>▲ {d.upvoteCount}</button>
          {mine && <Link className="btn btn-ghost" to={`/works/${id}/edit`}>Edit</Link>}
          {mine && <button className="btn btn-danger" onClick={delDesign}>Delete</button>}
        </div>
      </div>

      <div className="design-detail-grid">
        <div>
          {hero && (
            <figure className="gallery">
              <a href={fileUrl(hero.viewUrl)} target="_blank" rel="noreferrer">
                <img src={fileUrl(hero.viewUrl)} alt={hero.caption || hero.originalName} />
              </a>
              <figcaption>{hero.caption || hero.originalName}</figcaption>
              {images.length > 1 && (
                <div className="thumbs">
                  {images.map((f, i) => (
                    <button key={f._id} type="button" className={'thumb-btn' + (i === Math.min(shot, images.length - 1) ? ' on' : '')}
                            onClick={() => setShot(i)} aria-label={f.caption || f.originalName}>
                      <img src={fileUrl(f.viewUrl)} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </figure>
          )}

          <div className="panel">
            <p className="desc">{d.description}</p>
            {d.tags.length > 0 && <div className="meta" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              {d.tags.map(t => <Link key={t} className="tag" to={`/works?q=${encodeURIComponent(t)}`}>{t}</Link>)}</div>}
          </div>

          {hasGuide && (
            <div className="panel guide" style={{ marginTop: '1.5rem' }}>
              <h2>Build guide</h2>
              {guide.summary && <p className="desc">{guide.summary}</p>}
              {guide.printSettings && <p className="guide-settings"><strong>Settings:</strong> {guide.printSettings}</p>}
              {(guide.materials?.length > 0 || guide.tools?.length > 0) && (
                <div className="guide-lists">
                  {guide.materials?.length > 0 && <div><h3>Materials</h3><ul>{guide.materials.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
                  {guide.tools?.length > 0 && <div><h3>Tools</h3><ul>{guide.tools.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                </div>
              )}
              {guide.steps?.length > 0 && (
                <ol className="guide-steps">
                  {guide.steps.map((s, i) => {
                    const img = s.imageFile && imageById.get(s.imageFile);
                    return (
                      <li key={i}>
                        {s.title && <h3>{s.title}</h3>}
                        {s.body && <p className="desc">{s.body}</p>}
                        {img && <a href={fileUrl(img.viewUrl)} target="_blank" rel="noreferrer">
                          <img className="step-photo" src={fileUrl(img.viewUrl)} alt={img.caption || `Step ${i + 1}`} /></a>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          <div className="panel" style={{ marginTop: '1.5rem' }}>
            <h2>Comments ({d.comments.length})</h2>
            {d.comments.map(c => (
              <div className="comment" key={c._id}>
                <span className="who">{c.author?.username
                  ? <Link to={`/user/${c.author.username}`}>{c.author.username}</Link>
                  : 'deleted'}</span><span className="when">{fmtDate(c.createdAt)}</span>
                {user && (user.id === c.author?._id || mine) &&
                  <button className="btn btn-ghost btn-sm" style={{ float: 'right' }} onClick={() => delComment(c._id)}>Delete</button>}
                <p>{c.body}</p>
              </div>
            ))}
            <form onSubmit={postComment} style={{ marginTop: '1rem' }}>
              <div className="field">
                <label htmlFor="c">{user ? 'Add a comment' : 'Log in to comment'}</label>
                <textarea id="c" required disabled={!user} style={{ minHeight: '5rem' }} value={comment} onChange={e => setComment(e.target.value)} />
              </div>
              <button className="btn btn-primary btn-sm" disabled={!user}>Post</button>
            </form>
          </div>
        </div>

        <aside>
          <div className="panel">
            <h2>Files</h2>
            {d.files.length === 0 ? <p className="stat">No files hosted here. See the links below.</p> : (
              FILE_GROUPS.map(([kind, label]) => {
                const group = d.files.filter(f => (f.kind || 'other') === kind);
                if (!group.length) return null;
                return (
                  <div className="file-group" key={kind}>
                    <h3>{label}</h3>
                    <ul className="file-list">
                      {group.map(f => (
                        <li key={f._id}>
                          <span className="file-name">
                            <a href={fileUrl(f.url)} onClick={() => setTimeout(load, 800)}>{f.originalName}</a>
                            {f.caption && <small>{f.caption}</small>}
                          </span>
                          <span className="size">{fmtSize(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>

          {d.links?.length > 0 && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2>Elsewhere</h2>
              {LINK_GROUPS.map(([kind, label]) => {
                const group = d.links.filter(l => (l.kind || 'other') === kind);
                if (!group.length) return null;
                return (
                  <div className="file-group" key={kind}>
                    <h3>{label}</h3>
                    <ul className="file-list">
                      {group.map(l => (
                        <li key={l._id}>
                          <span className="file-name">
                            <a href={l.url} target="_blank" rel="noreferrer nofollow">{l.label}</a>
                            <small>{host(l.url)}{l.note ? ` · ${l.note}` : ''}</small>
                          </span>
                          <span className="size" aria-hidden="true">↗</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          <div className="panel" style={{ marginTop: '1.5rem' }}>
            <h2>Version history</h2>
            <ol className="history">
              {timeline.map(v => (
                <li key={v.version}>
                  <div className="history-head">
                    <strong>v{v.version}</strong>
                    {v.version === d.version && <span className="tag">current</span>}
                    <span className="stat">{fmtDate(v.at)}{v.by ? ` · ${v.by}` : ''}</span>
                  </div>
                  {v.changes.length > 0 && <ul className="history-changes">{v.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                  {v.note && <p className="history-note">“{v.note}”</p>}
                  {v.snapshot?.files.length > 0 && (
                    <details className="history-files">
                      <summary>Files as of v{v.snapshot.version}</summary>
                      <ul className="file-list">
                        {v.snapshot.files.map(f => (
                          <li key={f._id}>
                            <a href={fileUrl(f.url)}>{f.originalName}</a>
                            <span className="size">{fmtSize(f.size)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
