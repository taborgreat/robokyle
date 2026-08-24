import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

/* Talk: the work incubator with a comment section. Boards are the nine skill
   categories; the default sort is usefulness (weighted votes), never "hot". */

const TYPE_LABELS = { linked: 'about a work', plan: 'plan', question: 'question' };
const fmtWhen = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function Talk() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [boards, setBoards] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const board = params.get('board') || '';
  const type = params.get('type') || '';
  const needed = params.get('needed') || '';
  const sort = params.get('sort') || 'useful';
  const work = params.get('work') || '';

  useEffect(() => { api('/talk/boards').then(r => setBoards(r.boards)).catch(() => {}); }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    for (const [k, v] of [['board', board], ['type', type], ['needed', needed], ['sort', sort], ['work', work]]) {
      if (v) q.set(k, v);
    }
    api(`/talk?${q}`).then(setData).catch(e => setError(e.message));
  }, [board, type, needed, sort, work]);

  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const active = boards.find(b => b.id === board);

  return (
    <>
      <div className="app-head">
        <div>
          <h1>Talk</h1>
          <span className="stat">
            {active ? active.scope : 'Plans, questions, and threads about works.'}
          </span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn btn-primary" onClick={() => nav(user ? '/talk/new' + (board ? `?board=${board}` : '') : '/login')}>
            New thread
          </button>
        </div>
      </div>

      {/* The boards ARE the categories: one vocabulary everywhere. */}
      <div className="board-row" role="tablist" aria-label="Boards">
        <button role="tab" aria-selected={!board} className={'board-chip' + (!board ? ' on' : '')}
                onClick={() => setFilter('board', '')}>All boards</button>
        {boards.map(b => (
          <button key={b.id} role="tab" aria-selected={board === b.id}
                  className={'board-chip' + (board === b.id ? ' on' : '')} style={{ '--cat': b.color }}
                  title={b.scope} onClick={() => setFilter('board', board === b.id ? '' : b.id)}>
{b.name}
            {b.openPlans > 0 && <span className="board-count" title={`${b.openPlans} open plan(s)`}>{b.openPlans}</span>}
          </button>
        ))}
      </div>

      <div className="toolbar talk-filters">
        <select aria-label="Post type" value={type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">All types</option>
          <option value="plan">Plans</option>
          <option value="question">Questions</option>
          <option value="linked">About a work</option>
        </select>
        {/* The matchmaker: plans looking for a skill. */}
        <select aria-label="Plans needing a skill" value={needed} onChange={e => setFilter('needed', e.target.value)}>
          <option value="">Plans needing…</option>
          {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={e => setFilter('sort', e.target.value)}>
          <option value="useful">Most useful</option>
          <option value="active">Recently active</option>
          <option value="new">Newest</option>
        </select>
        {work && <button className="btn btn-ghost btn-sm" onClick={() => setFilter('work', '')}>✕ all threads</button>}
      </div>

      {/* Filtering by a work opens its whole neighborhood: the revision family
          back to the root and the parts it is built from. Click any of them to
          walk the conversations across the tree. */}
      {work && data?.related
        && (data.related.family.length > 1
            || data.related.parts.length > 0
            || data.related.family.some(f => f.threads > 0)) && (
        <div className="panel talk-related">
          <h2>Around {data.related.current.title}</h2>
          <ul className="talk-tree">
            {data.related.family.map(f => (
              <li key={String(f.id)} style={{ '--indent': f.depth }}
                  className={String(f.id) === String(data.related.current.id) ? 'on' : ''}>
                <button type="button" className="link-btn" onClick={() => setFilter('work', f.id)}>
                  {f.title} <span className="stat">v{f.version} · {f.threads} {f.threads === 1 ? 'thread' : 'threads'}</span>
                </button>
                <Link className="stat talk-tree-open" to={`/works/${f.id}`} title="Open the work">↗</Link>
              </li>
            ))}
          </ul>
          {data.related.parts.length > 0 && (
            <>
              <span className="stat">Built from</span>
              <ul className="talk-tree">
                {data.related.parts.map(f => (
                  <li key={String(f.id)}>
                    <button type="button" className="link-btn" onClick={() => setFilter('work', f.id)}>
                      {f.title} <span className="stat">v{f.version} · {f.threads} {f.threads === 1 ? 'thread' : 'threads'}</span>
                    </button>
                    <Link className="stat talk-tree-open" to={`/works/${f.id}`} title="Open the work">↗</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}
      {!data ? <p className="empty">Loading…</p> : data.items.length === 0 ? (
        <p className="empty">
          {work && data?.related
            ? <>No threads about <strong>{data.related.current.title}</strong> yet. Its comment
                section covers ordinary discussion; a thread is for something bigger.{' '}
                <Link className="go-link" to={`/talk/new?type=linked&work=${work}`}>+ Thread</Link></>
            : <>Nothing here yet. {needed ? 'No open plans need that skill right now.' : 'Start a plan, ask a question, or open a thread about a work.'}</>}
        </p>
      ) : (
        <ul className="talk-list">
          {data.items.map(p => (
            <li key={p.id} className={'talk-row' + (p.archived ? ' is-archived' : '')}>
              <div className="talk-row-main">
                <Link to={`/talk/${p.id}`} className="talk-title">{p.title}</Link>
                <span className="talk-badges">
                  <span className={`tag talk-type talk-type-${p.type}`}>
                    {p.type === 'plan' ? (p.plan?.status === 'became-work' ? 'became a work' : `plan · ${p.plan?.status}`) : TYPE_LABELS[p.type]}
                  </span>
                  {p.answered && <span className="tag endorsed-tag">answered</span>}
                  {p.archived && <span className="tag">archived</span>}
                  {p.type === 'plan' && (p.plan?.needed || []).map(n => {
                    const b = boards.find(x => x.id === n);
                    return b && <span key={n} className="tag need-cat" style={{ '--cat': b.color }} title={`needs ${b.name}`}>{b.name}</span>;
                  })}
                </span>
              </div>
              <span className="stat">
                {boards.find(b => b.id === p.board)?.name} by{' '}
                <Link to={`/user/${p.author.username}`}>{p.author.username}</Link>
                {' · '}{p.commentCount} {p.commentCount === 1 ? 'comment' : 'comments'}
                {p.score !== 0 && <> · usefulness <span className="rs-num">{p.score}</span></>}
                {p.type === 'plan' && p.plan?.participants > 1 && <> · {p.plan.participants} in</>}
                {' · '}{fmtWhen(p.lastActivityAt || p.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
