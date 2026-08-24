import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isModUser = (u) => !!u && (u.role === 'admin' || (u.roles || []).includes('mod'));

/* The moderation queue. The URL is deliberately unguessable; the real gate
   is the server's isMod check on every endpoint this page touches. */
export default function ModQueue() {
  const { user, ready } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/users/mod/overview').then(setData).catch(e => setError(e.message));
  useEffect(() => { if (isModUser(user)) load(); }, [user]);

  if (ready && !isModUser(user)) return <Navigate to="/works" replace />;
  if (error && !data) return <div className="form-error" role="alert">{error}</div>;
  if (!data) return <p className="empty">Loading…</p>;

  async function resolve(id) {
    setBusy(true);
    try { await api(`/users/flags/${id}/resolve`, { method: 'POST', body: {} }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function lift(username) {
    setBusy(true);
    try { await api(`/users/${encodeURIComponent(username)}/unsuspend`, { method: 'POST', body: {} }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const open = data.flags.filter(f => !f.resolved);
  const closed = data.flags.filter(f => f.resolved);

  return (
    <>
      <div className="app-head">
        <div>
          <h1>Moderation</h1>
          <span className="stat">Flags the system raised and every active suspension. Suspending happens from a member's profile.</span>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="rs-below">
        <div className="panel">
          <h2>Open flags <span className="rs-num">{open.length}</span></h2>
          {open.length === 0 ? <p className="stat">Nothing open. The system files a flag when voting patterns look coordinated.</p> : (
            <ul className="revision-list">
              {open.map(f => (
                <li key={f.id}>
                  <strong>{f.kind}</strong> · {fmtWhen(f.createdAt)}
                  <p className="stat" style={{ margin: '.2rem 0' }}>{f.detail}</p>
                  <span className="stat">
                    accounts: {f.accounts.map((a, i) => <span key={a}>{i > 0 && ', '}<Link to={`/user/${a}`}>{a}</Link></span>)}
                  </span>
                  <div className="toolbar" style={{ margin: '.4rem 0 0' }}>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => resolve(f.id)}>Mark reviewed</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <h2>Active suspensions <span className="rs-num">{data.suspensions.length}</span></h2>
          {data.suspensions.length === 0 ? <p className="stat">Nobody is suspended.</p> : (
            <ul className="revision-list">
              {data.suspensions.map(u => (
                <li key={u.username}>
                  <Link to={`/user/${u.username}`}>{u.username}</Link> until {fmtWhen(u.until)}
                  {u.by && <span className="stat"> · by {u.by}</span>}
                  {u.reason && <p className="stat" style={{ margin: '.2rem 0' }}>{u.reason}</p>}
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => lift(u.username)}>Lift now</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {closed.length > 0 && (
          <div className="panel">
            <h2>Reviewed flags</h2>
            <ul className="revision-list">
              {closed.slice(0, 20).map(f => (
                <li key={f.id}><span className="stat">{f.kind} · {f.accounts.join(', ')} · {fmtWhen(f.createdAt)}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
