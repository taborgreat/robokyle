import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl, avatarUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ProducedSection from '../ProducedSection.jsx';
import DocRevisions from '../DocRevisions.jsx';
import ErrorBar from '../ErrorBar.jsx';

const fmtSize = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtExact = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });

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
  const [forking, setForking] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagWhy, setFlagWhy] = useState('');
  const [flagCats, setFlagCats] = useState([]);
  const [cWhyFor, setCWhyFor] = useState(null);   // comment id awaiting a downvote reason
  const [cWhy, setCWhy] = useState('');
  const [config, setConfig] = useState(null);

  const load = () => api(`/designs/${id}`).then(setD).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  useEffect(() => { api('/config').then(setConfig).catch(() => {}); }, []);

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

  // Only a failed LOAD takes the page; a failed action must never blank a
  // loaded work. Those show in the ErrorBar at the bottom of the viewport.
  if (error && !d) return <div className="form-error" role="alert">{error}</div>;
  if (!d) return <p className="empty">Loading…</p>;

  const mine = d.canEdit;
  const lin = d.lineage || { isOriginal: true, familyCount: 1, children: [] };
  const hero = images[Math.min(shot, images.length - 1)];

  // Every reason box shows its bar; a silently disabled button reads as broken.
  const reasonHint = (t) => {
    const n = t.trim().length;
    return <small className="stat">At least 10 characters{n > 0 && n < 10 ? ` (${10 - n} to go)` : ''}.</small>;
  };

  function applyVotes(r) {
    setD({ ...d, upvoted: r.upvoted, downvoted: r.downvoted,
           upvoteCount: r.upvoteCount, downvoteCount: r.downvoteCount,
           reasonCards: r.reasonCards ?? d.reasonCards });
  }
  async function vote(direction) {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    setError('');
    // A downvote is a claim: casting one opens the why-box instead of firing.
    if (direction === 'downvote' && !d.downvoted) { setWhyOpen(o => !o); return; }
    try { applyVotes(await api(`/designs/${id}/${direction}`, { method: 'POST' })); }
    catch (err) { setError(err.message); }
  }
  async function submitWhy(e) {
    e.preventDefault();
    try {
      applyVotes(await api(`/designs/${id}/downvote`, { method: 'POST', body: { reason: why } }));
      setWhyOpen(false); setWhy('');
    } catch (err) { setError(err.message); }
  }
  async function judgeReason(rid, dir) {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    try {
      setError('');
      const r = await api(`/designs/${id}/reasons/${rid}/vote`, { method: 'POST', body: { dir } });
      setD({ ...d, reasonCards: r.reasonCards });
    } catch (err) { setError(err.message); }
  }
  async function postComment(e) {
    e.preventDefault();
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    try {
      setError('');
      const c = await api(`/designs/${id}/comments`, { method: 'POST', body: { body: comment } });
      setD({ ...d, comments: [...d.comments, c] }); setComment('');
    } catch (err) { setError(err.message); }
  }
  async function delComment(cid) {
    try {
      setError('');
      await api(`/designs/${id}/comments/${cid}`, { method: 'DELETE' });
      setD({ ...d, comments: d.comments.filter(c => c._id !== cid) });
    } catch (err) { setError(err.message); }
  }
  async function voteWorkComment(c, dir, reason) {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    if (dir === 'down' && !c.downvoted && reason === undefined) { setCWhyFor(cWhyFor === c._id ? null : c._id); return; }
    try {
      setError('');
      await api(`/designs/${id}/comments/${c._id}/vote`, { method: 'POST', body: { dir, reason } });
      setCWhyFor(null); setCWhy('');
      await load();
    } catch (err) { setError(err.message); }
  }
  async function judgeWorkCommentReason(cid, rid, dir) {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    try {
      await api(`/designs/${id}/comments/${cid}/reasons/${rid}/vote`, { method: 'POST', body: { dir } });
      await load();
    } catch (err) { setError(err.message); }
  }
  function toggleFlagCat(cid) {
    let next = flagCats.some(c => c.id === cid) ? flagCats.filter(c => c.id !== cid) : [...flagCats, { id: cid, weight: 0 }];
    if (next.length > (config?.xp?.declaration?.max || 4)) return;
    const even = Math.floor(100 / (next.length || 1));
    setFlagCats(next.map((c, i) => ({ ...c, weight: i === 0 ? 100 - even * (next.length - 1) : even })));
  }
  async function submitFlag(e) {
    e.preventDefault();
    try {
      const r = await api(`/designs/${id}/disputes`, { method: 'POST', body: { reason: flagWhy, categories: flagCats } });
      setD({ ...d, disputes: r.disputes });
      setFlagOpen(false); setFlagWhy(''); setFlagCats([]);
    } catch (err) { setError(err.message); }
  }
  async function judgeDispute(did, dir) {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    try {
      setError('');
      const r = await api(`/designs/${id}/disputes/${did}/vote`, { method: 'POST', body: { dir } });
      setD({ ...d, disputes: r.disputes, categories: r.categories });
    } catch (err) { setError(err.message); }
  }

  async function buildOnThis() {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    setForking(true);
    try {
      const copy = await api(`/designs/${id}/fork`, { method: 'POST', body: { title: `${d.title} (revision)` } });
      nav(`/works/${copy.id}/edit`);
    } catch (err) { setError(err.message); }
    finally { setForking(false); }
  }

  async function delDesign() {
    if (!confirm('Delete this work and all its files?')) return;
    await api(`/designs/${id}`, { method: 'DELETE' }); nav('/works');
  }

  async function verifyPort(portId, undo) {
    if (!user) return nav('/login', { state: { from: `/works/${id}` } });
    try {
      setError('');
      await api(`/designs/${id}/ports/${portId}/verify`, { method: undo ? 'DELETE' : 'POST' });
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <ErrorBar error={error} onDismiss={() => setError('')} />
      <p><Link to="/works">&larr; All works</Link></p>
      <div className="app-head">
        <div>
          <h1>{d.title}</h1>
          <span className="stat">by <Link to={`/user/${d.author.username}`}><strong>{d.author.username}</strong></Link>{d.author.roboXp > 0 && <span className="roboxp" title="RoboXP: verified value produced"> {Math.round(d.author.roboXp).toLocaleString()} RoboXP</span>} · v{d.version} · updated {fmtDate(d.updatedAt)} · {d.downloadCount} downloads</span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className={'btn btn-ghost vote' + (d.upvoted ? ' on' : '')} onClick={() => vote('upvote')} aria-pressed={d.upvoted}>▲ {d.upvoteCount}</button>
          <button className={'btn btn-ghost vote vote-down' + (d.downvoted ? ' on' : '')} onClick={() => vote('downvote')} aria-pressed={d.downvoted}>▼ {d.downvoteCount || 0}</button>
          {mine && <Link className="btn btn-ghost" to={`/works/${id}/edit`}>Edit</Link>}
          {mine && <button className="btn btn-danger" onClick={delDesign}>Delete</button>}
        </div>
      </div>

      {whyOpen && (
        <form className="panel why-box" onSubmit={submitWhy}>
          <label htmlFor="why"><strong>Why?</strong> Required. Posted without your name, so don't sign it.</label>
          <textarea id="why" required minLength={10} maxLength={2000} value={why}
                    onChange={e => setWhy(e.target.value)}
                    placeholder="What specifically is wrong? Your reason appears in the thread and the community judges it." />
          {reasonHint(why)}
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn btn-danger btn-sm" disabled={why.trim().length < 10}>Downvote with this reason</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWhyOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

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

          <div className="panel lineage">
            {lin.isOriginal
              ? <p className="stat">Original work{lin.familyCount > 1 && <> · {lin.familyCount - 1} {lin.familyCount === 2 ? 'revision' : 'revisions'} built on it</>}</p>
              : <p className="stat">
                  Built on{' '}
                  {lin.parent
                    ? <><Link to={`/works/${lin.parent.id}`}>{lin.parent.title}</Link> v{lin.parent.version} by{' '}
                        <Link to={`/user/${lin.parent.author}`}>{lin.parent.author}</Link></>
                    : <em>a work that has since been removed</em>}
                </p>}
            <div className="toolbar" style={{ margin: '.75rem 0 0' }}>
              <button className="btn btn-sm btn-build" onClick={buildOnThis} disabled={forking}>
                {forking ? 'Copying…' : 'Build on this'}
              </button>
              {lin.familyCount > 1 && <Link className="btn btn-ghost btn-sm" to={`/works/${id}/tree`}>See all {lin.familyCount} versions</Link>}
              <Link className="btn btn-ghost btn-sm" to={`/talk?work=${id}`}>Threads about this</Link>
              <Link className="btn btn-ghost btn-sm" to={`/talk/new?work=${id}`}>Start one</Link>
            </div>
          </div>

          <div className="panel">
            <p className="desc">{d.description}</p>
            <div className="meta" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {(d.categories || []).map(c => <span key={c.id} className="tag cat-tag">{c.id} {c.weight}%</span>)}
              {(d.needTags || []).map(t => <Link key={t} className="tag need-tag" to={`/works?q=${encodeURIComponent(t)}`}>{t}</Link>)}
              {(d.facets || []).map(f => <Link key={f} className="tag" to={`/works?facet=${f}`}>{f}</Link>)}
              {d.tags.map(t => <Link key={t} className="tag" to={`/works?tag=${encodeURIComponent(t)}`}>{t}</Link>)}
              {d.canDispute && (
                <button type="button" className="link-btn flag-btn" onClick={() => setFlagOpen(o => !o)}
                        title="Think these categories are wrong? Propose a correction; the community judges it.">
                  flag categories
                </button>
              )}
            </div>

            {flagOpen && (
              <form className="flag-box" onSubmit={submitFlag}>
                <label htmlFor="fw"><strong>Wrong categories?</strong> Say why and propose the right split.
                  Posted without your name; the community judges the claim, and if it is endorsed the
                  declaration is corrected and all XP re-routes.</label>
                <textarea id="fw" required minLength={10} maxLength={2000} value={flagWhy}
                          onChange={e => setFlagWhy(e.target.value)}
                          placeholder="What is miscategorized, and how can you tell?" />
                {reasonHint(flagWhy)}
                <div className="cat-picker">
                  {(config?.xp?.categories || []).filter(c => !c.hidden).map(c => {
                    const chosen = flagCats.find(x => x.id === c.id);
                    return (
                      <div key={c.id} className={'cat-chip' + (chosen ? ' on' : '')}>
                        <button type="button" className="cat-toggle" aria-pressed={!!chosen} onClick={() => toggleFlagCat(c.id)}>{c.name}</button>
                        {chosen && <input type="number" min="1" max="100" aria-label={`${c.name} weight`} value={chosen.weight}
                                          onChange={e => setFlagCats(flagCats.map(x => x.id === c.id ? { ...x, weight: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) } : x))} />}
                      </div>
                    );
                  })}
                </div>
                <div className="toolbar" style={{ margin: 0 }}>
                  <button className="btn btn-danger btn-sm"
                          disabled={flagWhy.trim().length < 10 || !flagCats.length || flagCats.reduce((a, c) => a + c.weight, 0) !== 100}>
                    Flag with this correction
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlagOpen(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>

          {d.type === 'standard' && d.standard && (
            <div className="panel port-std-panel" style={{ marginTop: '1.5rem' }}>
              <h2>Interface: <code>{d.standard.portName}</code></h2>
              <p className="stat">This work defines a standard. Works declare that they provide or accept it; the hub shows the whole ecosystem.</p>
              {d.standard.fields?.length > 0 && (
                <ul className="port-field-list">
                  {d.standard.fields.map(f => (
                    <li key={f.name}><code>{f.name}</code>{f.unit && <span className="stat"> ({f.unit})</span>}{f.required && <span className="required-mark">required</span>}</li>
                  ))}
                </ul>
              )}
              <Link className="btn btn-primary btn-sm" to={`/works/${id}/hub`}>Open the port hub →</Link>
            </div>
          )}

          {(d.ports?.provides?.length > 0 || d.ports?.accepts?.length > 0) && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2>Ports</h2>
              {d.ports.provides.length > 0 && (
                <div className="port-group">
                  <span className="stat">Provides</span>
                  {d.ports.provides.map(p => (
                    <div key={p.id} className={'port-chip-row' + (p.status === 'verified' ? ' is-verified' : '')}>
                      {p.missing
                        ? <span className="stat">a standard that has since been removed</span>
                        : <>
                            <Link className="tag port-chip" to={`/works/${p.standard}/hub`}
                                  title={`${p.title}: open the hub`}>
                              {p.portName || p.title} {p.status === 'verified' ? '✓' : ''}
                            </Link>
                            <span className="stat">
                              {p.status === 'verified' ? 'verified' : 'claimed'}
                              {p.pinnedVersion ? ` · pinned to v${p.pinnedVersion}` : ''}
                              {Object.entries(p.fieldValues || {}).map(([k, v]) => ` · ${k}: ${v}`).join('')}
                            </span>
                            {p.canVerify && <button className="link-btn" title="You have standing in this field: does the work really offer this interface?"
                                                    onClick={() => verifyPort(p.id, false)}>verify</button>}
                            {p.canUnverify && <button className="link-btn" onClick={() => verifyPort(p.id, true)}>withdraw verification</button>}
                          </>}
                    </div>
                  ))}
                </div>
              )}
              {d.ports.accepts.length > 0 && (
                <div className="port-group">
                  <span className="stat">Accepts</span>
                  {d.ports.accepts.map(a => (
                    a.missing
                      ? <span key={a.id} className="stat">a standard that has since been removed</span>
                      : <Link key={a.id} className="tag port-chip" to={`/works/${a.standard}/hub`}
                              title={`${a.title}: open the hub`}>{a.portName || a.title}</Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {d.uses?.length > 0 && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2>Built from</h2>
              <ul className="part-list">
                {d.uses.map(c => (
                  <li key={String(c.id)}>
                    {c.missing
                      ? <span className="stat">A part that has since been removed</span>
                      : <>
                          <div className="part-head">
                            <Link to={`/works/${c.id}`}><strong>{c.title}</strong></Link>
                            {c.label && <span className="stat">as {c.label}</span>}
                          </div>
                          <span className="stat">
                            by <Link to={`/user/${c.author}`}>{c.author}</Link>
                            {c.follows
                              ? <> · follows the latest, now v{c.latestVersion}</>
                              : <> · pinned to v{c.pinnedVersion}
                                  {c.behind && <span className="tag behind"> v{c.latestVersion} available</span>}</>}
                            {(c.mates || []).map(m => (
                              <Link key={m.standard} className="tag endorsed-tag" to={`/works/${m.standard}/hub`}
                                    title="This part provides an interface this work accepts">
                                {' '}✓ mates via {m.portName || 'a shared port'}
                              </Link>
                            ))}
                          </span>
                          {c.note && <p className="desc">{c.note}</p>}
                        </>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(d.effectiveRequires && (d.effectiveRequires.equipment.length > 0 || d.effectiveRequires.materials.length > 0)) && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2>What building it takes</h2>
              {d.readiness && (
                <p className={'stat readiness ' + (d.readiness.buildable ? 'ok' : 'gap')}>
                  {d.readiness.buildable
                    ? 'Buildable with your equipment.'
                    : `Missing from your equipment: ${d.readiness.missing.join(', ')}`}
                </p>
              )}
              {d.effectiveRequires.equipment.length > 0 && (
                <>
                  <h3 className="req-h">Equipment</h3>
                  <ul className="req-list">
                    {d.effectiveRequires.equipment.map(e => (
                      <li key={e.item}>{e.item}{e.note && <span className="stat"> ({e.note})</span>}
                        {e.from?.length > 0 && <span className="stat"> via {e.from.join(', ')}</span>}</li>
                    ))}
                  </ul>
                </>
              )}
              {d.effectiveRequires.materials.length > 0 && (
                <>
                  <h3 className="req-h">Materials</h3>
                  <ul className="req-list">
                    {d.effectiveRequires.materials.map((m, i) => (
                      <li key={i}>{m.item}: {m.qty} {m.unit}
                        {m.from?.length > 0 && <span className="stat"> via {m.from.join(', ')}</span>}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {d.usedIn?.length > 0 && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2>Used in ({d.usedIn.length})</h2>
              <ul className="revision-list">
                {d.usedIn.map(w => (
                  <li key={String(w.id)}>
                    <Link to={`/works/${w.id}`}>{w.title}</Link>
                    <span className="stat"> by <Link to={`/user/${w.author}`}>{w.author}</Link></span>
                  </li>
                ))}
              </ul>
              <p className="stat" style={{ marginTop: '.5rem' }}>
                Improving this work improves every build that follows it.
              </p>
            </div>
          )}

          {d.steps?.length > 0 && (
            <div className="panel guide" style={{ marginTop: '1.5rem' }}>
              <h2>How it is made</h2>
              <ol className="guide-steps">
                {d.steps.map((st, i) => (
                  <li key={st.id || i}>
                    {st.workRef ? (
                      st.workRef.missing
                        ? <p className="stat"><em>This step referenced a work that has since been removed.</em></p>
                        : <div className="ref-step-card">
                            <h3><Link to={`/works/${st.workRef.id}`}>{st.title || `Build the ${st.workRef.title}`} &rarr;</Link></h3>
                            <span className="stat">
                              {st.workRef.title} by <Link to={`/user/${st.workRef.author}`}>{st.workRef.author}</Link>
                              {st.workRef.follows
                                ? <> · follows the latest (v{st.workRef.latestVersion})</>
                                : <> · pinned to v{st.workRef.pinnedVersion}{st.workRef.behind && <span className="tag behind"> v{st.workRef.latestVersion} available</span>}</>}
                            </span>
                          </div>
                    ) : (
                      <>
                        {st.title && <h3>{st.title}{st.duration && <span className="tag" style={{ marginLeft: '.5rem' }}>{st.duration}</span>}</h3>}
                        {st.body && <p className="desc">{st.body}</p>}
                        {st.needs?.length > 0 && <p className="stat">You will need: {st.needs.join(', ')}</p>}
                        {st.attachments.filter(f => f.viewUrl).map(f => (
                          <a key={f._id} href={fileUrl(f.viewUrl)} target="_blank" rel="noreferrer">
                            <img className="step-photo" src={fileUrl(f.viewUrl)} alt={f.caption || st.title || `Step ${i + 1}`} />
                          </a>
                        ))}
                        {st.attachments.filter(f => !f.viewUrl).length > 0 && (
                          <ul className="step-files">
                            {st.attachments.filter(f => !f.viewUrl).map(f => (
                              <li key={f._id}>
                                <a href={fileUrl(f.url)}>{f.originalName}</a>
                                <span className="stat"> {fmtSize(f.size)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {(st.links || []).filter(l => l.image).map((l, k) => (
                          <a key={l.url + k} href={l.url} target="_blank" rel="noreferrer nofollow">
                            <img className="step-photo" src={l.url} alt={l.label || st.title || `Step ${i + 1}`} loading="lazy" />
                          </a>
                        ))}
                        {(st.links || []).filter(l => !l.image).length > 0 && (
                          <ul className="step-files">
                            {(st.links || []).filter(l => !l.image).map((l, k) => (
                              <li key={l.url + k}>
                                <a href={l.url} target="_blank" rel="noreferrer nofollow">{l.label}</a>
                                <span className="stat"> {host(l.url)}{l.note ? ` · ${l.note}` : ''} ↗</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <ProducedSection workId={id} workVersion={d.version} user={user}
                           onNeedLogin={() => nav('/login', { state: { from: `/works/${id}` } })} />

          <DocRevisions workId={id} steps={d.steps} user={user} isAuthor={mine}
                        onApplied={load}
                        onNeedLogin={() => nav('/login', { state: { from: `/works/${id}` } })} />

          <div className="panel" style={{ marginTop: '1.5rem' }}>
            <h2>Comments ({d.comments.length + (d.reasonCards?.length || 0)})</h2>
            {(d.disputes || []).map(c => (
              <div key={c.id} className={`reason-card dispute-card is-${c.state}`}>
                <span className="reason-label">
                  Category dispute
                  {c.applied && <span className="tag endorsed-tag">endorsed and applied</span>}
                  {!c.applied && c.state === 'struck' && <span className="tag">struck</span>}
                  {c.mine && <span className="tag">yours</span>}
                </span>
                <p>{c.text}</p>
                <p className="stat">
                  Proposes {c.proposed.map(x => `${x.id} ${x.weight}%`).join(', ')}
                  {' '}(was {c.previous.map(x => `${x.id} ${x.weight}%`).join(', ')})
                </p>
                <span className="reason-judge">
                  <button className={'link-btn' + (c.myVote === 1 ? ' on' : '')} disabled={c.frozen}
                          onClick={() => judgeDispute(c.id, 1)} title="The flag is right">agree</button>
                  <button className={'link-btn' + (c.myVote === -1 ? ' on' : '')} disabled={c.frozen}
                          onClick={() => judgeDispute(c.id, -1)} title="The declaration is fine">disagree</button>
                  <span className="stat">{c.voteCount} {c.voteCount === 1 ? 'judgment' : 'judgments'}{c.frozen && ' (final)'}</span>
                </span>
              </div>
            ))}
            {(d.reasonCards || []).map(c => (
              <div key={c.id} className={`reason-card is-${c.state}`}>
                <span className="reason-label">
                  Downvote reason
                  {c.state === 'endorsed' && <span className="tag endorsed-tag">community-endorsed</span>}
                  {c.state === 'struck' && <span className="tag">struck</span>}
                  {c.mine && <span className="tag">yours</span>}
                </span>
                <p>{c.text}</p>
                <span className="reason-judge">
                  <button className={'link-btn' + (c.myVote === 1 ? ' on' : '')} disabled={c.frozen}
                          onClick={() => judgeReason(c.id, 1)} title="This objection is fair">▲</button>
                  <button className={'link-btn' + (c.myVote === -1 ? ' on' : '')} disabled={c.frozen}
                          onClick={() => judgeReason(c.id, -1)} title="This objection is bad faith">▼</button>
                  <span className="stat">{c.voteCount} {c.voteCount === 1 ? 'judgment' : 'judgments'}{c.frozen && ' · final'}</span>
                </span>
              </div>
            ))}
            {d.comments.map(c => (
              <div className="comment" key={c._id}>
                <span className="who">{c.author?.username
                  ? <>
                      <img className="avatar-sm" src={avatarUrl(c.author.username)} alt="" width="22" height="22" loading="lazy" />
                      <Link to={`/user/${c.author.username}`}>{c.author.username}</Link>
                      {c.author.chip && (c.author.chip.newUser
                        ? <span className="tag chip-new">new user</span>
                        : <span className="tag user-chip" style={{ '--cat': c.author.chip.color }}>
                            {c.author.chip.title} · {c.author.chip.name} {c.author.chip.level}
                          </span>)}
                    </>
                  : 'deleted'}</span><span className="when" title={fmtExact(c.createdAt)}>{fmtWhen(c.createdAt)}</span>
                {user && (user.id === c.author?._id || mine) &&
                  <button className="btn btn-ghost btn-sm" style={{ float: 'right' }} onClick={() => delComment(c._id)}>Delete</button>}
                <p>{c.body}</p>
                {/* Part III: comments are accountability targets — votable at
                    display stakes, downvotes carry reason cards, zero XP. */}
                <span className="toolbar talk-comment-tools">
                  <button className={'link-btn' + (c.upvoted ? ' on' : '')} onClick={() => voteWorkComment(c, 'up')}>▲ {c.upvoteCount || 0}</button>
                  <button className={'link-btn' + (c.downvoted ? ' on' : '')} onClick={() => voteWorkComment(c, 'down')}>▼ {c.downvoteCount || 0}</button>
                </span>
                {cWhyFor === c._id && (
                  <form className="panel why-box" onSubmit={e => { e.preventDefault(); voteWorkComment(c, 'down', cWhy); }}>
                    <label><strong>Why?</strong> Required. Posted without your name.</label>
                    <textarea required minLength={10} maxLength={2000} value={cWhy} onChange={e => setCWhy(e.target.value)} />
                    {reasonHint(cWhy)}
                    <div className="toolbar" style={{ margin: 0 }}>
                      <button className="btn btn-danger btn-sm" disabled={cWhy.trim().length < 10}>Downvote with this reason</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCWhyFor(null)}>Cancel</button>
                    </div>
                  </form>
                )}
                {(c.reasonCards || []).map(rc => (
                  <div key={rc.id} className={`reason-card is-${rc.state}`}>
                    <span className="reason-label">Downvote reason
                      {rc.state === 'endorsed' && <span className="tag endorsed-tag">community-endorsed</span>}
                      {rc.state === 'struck' && <span className="tag">struck</span>}
                      {rc.mine && <span className="tag">yours</span>}
                    </span>
                    <p>{rc.text}</p>
                    <span className="reason-judge">
                      <button className={'link-btn' + (rc.myVote === 1 ? ' on' : '')} disabled={rc.frozen}
                              onClick={() => judgeWorkCommentReason(c._id, rc.id, 1)} title="This objection is fair">▲</button>
                      <button className={'link-btn' + (rc.myVote === -1 ? ' on' : '')} disabled={rc.frozen}
                              onClick={() => judgeWorkCommentReason(c._id, rc.id, -1)} title="This objection is bad faith">▼</button>
                      <span className="stat">{rc.voteCount} {rc.voteCount === 1 ? 'judgment' : 'judgments'}{rc.frozen && ' · final'}</span>
                    </span>
                  </div>
                ))}
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
                    <span className="stat" title={fmtExact(v.at)}>{fmtWhen(v.at)}{v.by ? ` · ${v.by}` : ''}</span>
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
