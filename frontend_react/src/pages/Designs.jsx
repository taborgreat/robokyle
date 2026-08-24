import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function Designs() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const sort = params.get('sort') || 'new';
  const page = Number(params.get('page') || 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(q);

  useEffect(() => {
    setError('');
    api(`/designs?q=${encodeURIComponent(q)}&sort=${sort}&page=${page}`).then(setData).catch(e => setError(e.message));
  }, [q, sort, page]);

  const update = (patch) => setParams({ q, sort, page: 1, ...patch });
  const pages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <>
      <div className="app-head">
        <div>
          <h1>Works</h1>
          <p className="stat">Files, photos and a build guide for each one. Free to download and change.</p>
        </div>
        <Link className="btn btn-primary" to={user ? '/works/new' : '/login'} state={{ from: '/works/new' }}>
          Add a work <span className="arrow" aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <form className="toolbar" onSubmit={e => { e.preventDefault(); update({ q: search }); }} role="search">
        <input type="search" placeholder="Search works…" aria-label="Search works" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Sort" value={sort} onChange={e => update({ sort: e.target.value })}>
          <option value="new">Newest</option>
          <option value="top">Most upvoted</option>
          <option value="downloads">Most downloaded</option>
        </select>
        <button className="btn btn-ghost" type="submit">Search</button>
      </form>

      {error && <div className="form-error" role="alert">{error}</div>}
      {data && data.items.length === 0 && (
        <p className="empty">Nothing here yet. Be the first to add one.</p>
      )}
      <div className="design-grid">
        {data?.items.map(d => (
          <Link key={d.id} className="design-card" to={`/works/${d.id}`}>
            {d.thumbUrl ? (
              <div className="thumb has-photo">
                <img src={fileUrl(d.thumbUrl)} alt="" loading="lazy" />
              </div>
            ) : (
              <div className="thumb" aria-hidden="true">
                <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M32 6l22 12v18L32 44 10 36V18z"/><path d="M32 22l22-4M32 22L10 18M32 22v22"/>
                </svg>
              </div>
            )}
            <div className="body">
              <h3>{d.title}</h3>
              <p>{d.description.length > 140 ? d.description.slice(0, 140) + '…' : d.description}</p>
              <div className="meta">
                {d.tags.slice(0, 3).map(t => <span key={t} className="tag">{t}</span>)}
                <span className="stat">
                  <strong>&#9650; {d.upvoteCount}</strong> · {d.downloadCount} downloads · {d.commentCount} comments · v{d.version} · by {d.author.username}
                  {d.fileCount > 0 && <> · {d.fileCount} file{d.fileCount > 1 ? 's' : ''}</>}
                  {d.linkCount > 0 && <> · {d.linkCount} link{d.linkCount > 1 ? 's' : ''}</>}
                  {d.guideSteps > 0 && <> · guide</>}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {pages > 1 && (
        <div className="toolbar" style={{ justifyContent: 'center', marginTop: '2rem' }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setParams({ q, sort, page: page - 1 })}>&larr; Prev</button>
          <span className="stat" style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => setParams({ q, sort, page: page + 1 })}>Next &rarr;</button>
        </div>
      )}
    </>
  );
}
