import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, getConfig } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import NeedTagPicker from '../NeedTagPicker.jsx';
import { useTitle } from '../lib/title.js';

/* The composer. Three types, no free-form fourth: everything worth saying is
   about a work, toward a work, or a question (Talk Spec §2). */

const TYPES = [
  { id: 'plan', name: 'Plan', blurb: 'An idea or a call for collaborators. Promote it to a work when it is ready.' },
  { id: 'question', name: 'Question', blurb: 'Q&A with an acceptable answer. The accepted answer is the only XP in Talk.' },
  { id: 'linked', name: 'About a work', blurb: 'Showcase, help request, critique. The work\'s card pins at the top.' },
];

export default function TalkForm() {
  const { user, ready } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [boards, setBoards] = useState([]);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  useTitle('New thread');

  const [type, setType] = useState(params.get('type') || (params.get('work') ? 'linked' : 'plan'));
  const [board, setBoard] = useState(params.get('board') || '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [work, setWork] = useState(null);        // {id, title, author}
  const [goal, setGoal] = useState('');
  const [needed, setNeeded] = useState([]);
  const [needTags, setNeedTags] = useState([]);
  const [config, setConfig] = useState(null);

  const [boardsError, setBoardsError] = useState('');
  useEffect(() => {
    api('/talk/boards').then(r => setBoards(r.boards))
      .catch(() => setBoardsError('Could not load the boards. If the site was just updated, the server needs a restart.'));
  }, []);
  useEffect(() => { if (ready && !user) nav('/login', { state: { from: '/talk/new' } }); }, [ready, user]);
  useEffect(() => { getConfig().then(setConfig).catch(() => {}); }, []);
  // Arrived from a work page: resolve the work id in the URL into its card.
  useEffect(() => {
    const id = params.get('work');
    if (id) api(`/designs/${id}`).then(d => setWork({ id: d.id, title: d.title, author: d.author.username })).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setPosting(true); setError('');
    try {
      const post = await api('/talk', { method: 'POST', body: {
        board, type, title, body,
        work: work ? work.id : undefined,
        plan: type === 'plan' ? {
          goal, needed,
          needTags,
        } : undefined,
      } });
      nav(`/talk/${post.id}`);
    } catch (err) { setError(err.message); setPosting(false); }
  }

  const needsWork = type === 'linked';
  return (
    <>
      <p className="back-link"><Link to="/talk">&larr; Talk</Link></p>
      <h1>New thread</h1>
      <form className="panel wizard-panel" onSubmit={submit}>
        <div className="field">
          <label>What kind of post?</label>
          <div className="talk-type-picker">
            {TYPES.map(t => (
              <button key={t.id} type="button" className={'talk-type-card' + (type === t.id ? ' on' : '')}
                      aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                <strong>{t.name}</strong>
                <span className="stat">{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="tb">Board</label>
          <select id="tb" required value={board} onChange={e => setBoard(e.target.value)}>
            <option value="" disabled>The main skill this exercises…</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}: {b.scope}</option>)}
          </select>
          <small>Boards are skills, not topics. Something that spans several
            (software for future hardware, say) lives where the core build
            happens{type === 'plan' && <>, and lists the rest under skills needed below</>}.</small>
          {boardsError && <small className="form-error" role="alert">{boardsError}</small>}
        </div>

        <div className="field">
          <label htmlFor="tt">Title</label>
          <input id="tt" required maxLength={160} value={title} onChange={e => setTitle(e.target.value)}
                 placeholder={type === 'plan' ? 'One-handed jar opener. Who is in?' : type === 'question' ? 'How do I…?' : 'About: …'} />
        </div>

        {(needsWork || type === 'question') && (
          <div className="field">
            <label>{needsWork ? 'The work this is about (required)' : 'About a specific work? Link it.'}</label>
            {work
              ? <p className="stat">Linked to <strong>{work.title}</strong> by {work.author}{' '}
                  <button type="button" className="link-btn" onClick={() => setWork(null)}>change</button></p>
              : <WorkSearch onPick={setWork} />}
          </div>
        )}

        {type === 'plan' && (
          <>
            <div className="field">
              <label htmlFor="tg">Goal</label>
              <input id="tg" maxLength={500} value={goal} onChange={e => setGoal(e.target.value)}
                     placeholder="What should exist when this plan is done?" />
            </div>
            <div className="field">
              <label>Skills needed</label>
              <div className="cat-picker">
                {boards.map(b => (
                  <div key={b.id} className={'cat-chip' + (needed.includes(b.id) ? ' on' : '')}>
                    <button type="button" className="cat-toggle" aria-pressed={needed.includes(b.id)}
                            onClick={() => setNeeded(needed.includes(b.id) ? needed.filter(x => x !== b.id) : [...needed, b.id])}>
{b.name}
                    </button>
                  </div>
                ))}
              </div>
              <small>How collaborators find your plan.</small>
            </div>
            <div className="field">
              <label>What need does it serve?</label>
              <small>Same vocabulary as works; never affects XP.</small>
              <NeedTagPicker vocabulary={config?.xp?.needVocabulary} value={needTags} onChange={setNeedTags} />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="tbody">{type === 'question' ? 'The question, in full' : 'Details'}</label>
          <textarea id="tbody" style={{ minHeight: '7rem' }} maxLength={8000} value={body}
                    onChange={e => setBody(e.target.value)} />
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="toolbar">
          <button className="btn btn-primary" disabled={posting || !board || !title.trim() || (needsWork && !work)}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </>
  );
}

function WorkSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  // Focus lists the newest works before anything is typed; typing narrows.
  async function load(query) {
    try {
      const r = await api(`/designs?${query ? `q=${encodeURIComponent(query)}&` : 'sort=new&'}limit=6`);
      setResults(r.items);
      setBrowsing(!query);
    } catch { setResults([]); }
  }
  return (
    <span className="work-picker">
      <input placeholder="search works" value={q} onChange={e => setQ(e.target.value)}
             onFocus={() => { if (!results) load(''); }}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); load(q.trim()); } }} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(q.trim())}>Find</button>
      {results && (results.length === 0
        ? <em> {browsing ? 'no works yet' : 'nothing matched'}</em>
        : <>
            {browsing && <span className="stat"> recent: </span>}
            {results.map(w => (
              <button key={w.id} type="button" className="link-btn" style={{ marginLeft: '.5rem' }}
                      onClick={() => onPick({ id: w.id, title: w.title, author: w.author?.username })}>{w.title}</button>
            ))}
          </>)}
    </span>
  );
}
