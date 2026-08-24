import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/* The family arrives flat; the parent links turn it into a tree. Anything whose
   parent is missing (deleted, or the root itself) hangs off the top level, so a
   gap in the chain never hides the works below it. */
function toTree(items) {
  const byId = new Map(items.map(w => [String(w.id), { ...w, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent && byId.get(String(node.parent));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  /* Siblings sort by verified builds, so the page answers "which branch won"
     at a glance. The numbers decide, publicly, like everywhere else. */
  const rank = (a, b) => (b.producedCount - a.producedCount) || (new Date(a.createdAt) - new Date(b.createdAt));
  const sortDeep = (nodes) => { nodes.sort(rank); nodes.forEach(n => sortDeep(n.children)); };
  sortDeep(roots);
  return roots;
}

function Branch({ node, currentId }) {
  const isCurrent = String(node.id) === String(currentId);
  return (
    <li className={isCurrent ? 'branch is-current' : 'branch'}>
      <div className="branch-node">
        <Link to={`/works/${node.id}`} className="branch-title">{node.title}</Link>
        <span className="stat">
          by <Link to={`/user/${node.author.username}`}>{node.author.username}</Link>
          {' · '}v{node.version}
          {node.parentVersion ? ` · remix of v${node.parentVersion}` : ' · original'}
          {node.producedCount > 0 && <> · produced <span className="rs-num">{node.producedCount}</span>×</>}
          {' · '}▲ <span className="rs-num">{node.upvoteCount}</span>
          {' · '}{fmtDate(node.createdAt)}
        </span>
        {isCurrent && <span className="tag">you are here</span>}
        {node.remixNote && <em className="remix-note">{node.remixNote}</em>}
      </div>
      {node.children.length > 0 && (
        <details className="branch-fold" open>
          <summary>{node.children.length} {node.children.length === 1 ? 'remix' : 'remixes'}</summary>
          <ul className="branches">
            {node.children.map(child => <Branch key={child.id} node={child} currentId={currentId} />)}
          </ul>
        </details>
      )}
    </li>
  );
}

export default function WorkTree() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api(`/designs/${id}/lineage`).then(setData).catch(e => setError(e.message));
  }, [id]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!data) return <p className="empty">Loading…</p>;

  const tree = toTree(data.items);
  const builders = new Set(data.items.map(w => w.author.username));

  return (
    <>
      <p className="back-link"><Link to={`/works/${id}`}>&larr; Back to the work</Link></p>
      <div className="app-head">
        <div>
          <h1>How this work grew</h1>
          <span className="stat">
            {data.count === 1 ? '1 work' : `${data.count} works`} by {builders.size}{' '}
            {builders.size === 1 ? 'person' : 'people'}. Every branch is a remix of the one above it; branches sort by verified builds.
          </span>
        </div>
      </div>

      <div className="panel">
        <ul className="branches branches-root">
          {tree.map(node => <Branch key={node.id} node={node} currentId={id} />)}
        </ul>
      </div>
    </>
  );
}
