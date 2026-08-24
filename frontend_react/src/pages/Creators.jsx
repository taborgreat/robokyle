import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, avatarUrl } from '../lib/api.js';

/* Everyone, ranked by RoboXP (verified value produced, works weighted over
   chat) or by one skill for the specialty view. The way to find the most
   useful accounts and their works at a glance. */
export default function Creators() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const sort = params.get('sort') || '';
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/config').then(setConfig).catch(() => {}); }, []);
  useEffect(() => {
    setData(null);
    api(`/users?limit=50${category ? `&category=${category}` : ''}${sort ? `&sort=${sort}` : ''}`)
      .then(setData).catch(e => setError(e.message));
  }, [category, sort]);

  if (error) return <div className="form-error" role="alert">{error}</div>;

  const cats = (config?.xp?.categories || []).filter(c => !c.hidden);

  return (
    <>
      <div className="app-head">
        <div>
          <h1>Creators</h1>
          <p className="stat">Ranked by RoboXP: what their works have actually done for people.</p>
        </div>
        <select aria-label="Rank by" value={category || (sort === 'level' ? '_level' : '')}
                onChange={e => {
                  const v = e.target.value;
                  setParams(v === '_level' ? { sort: 'level' } : v ? { category: v } : {});
                }}>
          <option value="">Most useful (RoboXP)</option>
          <option value="_level">Highest total level</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!data ? <p className="empty">Loading…</p> : (
        <ol className="creator-list">
          {data.items.map((u, i) => (
            <li key={u.username}>
              <span className="creator-rank">{i + 1}</span>
              {/* A wall of colored bursts: the eye finds the deep specialists instantly. */}
              <img className="avatar-sm" src={avatarUrl(u.username, 28)} alt="" width="28" height="28" loading="lazy" />
              <span className="creator-who">
                <Link to={`/user/${u.username}`}>{u.username}</Link>
                {u.bio && <small>{u.bio.length > 90 ? u.bio.slice(0, 90) + '…' : u.bio}</small>}
              </span>
              <span className="creator-nums">
                {category
                  ? <><strong className="rs-num">{Math.round(u.categoryXp)}</strong> xp · level <span className="rs-num">{u.categoryLevel}</span></>
                  : sort === 'level'
                    ? <><strong>Level <span className="rs-num">{u.totalLevel}</span></strong> · <span className="rs-num">{Math.round(u.roboXp).toLocaleString()}</span> RoboXP</>
                    : <><strong className="rs-num">{Math.round(u.roboXp).toLocaleString()}</strong> RoboXP · level <span className="rs-num">{u.totalLevel}</span></>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
