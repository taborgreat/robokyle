import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Stat({ n, label }) {
  return <div className="profile-stat"><span className="n">{n}</span><span className="l">{label}</span></div>;
}

function BioEditor({ bio, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      const r = await api('/users/me', { method: 'PATCH', body: { bio: text } });
      onSaved(r.user.bio);
      setEditing(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div className="profile-bio">
        {bio ? <p className="desc">{bio}</p> : <p className="stat">No bio yet. Say what you make, or what you are looking for.</p>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(bio); setEditing(true); }}>
          {bio ? 'Edit bio' : 'Add a bio'}
        </button>
      </div>
    );
  }

  return (
    <div className="profile-bio">
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="bio">Bio</label>
        <textarea id="bio" maxLength={600} style={{ minHeight: '6rem' }} value={text} onChange={e => setText(e.target.value)} />
        <small>{600 - text.length} characters left.</small>
      </div>
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

export default function Profile() {
  const { username } = useParams();
  const { logout, refresh } = useAuth();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleNote, setRoleNote] = useState('');

  useEffect(() => {
    setP(null); setError(''); setRoleNote('');
    api(`/users/${encodeURIComponent(username)}`).then(setP).catch(e => setError(e.message));
  }, [username]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!p) return <p className="empty">Loading…</p>;

  async function setRole(role) {
    setRoleBusy(true); setRoleNote('');
    try {
      const r = await api(`/users/${encodeURIComponent(username)}/role`, { method: 'POST', body: { role } });
      setP({ ...p, role: r.user.role });
      setRoleNote(`${p.username} is now ${r.user.role === 'admin' ? 'an admin' : 'a member'}.`);
    } catch (err) { setRoleNote(err.message); }
    finally { setRoleBusy(false); }
  }

  // Home is a flat page, so this has to be a real navigation, not a router push.
  function signOut() {
    logout();
    window.location.assign('/');
  }

  const s = p.stats;

  return (
    <>
      <div className="app-head">
        <div>
          <h1 className="profile-name">
            {p.username}
            {p.role === 'admin' && <span className="tag admin-tag">admin</span>}
            {p.isSelf && <span className="tag">you</span>}
          </h1>
          <span className="stat">Joined {fmtDate(p.joined)}</span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          {p.isSelf && <Link className="btn btn-primary" to="/works/new">Add a work</Link>}
          {p.canManageRole && (p.role === 'admin'
            ? <button className="btn btn-ghost" disabled={roleBusy} onClick={() => setRole('user')}>Demote to member</button>
            : <button className="btn btn-ghost" disabled={roleBusy} onClick={() => setRole('admin')}>Promote to admin</button>)}
          {p.isSelf && <button className="btn btn-ghost" onClick={signOut}>Log out</button>}
        </div>
      </div>
      {roleNote && <div className="notice" style={{ marginBottom: '1.5rem' }} role="status">{roleNote}</div>}

      <div className="profile-grid">
        <div>
          <div className="panel">
            {p.isSelf
              ? <BioEditor bio={p.bio} onSaved={bio => { setP({ ...p, bio }); refresh().catch(() => {}); }} />
              : (p.bio ? <p className="desc">{p.bio}</p> : <p className="stat">This member has not written a bio.</p>)}
          </div>

          <h2 className="profile-section">{p.isSelf ? 'Your works' : `Works by ${p.username}`} ({s.works})</h2>
          {p.works.length === 0 ? (
            <p className="empty">
              {p.isSelf
                ? <>Nothing posted yet. <Link to="/works/new">Add your first work</Link>.</>
                : 'Nothing posted yet.'}
            </p>
          ) : (
            <div className="design-grid">
              {p.works.map(w => (
                <Link key={w.id} className="design-card" to={`/works/${w.id}`}>
                  {w.thumbUrl ? (
                    <div className="thumb has-photo"><img src={fileUrl(w.thumbUrl)} alt="" loading="lazy" /></div>
                  ) : (
                    <div className="thumb" aria-hidden="true">
                      <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M32 6l22 12v18L32 44 10 36V18z"/><path d="M32 22l22-4M32 22L10 18M32 22v22"/>
                      </svg>
                    </div>
                  )}
                  <div className="body">
                    <h3>{w.title}</h3>
                    <p>{w.description.length > 120 ? w.description.slice(0, 120) + '…' : w.description}</p>
                    <div className="meta">
                      <span className="stat">
                        <strong>▲ {w.upvoteCount}</strong> · {w.downloadCount} downloads · v{w.version}
                        {w.guideSteps > 0 && <> · guide</>}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <aside>
          <div className="panel">
            <h2>Activity</h2>
            <div className="profile-stats">
              <Stat n={s.works} label={s.works === 1 ? 'work' : 'works'} />
              <Stat n={s.comments} label="comments" />
              <Stat n={s.upvotes} label="upvotes" />
              <Stat n={s.downloads} label="downloads" />
            </div>
            <p className="stat" style={{ marginTop: '.75rem' }}>
              {s.files > 0 && <>{plural(s.files, 'file')} shared</>}
              {s.files > 0 && s.guides > 0 && ' · '}
              {s.guides > 0 && <>{plural(s.guides, 'build guide')} written</>}
            </p>
          </div>

          <div className="panel" style={{ marginTop: '1.5rem' }}>
            <h2>Recent comments</h2>
            {p.comments.length === 0 ? <p className="stat">Nothing yet.</p> : (
              <ul className="comment-feed">
                {p.comments.map(c => (
                  <li key={c.id}>
                    <Link to={`/works/${c.work.id}`}>{c.work.title}</Link>
                    <span className="when">{fmtDate(c.createdAt)}</span>
                    <p>{c.body.length > 180 ? c.body.slice(0, 180) + '…' : c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
