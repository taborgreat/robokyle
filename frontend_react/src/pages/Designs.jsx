import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const SORTS = [
  ['new', 'Most recent'],
  ['downloads', 'Most downloaded'],
  ['top', 'Most upvoted'],
];

export default function Designs() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const tag = params.get('tag') || '';
  const sort = params.get('sort') || 'new';
  const page = Number(params.get('page') || 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(q);

  useEffect(() => { setSearch(q); }, [q]);

  useEffect(() => {
    setError(''); setData(null);
    const query = new URLSearchParams({ sort, page });
    if (q) query.set('q', q);
    if (tag) query.set('tag', tag);
    api(`/designs?${query}`).then(setData).catch(e => setError(e.message));
  }, [q, tag, sort, page]);

  // Every control rewrites the URL, so filters survive a refresh and can be shared.
  const update = (patch) => {
    const next = { sort, page: 1, ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    setParams(next);
  };
  const pages = data ? Math.ceil(data.total / data.limit) : 0;
  const filtered = !!(q || tag);

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

      <div className="filter-bar">
        <form className="filter-group" role="search"
              onSubmit={e => { e.preventDefault(); update({ q: search.trim() }); }}>
          <label className="filter-label" htmlFor="works-search">Search</label>
          <div className="search-row">
            <input id="works-search" type="search" placeholder="Title, description or tag…"
                   value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn btn-ghost btn-sm" type="submit">Search</button>
          </div>
        </form>

        <fieldset className="filter-group">
          <legend>Sort</legend>
          <div className="options">
            {SORTS.map(([value, label]) => (
              <label key={value}>
                <input type="radio" name="sort" value={value}
                       checked={sort === value} onChange={() => update({ sort: value })} />
                <span className="filter-pill">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {(filtered || data) && (
        <div className="results-row">
          <span className="stat">
            {data
              ? <>{data.total} {data.total === 1 ? 'work' : 'works'}{q && <> matching “{q}”</>}{tag && <> tagged “{tag}”</>}</>
              : 'Loading…'}
          </span>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => { setSearch(''); setParams({ sort }); }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}
      {data && data.items.length === 0 && (
        <p className="empty">{filtered
          ? 'Nothing matched that. Try a broader search.'
          : 'Nothing here yet. Be the first to add one.'}</p>
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
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>&larr; Prev</button>
          <span className="stat" style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>Next &rarr;</button>
        </div>
      )}
    </>
  );
}
