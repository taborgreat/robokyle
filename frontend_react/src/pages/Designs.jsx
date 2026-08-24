import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fileUrl, getConfig } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import NeedTagPicker from '../NeedTagPicker.jsx';
import { SkillIcon } from '../rs.jsx';

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
  /* The buildable toggle remembers itself across visits; the URL param,
     when present, always wins so filtered links can be shared. */
  const [buildPref] = useState(() => { try { return localStorage.getItem('rk-buildable') === '1'; } catch { return false; } });
  const buildable = params.has('buildable') ? params.get('buildable') === '1' : buildPref;
  const facet = params.get('facet') || '';
  const lineage = params.get('lineage') || '';
  const need = params.get('need') || '';
  const needs = need ? need.split(',').filter(Boolean) : [];
  const page = Number(params.get('page') || 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(q);
  const [config, setConfig] = useState(null);
  useEffect(() => { getConfig().then(setConfig).catch(() => {}); }, []);

  useEffect(() => { setSearch(q); }, [q]);

  useEffect(() => {
    setError(''); setData(null);
    const query = new URLSearchParams({ sort, page });
    if (q) query.set('q', q);
    if (tag) query.set('tag', tag);
    if (buildable) query.set('buildable', '1');
    if (facet) query.set('facet', facet);
    if (lineage) query.set('lineage', lineage);
    if (need) query.set('need', need);
    api(`/designs?${query}`).then(setData).catch(e => setError(e.message));
  }, [q, tag, sort, page, buildable, facet, lineage, need]);

  // Every control rewrites the URL, so filters survive a refresh and can be shared.
  const update = (patch) => {
    const next = { sort, page: 1, ...(q ? { q } : {}), ...(tag ? { tag } : {}),
      ...(buildable ? { buildable: '1' } : {}), ...(facet ? { facet } : {}),
      ...(lineage ? { lineage } : {}), ...(need ? { need } : {}), ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    setParams(next);
  };
  const pages = data ? Math.ceil(data.total / data.limit) : 0;
  const filtered = !!(q || tag || need);

  return (
    <>
      <div className="app-head">
        <div>
          <h1>Works</h1>
          <p className="stat">Files, photos and a build guide for each one. Free to download and change. <Link to="/creators">Creators &rarr;</Link></p>
        </div>
        <Link className="btn btn-build" to={user ? '/works/new' : '/login'} state={{ from: '/works/new' }}>
          Create Work <span className="arrow" aria-hidden="true">&rarr;</span>
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

        {user && (
          <fieldset className="filter-group">
            <legend>Show</legend>
            <div className="options">
              <label>
                <input type="checkbox" checked={buildable}
                       onChange={() => {
                         try { buildable ? localStorage.removeItem('rk-buildable') : localStorage.setItem('rk-buildable', '1'); } catch {}
                         update({ buildable: buildable ? '0' : '1' });
                       }} />
                <span className="filter-pill">Buildable with my equipment</span>
              </label>
            </div>
          </fieldset>
        )}

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

        {/* The need filter: the curated vocabulary as a structured filter. A
            work matches by declaring the need, not by mentioning the word;
            several needs narrow to the intersection. */}
        <fieldset className="filter-group filter-need">
          <legend>Need</legend>
          <details className="need-filter" open={needs.length > 0}>
            <summary>{needs.length
              ? <>Needs: {needs.join(' + ')}</>
              : 'Filter by the need it serves'}</summary>
            <NeedTagPicker vocabulary={config?.xp?.needVocabulary} value={needs}
                           onChange={list => update({ need: list.join(',') })} />
          </details>
        </fieldset>

        {/* Family-aware browse: All collapses each family to one card wearing
            its stack badge; the other two cut the collection flat. */}
        <fieldset className="filter-group">
          <legend>Lineage</legend>
          <div className="options">
            {[['', 'All'], ['roots', 'Roots only'], ['remixes', 'Remixes only']].map(([value, label]) => (
              <label key={value || 'families'}>
                <input type="radio" name="lineage" value={value}
                       checked={lineage === value} onChange={() => update({ lineage: value })} />
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
              ? <>{data.total} {data.total === 1 ? 'work' : 'works'}{q && <> matching “{q}”</>}{tag && <> tagged “{tag}”</>}{needs.length > 0 && <> for {needs.join(' + ')}</>}</>
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
              <h3>
                {(() => {
                  const cat = (config?.xp?.categories || []).find(x => x.id === d.categories?.[0]?.id);
                  return cat ? <SkillIcon id={cat.id} name={cat.name} color={cat.color} size={16} /> : null;
                })()}
                {d.title}
                {d.familyCount > 1 && <span className="tag family-stack" title={`A family of ${d.familyCount}: the original and its remixes. This card is the member with the most verified builds.`}>⊞ <span className="rs-num">{d.familyCount}</span></span>}
              </h3>
              {/* A remix leads with what it changed; the description mostly
                  restates its parent. */}
              {d.depth > 0 && d.remixNote
                ? <p className="remix-note">{d.remixNote}</p>
                : <p>{d.description.length > 140 ? d.description.slice(0, 140) + '…' : d.description}</p>}
              <div className="meta">
                {d.depth > 0 && <span className="tag">remix</span>}
                {user && d.buildable === false && <span className="tag miss-tag" title={`Missing: ${(d.missingEquipment || []).join(', ')}`}>missing {(d.missingEquipment || []).length} tool{(d.missingEquipment || []).length === 1 ? '' : 's'}</span>}
                {user && d.buildable === true && (d.fileCount > 0 || d.guideSteps > 0) && <span className="tag ok-tag">buildable</span>}
                {d.tags.slice(0, 3).map(t => <span key={t} className="tag">{t}</span>)}
                <span className="stat">
                  <strong>&#9650; <span className="rs-num">{d.upvoteCount}</span></strong>{d.producedCount > 0 && <> · <span className="tag endorsed-tag" title="Verified real-world results">produced <span className="rs-num">{d.producedCount}</span>×</span></>} · <span className="rs-num">{d.downloadCount}</span> downloads · <span className="rs-num">{d.commentCount}</span> comments · v{d.version} · by {d.author.username}
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
