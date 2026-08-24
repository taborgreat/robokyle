import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl, avatarUrl, getConfig } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ErrorBar from '../ErrorBar.jsx';
import { useTitle } from '../lib/title.js';
import { useHashTarget } from '../rs.jsx';

/* One Talk thread. Drift mechanics live here: replies at depth ≥ 2 collapse
   behind a click, siblings sort by usefulness with the accepted answer
   pinned, and the OP or a mod can fork a tangent into its own post. */

const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtExact = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });

const Chip = ({ author }) => author?.chip ? (author.chip.newUser
  ? <span className="tag chip-new">new user</span>
  : <span className="tag user-chip" style={{ '--cat': author.chip.color }}>
      {author.chip.title} · {author.chip.name} {author.chip.level}
    </span>) : null;

function ReasonCards({ cards, onJudge, onRemove }) {
  if (!cards?.length) return null;
  // A struck card is a verdict and stays; anything else of yours you can take
  // back, which withdraws the downvote it rode in on.
  const removable = (c) => c.mine && c.state !== 'struck' && onRemove;
  return cards.map(c => (
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
                onClick={() => onJudge(c.id, 1)} title="This objection is fair">▲</button>
        <button className={'link-btn' + (c.myVote === -1 ? ' on' : '')} disabled={c.frozen}
                onClick={() => onJudge(c.id, -1)} title="This objection is bad faith">▼</button>
        <span className="stat"><span className="rs-num">{c.voteCount}</span> {c.voteCount === 1 ? 'judgment' : 'judgments'}{c.frozen && ' · final'}</span>
        {removable(c) && <button className="link-btn" title="Removes the reason and withdraws your downvote"
                onClick={() => { if (confirm('Remove your reason? This withdraws your downvote too.')) onRemove(); }}>Remove</button>}
      </span>
    </div>
  ));
}

/* The why-box: a downvote is a claim, so casting one opens this instead of firing. */
function WhyBox({ onSubmit, onCancel }) {
  const [why, setWhy] = useState('');
  return (
    <form className="panel why-box" onSubmit={e => { e.preventDefault(); onSubmit(why); }}>
      <label><strong>Why?</strong> Required. Posted without your name, so don't sign it.</label>
      <textarea required minLength={10} maxLength={2000} value={why} onChange={e => setWhy(e.target.value)}
                placeholder="What specifically is wrong? The community judges your reason." />
      <small className="stat">At least 10 characters{why.trim().length > 0 && why.trim().length < 10 ? ` (${10 - why.trim().length} to go)` : ''}.</small>
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn btn-danger btn-sm" disabled={why.trim().length < 10}>Downvote with this reason</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function TalkPostView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);   // { id, username }
  const [whyOpen, setWhyOpen] = useState(false);  // post-level downvote
  const [whyFor, setWhyFor] = useState(null);     // comment id awaiting a reason

  /* Boards are category ids under the hood; people see the display name. */
  const [config, setConfig] = useState(null);
  useEffect(() => { getConfig().then(setConfig).catch(() => {}); }, []);
  const catName = (cid) => (config?.xp?.categories || []).find(c => c.id === cid)?.name || cid;

  const load = () => api(`/talk/${id}`).then(setP).catch(e => setError(e.message));
  useTitle(p?.title);
  useHashTarget(!!p);
  useEffect(() => { load(); }, [id]);

  /* Flat list → tree. Siblings sort by usefulness; the accepted answer pins
     first among top-level comments. Never engagement, never "hot". */
  const tree = useMemo(() => {
    if (!p) return [];
    const byParent = new Map();
    for (const c of p.comments) {
      const key = String(c.parent || '');
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(c);
    }
    const rank = (a, b) => (b.accepted - a.accepted) || (b.score - a.score) || (new Date(a.createdAt) - new Date(b.createdAt));
    const build = (parent) => (byParent.get(String(parent || '')) || []).sort(rank)
      .map(c => ({ ...c, children: build(c._id) }));
    return build(null);
  }, [p]);

  if (error && !p) return <div className="form-error" role="alert">{error}</div>;
  if (!p) return <p className="empty">Loading…</p>;

  const needLogin = () => nav('/login', { state: { from: `/talk/${id}` } });
  const act = (fn) => async (...args) => {
    if (!user) return needLogin();
    try { setError(''); await fn(...args); await load(); }
    catch (err) { setError(err.message); }
  };

  const votePost = act(async (dir, reason) => {
    if (dir === 'down' && !p.downvoted && reason === undefined) { setWhyOpen(o => !o); return; }
    await api(`/talk/${id}/vote`, { method: 'POST', body: { dir, reason } });
    setWhyOpen(false);
  });
  const judgePostReason = act((rid, dir) => api(`/talk/${id}/reasons/${rid}/vote`, { method: 'POST', body: { dir } }));
  const voteComment = act(async (c, dir, reason) => {
    if (dir === 'down' && !c.downvoted && reason === undefined) { setWhyFor(whyFor === c._id ? null : c._id); return; }
    await api(`/talk/${id}/comments/${c._id}/vote`, { method: 'POST', body: { dir, reason } });
    setWhyFor(null);
  });
  const judgeCommentReason = act((cid, rid, dir) =>
    api(`/talk/${id}/comments/${cid}/reasons/${rid}/vote`, { method: 'POST', body: { dir } }));
  const accept = act((cid) => api(`/talk/${id}/accept`, { method: 'POST', body: { commentId: cid } }));
  const delComment = act((cid) => api(`/talk/${id}/comments/${cid}`, { method: 'DELETE' }));
  const join = act(() => api(`/talk/${id}/join`, { method: 'POST' }));
  const leave = act(() => api(`/talk/${id}/leave`, { method: 'POST' }));
  const requestPromote = act(() => api(`/talk/${id}/promote-request`, { method: 'POST' }));
  const approvePromote = act(() => api(`/talk/${id}/promote-approve`, { method: 'POST' }));
  const archive = act(() => api(`/talk/${id}/archive`, { method: 'POST' }));
  const delPost = act(async () => {
    if (!confirm('Delete this thread and all its comments?')) return;
    await api(`/talk/${id}`, { method: 'DELETE' });
    nav('/talk');
  });

  async function promote() {
    if (!user) return needLogin();
    try {
      const r = await api(`/talk/${id}/promote`, { method: 'POST' });
      nav(`/works/new?draft=${r.draftId}`);
    } catch (err) { setError(err.message); }
  }
  async function fork(c) {
    const title = prompt('Title for the forked post (its own plan):', c.body.slice(0, 120));
    if (title === null) return;
    try {
      const r = await api(`/talk/${id}/fork`, { method: 'POST', body: { commentId: c._id, title } });
      nav(`/talk/${r.id}`);
    } catch (err) { setError(err.message); }
  }
  async function postComment(e) {
    e.preventDefault();
    if (!user) return needLogin();
    try {
      await api(`/talk/${id}/comments`, { method: 'POST', body: { body: comment, parent: replyTo?.id } });
      setComment(''); setReplyTo(null);
      await load();
    } catch (err) { setError(err.message); }
  }

  function CommentNode({ c, depth }) {
    const kids = c.children || [];
    const replies = kids.length > 0 && (
      <div className="talk-replies">{kids.map(k => <CommentNode key={k._id} c={k} depth={depth + 1} />)}</div>
    );
    return (
      <div className={'comment talk-comment' + (c.accepted ? ' is-accepted' : '')} id={`c-${c._id}`}>
        {c.forkedTo ? (
          <p className="stat">↪ This tangent continued as <Link to={`/talk/${c.forkedTo}`}>its own post</Link>.</p>
        ) : c.deleted ? (
          <p className="stat"><em>deleted</em></p>
        ) : (
          <>
            <span className="who">
              {c.author
                ? <>
                    <img className="avatar-sm" src={avatarUrl(c.author.username, 22)} alt="" width="22" height="22" loading="lazy" />
                    <Link to={`/user/${c.author.username}`}>{c.author.username}</Link> <Chip author={c.author} />
                  </>
                : 'deleted'}
              {c.accepted && <span className="tag endorsed-tag">✓ accepted answer</span>}
              <a className="when" href={`#c-${c._id}`} title={fmtExact(c.createdAt) + ' — link to this comment'}>{fmtWhen(c.createdAt)}</a>
            </span>
            <p>{c.body}</p>
            <span className="toolbar talk-comment-tools">
              <button className={'link-btn' + (c.upvoted ? ' on' : '')} onClick={() => voteComment(c, 'up')}>▲ <span className="rs-num">{c.upvoteCount}</span></button>
              <button className={'link-btn' + (c.downvoted ? ' on' : '')} onClick={() => voteComment(c, 'down')}>▼ <span className="rs-num">{c.downvoteCount || 0}</span></button>
              {!p.archived && <button className="link-btn" onClick={() => user
                ? setReplyTo(replyTo?.id === c._id ? null : { id: c._id, username: c.author?.username })
                : needLogin()}>Reply</button>}
              {p.canAccept && !c.accepted && c.author && <button className="link-btn" onClick={() => accept(c._id)}>Accept</button>}
              {p.canAccept && c.accepted && <button className="link-btn" onClick={() => accept(null)}>Un-accept</button>}
              {p.canFork && kids.length > 0 && <button className="link-btn" title="Slice this tangent into its own post" onClick={() => fork(c)}>Fork</button>}
              {(c.mine || p.canEdit) && <button className="link-btn" onClick={() => delComment(c._id)}>Delete</button>}
            </span>
            {whyFor === c._id && <WhyBox onSubmit={(why) => voteComment(c, 'down', why)} onCancel={() => setWhyFor(null)} />}
            {replyTo?.id === c._id && composer}
            <ReasonCards cards={c.reasonCards} onJudge={(rid, dir) => judgeCommentReason(c._id, rid, dir)}
                         onRemove={() => voteComment(c, 'down')} />
          </>
        )}
        {/* Every branch collapses behind its reply count; deep branches start
            closed so the derail spiral stays a click away. */}
        {kids.length > 0 && !c.forkedTo && (
          <details className="talk-collapse" open={depth < 1}>
            <summary>{kids.length} {kids.length === 1 ? 'reply' : 'replies'}</summary>
            {replies}
          </details>
        )}
      </div>
    );
  }

  const plan = p.plan;
  const statusLabel = { open: 'open. Who is in?', 'in-progress': 'in progress', 'became-work': 'became a work', abandoned: 'abandoned' };

  /* One composer, rendered where the conversation is: at the top of the
     thread for a new comment, inline under a comment when replying. */
  const composer = !p.archived && (
    <form className="talk-composer" onSubmit={postComment}>
      <textarea required disabled={!user} value={comment} autoFocus={!!replyTo}
                aria-label={replyTo ? 'Your reply' : p.type === 'question' ? 'Your answer' : 'Add a comment'}
                placeholder={user
                  ? (replyTo ? `Reply to ${replyTo.username || 'this comment'}` : p.type === 'question' ? 'Your answer' : 'Add a comment')
                  : 'Log in to join in'}
                onChange={e => setComment(e.target.value)} />
      <div className="talk-composer-row">
        <button className="btn btn-primary btn-sm" disabled={!user}>{replyTo ? 'Reply' : 'Post'}</button>
        {replyTo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>Cancel</button>}
      </div>
    </form>
  );

  return (
    <div className="talk-post">
      <ErrorBar error={error} onDismiss={() => setError('')} />
      <p className="back-link"><Link to="/talk">&larr; Talk</Link></p>

      {p.archived && (
        <div className="notice" role="status">
          This thread is archived and read-only. Linking a work, or promoting a plan, brings it back.
        </div>
      )}

      {/* The pinned work card: context never leaves the room. */}
      {p.work && !p.work.missing && (
        <Link to={`/works/${p.work.id}`} className="panel talk-work-card">
          {p.work.thumbUrl && <img src={fileUrl(p.work.thumbUrl)} alt="" />}
          <div>
            <span className="stat">{p.becameWork ? 'This plan became a work' : 'About the work'}</span>
            <h2>{p.work.title}</h2>
            <span className="stat">v{p.workVersion || p.work.version} by {p.work.author} · ▲ <span className="rs-num">{p.work.upvoteCount}</span> · <span className="rs-num">{p.work.downloadCount}</span> downloads</span>
          </div>
        </Link>
      )}

      {/* The post is one card, forum-shaped: who first, then what and where. */}
      <div className="panel talk-post-card">
        <div className="talk-post-meta">
          {p.author
            ? <span className="talk-post-author">
                <img className="avatar-sm" src={avatarUrl(p.author.username, 22)} alt="" width="22" height="22" />
                <Link to={`/user/${p.author.username}`}>{p.author.username}</Link> <Chip author={p.author} />
              </span>
            : <span>deleted</span>}
          <span>· {p.type === 'question' ? 'Question' : p.type === 'plan' ? 'Plan' : 'Thread'} in</span>
          <Link className="tag" to={`/talk?board=${p.board}`}>{catName(p.board)}</Link>
          <span className="when" title={fmtExact(p.createdAt)}>{fmtWhen(p.createdAt)}</span>
          {p.forkedFrom && <span>· forked from <Link to={`/talk/${p.forkedFrom.post}`}>another thread</Link></span>}
        </div>
        <h1 className="talk-post-title">{p.title}</h1>
        {p.body && <p className="desc talk-post-body">{p.body}</p>}

        {plan && (
          <div className="talk-plan-strip">
            <span className={`tag talk-type talk-type-plan`}>{statusLabel[plan.status] || plan.status}</span>
            {plan.needed.length > 0 && <span className="stat">needs: {plan.needed.map(n =>
              <Link key={n} className="tag" to={`/talk?needed=${n}`} style={{ marginRight: '.3rem' }}>{catName(n)}</Link>)}</span>}
            {plan.needTags.length > 0 && <span className="stat">for: {plan.needTags.join(', ')}</span>}
            {plan.goal && <span className="stat">Goal: {plan.goal}</span>}
            <span className="stat">{plan.participants.length} in: {plan.participants.map(x => x.username).join(', ')}</span>
            {!p.archived && plan.status !== 'became-work' && plan.status !== 'abandoned' && (
              <>
                {user && !plan.joined && <button className="btn btn-ghost btn-sm" title="Signals commitment and earns no XP" onClick={join}>Join</button>}
                {user && plan.joined && !p.canEdit && <button className="btn btn-ghost btn-sm" onClick={leave}>Leave</button>}
                {p.canPromote
                  ? <button className="btn btn-build btn-sm" onClick={promote} title="Opens the creation wizard pre-filled from this plan">Promote to Work</button>
                  : user && plan.joined && !plan.promotion && <button className="btn btn-ghost btn-sm" onClick={requestPromote}>Ask to promote this</button>}
                {p.promoteWhy && plan.joined && <span className="stat">{p.promoteWhy}</span>}
                {p.canEdit && plan.promotion && !plan.promotion.approved &&
                  <button className="btn btn-ghost btn-sm" onClick={approvePromote}>Approve promotion</button>}
              </>
            )}
          </div>
        )}

        <div className="toolbar talk-comment-tools talk-post-actions">
          <button className={'link-btn' + (p.upvoted ? ' on' : '')} onClick={() => votePost('up')} aria-pressed={p.upvoted}>▲ <span className="rs-num">{p.upvoteCount}</span></button>
          <button className={'link-btn vote-down' + (p.downvoted ? ' on' : '')} onClick={() => votePost('down')} aria-pressed={p.downvoted}>▼ <span className="rs-num">{p.downvoteCount || 0}</span></button>
          {p.canArchive && <button className="link-btn" onClick={archive}>{p.archived ? 'Unarchive' : 'Archive'}</button>}
          {p.canEdit && <button className="link-btn" onClick={delPost}>Delete</button>}
        </div>
        {whyOpen && <WhyBox onSubmit={(why) => votePost('down', why)} onCancel={() => setWhyOpen(false)} />}
        <ReasonCards cards={p.reasonCards} onJudge={judgePostReason} onRemove={() => votePost('down')} />
        {!replyTo && composer}
      </div>

      <div className="panel talk-thread">
        <h2>{p.type === 'question' ? 'Answers' : 'Comments'} ({p.comments.length})</h2>
        {tree.length === 0 && <p className="stat">{p.type === 'question' ? 'No answers yet.' : 'Nothing yet.'}</p>}
        {tree.map(c => <CommentNode key={c._id} c={c} depth={0} />)}
      </div>
    </div>
  );
}
