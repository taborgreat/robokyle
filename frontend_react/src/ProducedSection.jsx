import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fileUrl, avatarUrl } from './lib/api.js';

/* Produced (Part II): the gallery of real-world results on a work — the
   difference between "looks nice in CAD" and "exists on a kitchen table
   helping someone eat". Posting is as easy as commenting; entries verify
   after the challenge window; failures are first-class data and are never
   hidden by default. */

const fmtWhen = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const TYPE_LABEL = { physical: 'built it', deployment: 'running live', usage: 'in real use' };
const OUTCOME_TAG = { success: ['worked', 'endorsed-tag'], modified: ['worked, modified', ''], failed: ['failed', 'behind'] };

export default function ProducedSection({ workId, workVersion, user, onNeedLogin, openSignal }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [whyFor, setWhyFor] = useState(null);        // entry id awaiting a downvote reason
  const [challengeFor, setChallengeFor] = useState(null);

  /* The frame's Actions panel owns the "I built one" button (§10): each
     press signals here — open the form and bring the section into view. */
  useEffect(() => {
    if (!openSignal) return;
    setFormOpen(true);
    document.getElementById('produced-section')?.scrollIntoView({ block: 'start' });
  }, [openSignal]);
  const [commentFor, setCommentFor] = useState(null);

  const load = () => api(`/designs/${workId}/produced`).then(setData).catch(e => setError(e.message));
  useEffect(() => { load(); }, [workId]);

  const act = (fn) => async (...args) => {
    if (!user) return onNeedLogin();
    try { setError(''); await fn(...args); await load(); }
    catch (err) { setError(err.message); }
  };
  const vote = act(async (entry, dir, reason) => {
    if (dir === 'down' && !entry.downvoted && reason === undefined) { setWhyFor(whyFor === entry.id ? null : entry.id); return; }
    await api(`/designs/${workId}/produced/${entry.id}/vote`, { method: 'POST', body: { dir, reason } });
    setWhyFor(null);
  });
  const judgeReason = act((eid, rid, dir) =>
    api(`/designs/${workId}/produced/${eid}/reasons/${rid}/vote`, { method: 'POST', body: { dir } }));
  const challenge = act(async (eid, reason) => {
    await api(`/designs/${workId}/produced/${eid}/challenge`, { method: 'POST', body: { reason } });
    setChallengeFor(null);
  });
  const judgeChallenge = act((eid, cid, dir) =>
    api(`/designs/${workId}/produced/${eid}/challenges/${cid}/vote`, { method: 'POST', body: { dir } }));
  const remove = act(async (eid) => {
    if (!confirm('Remove this result?')) return;
    await api(`/designs/${workId}/produced/${eid}`, { method: 'DELETE' });
  });
  const comment = act(async (eid, body) => {
    await api(`/designs/${workId}/produced/${eid}/comments`, { method: 'POST', body: { body } });
  });

  if (error && !data) return <div className="form-error" role="alert">{error}</div>;
  if (!data) return null;

  const o = data.outcomes;
  const totalOutcomes = o.success + o.modified + o.failed;

  return (
    <div className="panel" id="produced-section" style={{ marginTop: '1.5rem' }}>
      <div className="produced-head">
        <h2>Produced {data.producedCount > 0 && <span className="tag endorsed-tag"><span className="rs-num">{data.producedCount}</span> verified {data.producedCount === 1 ? 'time' : 'times'}</span>}</h2>
        {user && !data.canPost &&
          <span className="stat">Posting results opens once your account has a little history.</span>}
      </div>

      {totalOutcomes > 0 && (
        <div className="outcome-bar" role="img"
             aria-label={`${o.success} succeeded, ${o.modified} modified, ${o.failed} failed`}
             title={`${o.success} succeeded · ${o.modified} needed modification · ${o.failed} failed`}>
          {o.success > 0 && <span className="oc-success" style={{ flex: o.success }} />}
          {o.modified > 0 && <span className="oc-modified" style={{ flex: o.modified }} />}
          {o.failed > 0 && <span className="oc-failed" style={{ flex: o.failed }} />}
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}
      {formOpen && <EntryForm workId={workId} onDone={() => { setFormOpen(false); load(); }} onCancel={() => setFormOpen(false)} />}

      {data.items.length === 0 && !formOpen && (
        <p className="stat">No results yet.{' '}
          {(!user || data.canPost)
            ? <button type="button" className="link-btn" onClick={() => user ? setFormOpen(true) : onNeedLogin()}>
                The first photo of this thing existing in the world
              </button>
            : <>The first photo of this thing existing in the world</>}
          {' '}is the strongest endorsement it can get.</p>
      )}

      {data.items.map(e => {
        const [label, cls] = OUTCOME_TAG[e.outcome] || [e.outcome, ''];
        return (
          <div key={e.id} className={'produced-entry' + (e.state === 'rejected' ? ' is-rejected' : '')}>
            <div className="produced-meta">
              {e.poster && <>
                <img className="avatar-sm" src={avatarUrl(e.poster.username, 22)} alt="" width="22" height="22" loading="lazy" />
                <Link to={`/user/${e.poster.username}`}>{e.poster.username}</Link>
              </>}
              <span className="stat">{TYPE_LABEL[e.type]} · v{e.workVersion} · {fmtWhen(e.createdAt)}</span>
              <span className={`tag ${cls}`}>{label}</span>
              {e.state === 'pending' && <span className="tag" title="Inside the challenge window">unverified yet</span>}
              {e.state === 'rejected' && <span className="tag">challenged out</span>}
              {e.type === 'deployment' && e.linkStatus?.checkedAt &&
                <span className={'tag' + (e.linkStatus.ok ? ' endorsed-tag' : ' behind')}>{e.linkStatus.ok ? 'live' : 'offline'}</span>}
            </div>
            {e.media.length > 0 && (
              <div className="produced-media">
                {e.media.map(m => (
                  <a key={m.id} href={fileUrl(m.url)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(m.url)} alt={m.name} loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            {e.link && <p className="stat"><a href={e.link} target="_blank" rel="noreferrer nofollow">{e.link}</a></p>}
            {e.process && <p className="desc">{e.process}</p>}
            {e.modifications && <p className="desc"><strong>Modified:</strong> {e.modifications}</p>}
            {e.fitFindings && <p className="desc"><strong>Fit:</strong> {e.fitFindings}</p>}

            <span className="toolbar talk-comment-tools">
              <button className={'link-btn' + (e.upvoted ? ' on' : '')} title="Upvote a useful result"
                      onClick={() => vote(e, 'up')}>▲ <span className="rs-num">{e.upvoteCount}</span></button>
              <button className={'link-btn' + (e.downvoted ? ' on' : '')}
                      onClick={() => vote(e, 'down')}>▼ <span className="rs-num">{e.downvoteCount || 0}</span></button>
              <button className="link-btn" onClick={() => setCommentFor(commentFor === e.id ? null : e.id)}>
                {e.comments.length ? `${e.comments.length} comment${e.comments.length === 1 ? '' : 's'}` : 'Comment'}
              </button>
              {e.canChallenge && <button className="link-btn" title="Claim this result is not genuine"
                      onClick={() => setChallengeFor(challengeFor === e.id ? null : e.id)}>Challenge</button>}
              {e.canDelete && <button className="link-btn" onClick={() => remove(e.id)}>Delete</button>}
            </span>

            {whyFor === e.id && (
              <ReasonBox label="Why was this result unhelpful?" cta="Downvote with this reason"
                         onSubmit={(t) => vote(e, 'down', t)} onCancel={() => setWhyFor(null)} />
            )}
            {challengeFor === e.id && (
              <ReasonBox label="What makes this result not genuine? The community judges the claim, and a false challenge is judged too."
                         cta="Challenge this entry" onSubmit={(t) => challenge(e.id, t)} onCancel={() => setChallengeFor(null)} />
            )}
            {e.reasonCards.map(c => (
              <JudgedCard key={c.id} c={c} label="Downvote reason" onJudge={(dir) => judgeReason(e.id, c.id, dir)}
                          onRemove={() => vote(e, 'down')} />
            ))}
            {e.challenges.map(c => (
              <JudgedCard key={c.id} c={c} label="Challenge"
                          endorsedLabel="upheld, entry rejected" struckLabel="struck, entry stands"
                          onJudge={(dir) => judgeChallenge(e.id, c.id, dir)} />
            ))}
            {commentFor === e.id && (
              <EntryComments entry={e} user={user} onPost={(body) => comment(e.id, body)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReasonBox({ label, cta, onSubmit, onCancel }) {
  const [text, setText] = useState('');
  return (
    <form className="panel why-box" onSubmit={(ev) => { ev.preventDefault(); onSubmit(text); }}>
      <label><strong>{label}</strong> Posted without your name.</label>
      <textarea required minLength={10} maxLength={2000} value={text} onChange={e => setText(e.target.value)} />
      <small className="stat">At least 10 characters{text.trim().length > 0 && text.trim().length < 10 ? ` (${10 - text.trim().length} to go)` : ''}.</small>
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn btn-danger btn-sm" disabled={text.trim().length < 10}>{cta}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function JudgedCard({ c, label, endorsedLabel = 'community-endorsed', struckLabel = 'struck', onJudge, onRemove }) {
  return (
    <div className={`reason-card is-${c.state}`}>
      <span className="reason-label">
        {label}
        {c.state === 'endorsed' && <span className="tag endorsed-tag">{endorsedLabel}</span>}
        {c.state === 'struck' && <span className="tag">{struckLabel}</span>}
        {c.mine && <span className="tag">yours</span>}
      </span>
      <p>{c.text}</p>
      <span className="reason-judge">
        <button className={'link-btn' + (c.myVote === 1 ? ' on' : '')} disabled={c.frozen} onClick={() => onJudge(1)} title="This claim is fair">▲</button>
        <button className={'link-btn' + (c.myVote === -1 ? ' on' : '')} disabled={c.frozen} onClick={() => onJudge(-1)} title="This claim is bad faith">▼</button>
        <span className="stat"><span className="rs-num">{c.voteCount}</span> {c.voteCount === 1 ? 'judgment' : 'judgments'}{c.frozen && ' · final'}</span>
        {c.mine && c.state !== 'struck' && onRemove && <button className="link-btn" title="Removes the reason and withdraws your downvote"
                onClick={() => { if (confirm('Remove your reason? This withdraws your downvote too.')) onRemove(); }}>Remove</button>}
      </span>
    </div>
  );
}

function EntryComments({ entry, user, onPost }) {
  const [body, setBody] = useState('');
  return (
    <div className="produced-comments">
      {entry.comments.map(c => (
        <div className="comment" key={c._id} id={`c-${c._id}`}>
          <span className="who">{c.author ? <Link to={`/user/${c.author.username}`}>{c.author.username}</Link> : 'deleted'}</span>
          <a className="when" href={`#c-${c._id}`}>{fmtWhen(c.createdAt)}</a>
          <p>{c.body}</p>
        </div>
      ))}
      <form onSubmit={(ev) => { ev.preventDefault(); onPost(body); setBody(''); }}>
        <div className="field">
          <textarea required disabled={!user} placeholder={user ? 'Which nozzle? What settings? Ask here.' : 'Log in to comment'}
                    style={{ minHeight: '3.5rem' }} value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <button className="btn btn-ghost btn-sm" disabled={!user}>Post</button>
      </form>
    </div>
  );
}

/* "I built one": one small form, three result types. */
function EntryForm({ workId, onDone, onCancel }) {
  const [type, setType] = useState('physical');
  const [outcome, setOutcome] = useState('success');
  const [process, setProcess] = useState('');
  const [modifications, setModifications] = useState('');
  const [fitFindings, setFitFindings] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('outcome', outcome);
      fd.append('process', process);
      fd.append('modifications', modifications);
      fd.append('fitFindings', fitFindings);
      fd.append('link', link);
      for (const f of files) fd.append('files', f);
      await api(`/designs/${workId}/produced`, { method: 'POST', form: fd });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <form className="panel produced-form" onSubmit={submit}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="field-row">
        <div className="field"><label>What happened?</label>
          <select aria-label="Kind of result" value={type} onChange={e => setType(e.target.value)}>
            <option value="physical">I built / printed it</option>
            <option value="deployment">I deployed it (software)</option>
            <option value="usage">It is in real use (fit report)</option>
          </select></div>
        <div className="field"><label>Outcome</label>
          <select aria-label="How it went" value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="success">Worked</option>
            <option value="modified">Worked after changes</option>
            <option value="failed">Failed</option>
          </select></div>
      </div>
      {type !== 'deployment' && (
        <div className="field">
          <label>Photos{type === 'physical' && ' (required)'}</label>
          <input type="file" multiple accept="image/*" onChange={e => setFiles([...e.target.files])} />
        </div>
      )}
      {type === 'deployment' && (
        <div className="field"><label>Live link (required)</label>
          <input type="url" required placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} /></div>
      )}
      <div className="field"><label>{type === 'usage' ? 'Context of use' : type === 'deployment' ? 'Hosting / environment' : 'Printer, material, settings'}</label>
        <input maxLength={2000} placeholder={type === 'physical' ? 'Ender 3, PETG, 0.2mm, 40% infill' : ''}
               value={process} onChange={e => setProcess(e.target.value)} /></div>
      {outcome === 'modified' && (
        <div className="field"><label>What did you change? (required)</label>
          <textarea required maxLength={4000} value={modifications} onChange={e => setModifications(e.target.value)} /></div>
      )}
      <div className="field"><label>Fit / usability findings {type === 'usage' ? '(or a photo)' : '(optional)'}</label>
        <textarea maxLength={4000} placeholder="Who used it, what worked, what did not"
                  value={fitFindings} onChange={e => setFitFindings(e.target.value)} /></div>
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Posting…' : 'Post the result'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
