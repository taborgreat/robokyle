import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './lib/api.js';

/* Doc revisions (Part I §5): docs travel with the work, doc skill is portable
   across works. Anyone proposes better words; the author accepts with one
   click or the community's docs-weighted approval clears it after the veto
   window. This panel is both the queue and the "suggest an edit" entry. */

const fmtWhen = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function DocRevisions({ workId, steps, user, isAuthor, onApplied, onNeedLogin }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const load = () => api(`/designs/${workId}/revisions`).then(r => setItems(r.items)).catch(e => setError(e.message));
  useEffect(() => { load(); }, [workId]);

  const act = (fn) => async (...args) => {
    if (!user) return onNeedLogin();
    try { setError(''); await fn(...args); await load(); }
    catch (err) { setError(err.message); }
  };
  const vote = act((rid, dir) => api(`/designs/${workId}/revisions/${rid}/vote`, { method: 'POST', body: { dir } }));
  const decide = act(async (rid, action) => {
    await api(`/designs/${workId}/revisions/${rid}/${action}`, { method: 'POST' });
    if (action === 'accept') onApplied();
  });

  if (!items) return null;
  const open = items.filter(r => r.state === 'open');
  const decided = items.filter(r => r.state !== 'open').slice(0, 5);
  if (!open.length && !decided.length && isAuthor) return null;   // nothing to show the author

  return (
    <div className="panel" style={{ marginTop: '1.5rem' }}>
      <div className="produced-head">
        <h2>Better words {open.length > 0 && <span className="tag">{open.length} pending</span>}</h2>
        {!isAuthor && user && !formOpen &&
          <button className="btn btn-ghost btn-sm" onClick={() => setFormOpen(true)}>Suggest an edit</button>}
      </div>
      <p className="stat">Good product, bad docs? Fix it with your skill: propose clearer instructions, the author accepts in a click, and accepted revisions earn Documentation XP.</p>
      {error && <div className="form-error" role="alert">{error}</div>}

      {formOpen && <RevisionForm workId={workId} steps={steps} onDone={() => { setFormOpen(false); load(); }} onCancel={() => setFormOpen(false)} />}

      {[...open, ...decided].map(r => (
        <div key={r.id} className={'revision-card' + (r.state !== 'open' ? ` is-${r.state}` : '')}>
          <div className="produced-meta">
            {r.author && <Link to={`/user/${r.author.username}`}>{r.author.username}</Link>}
            <span className="stat">
              on {r.target === 'description' ? 'the description' : 'a step'} · {fmtWhen(r.createdAt)}
            </span>
            {r.state === 'applied' && <span className="tag endorsed-tag">accepted</span>}
            {r.state === 'vetoed' && <span className="tag">vetoed</span>}
          </div>
          <details>
            <summary className="stat">proposed text ({r.text.length} chars, was {r.previous.length})</summary>
            <p className="desc revision-text">{r.text}</p>
          </details>
          {r.note && <p className="stat">“{r.note}”</p>}
          {r.state === 'open' && (
            <span className="toolbar talk-comment-tools">
              <button className={'link-btn' + (r.myVote === 1 ? ' on' : '')} disabled={r.mine}
                      onClick={() => vote(r.id, 1)} title="These words are better">▲</button>
              <button className={'link-btn' + (r.myVote === -1 ? ' on' : '')} disabled={r.mine}
                      onClick={() => vote(r.id, -1)} title="Keep the original">▼</button>
              <span className="stat">{r.netApproval} of {r.acceptBar} weighted approval for community acceptance</span>
              {r.canDecide && <>
                <button className="link-btn" onClick={() => decide(r.id, 'accept')}>Accept</button>
                <button className="link-btn" onClick={() => decide(r.id, 'veto')}>Veto</button>
              </>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function RevisionForm({ workId, steps, onDone, onCancel }) {
  const [target, setTarget] = useState('description');
  const [step, setStep] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/designs/${workId}/revisions`, { method: 'POST', body: {
        target, step: target === 'step' ? step : undefined, text, note,
      } });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const editableSteps = (steps || []).filter(s => !s.workRef);
  return (
    <form className="panel produced-form" onSubmit={submit}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="field"><label>What are you improving?</label>
        <select value={target === 'step' ? step : 'description'}
                onChange={e => { const v = e.target.value; if (v === 'description') { setTarget('description'); setStep(''); } else { setTarget('step'); setStep(v); } }}>
          <option value="description">The description</option>
          {editableSteps.map((s, i) => <option key={s.id} value={s.id}>Step {i + 1}: {s.title || '(untitled)'}</option>)}
        </select></div>
      <div className="field"><label>Your version of the text, in full</label>
        <textarea required maxLength={20000} style={{ minHeight: '7rem' }} value={text} onChange={e => setText(e.target.value)} /></div>
      <div className="field"><label>Why it is better (one line)</label>
        <input maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></div>
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Sending…' : 'Propose it'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
