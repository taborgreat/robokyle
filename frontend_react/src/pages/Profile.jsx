import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl, avatarUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtExact = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Stat({ n, label }) {
  return <div className="profile-stat"><span className="n">{n}</span><span className="l">{label}</span></div>;
}

/* Delta B: equipment the member owns, from the curated list. Private by
   design: other people only ever see the derived buildable flag on works. */
function EquipmentEditor({ owned, config, onSaved }) {
  const items = config?.xp?.equipmentItems || [];
  const [busy, setBusy] = useState(false);
  async function toggle(id) {
    const next = owned.includes(id) ? owned.filter(x => x !== id) : [...owned, id];
    setBusy(true);
    try { await api('/users/me', { method: 'PATCH', body: { equipment: next } }); onSaved(next); }
    catch {} finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ marginTop: '1.5rem' }}>
      <h2>My equipment</h2>
      <p className="stat">Only you see this list. Works show you a buildable-with-my-equipment
        check, and the works list can filter to what you can actually make.</p>
      <div className="need-chips">
        {items.map(id => (
          <button key={id} type="button" disabled={busy}
                  className={'tag need-chip' + (owned.includes(id) ? ' on' : '')}
                  aria-pressed={owned.includes(id)} onClick={() => toggle(id)}>{id}</button>
        ))}
      </div>
    </div>
  );
}

function BioEditor({ bio, onSaved, introMinChars, hasIntroXp }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The intro receipt's bar, made visible: an invisible threshold that pays
  // silently or not at all just reads as broken.
  const shortOf = introMinChars && !hasIntroXp && text.trim().length < introMinChars
    ? introMinChars - text.trim().length : 0;

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
        <small>
          {600 - text.length} characters left.
          {introMinChars > 0 && !hasIntroXp && (
            shortOf > 0
              ? <> {shortOf} to go to earn Community XP.</>
              : <> Saving earns Community XP.</>
          )}
        </small>
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
  const [ledger, setLedger] = useState(null);
  const [config, setConfig] = useState(null);
  const [roleNote, setRoleNote] = useState('');
  const [skillFocus, setSkillFocus] = useState(null);   // a category id, or null for everything
  const [catLedger, setCatLedger] = useState(null);

  useEffect(() => {
    setP(null); setError(''); setRoleNote(''); setSkillFocus(null); setCatLedger(null);
    api(`/users/${encodeURIComponent(username)}`).then(setP).catch(e => setError(e.message));
    api(`/users/${encodeURIComponent(username)}/ledger`).then(setLedger).catch(() => {});
    api('/config').then(setConfig).catch(() => {});
  }, [username]);

  /* Refetch in place — no loading flash — so XP that just landed (the bio's
     intro receipt, say) appears live: skill numbers, RoboXP, bar, ledger. */
  const reloadXp = () => {
    api(`/users/${encodeURIComponent(username)}`).then(setP).catch(() => {});
    api(`/users/${encodeURIComponent(username)}/ledger`).then(setLedger).catch(() => {});
    if (skillFocus) {
      api(`/users/${encodeURIComponent(username)}/ledger?category=${skillFocus}`).then(setCatLedger).catch(() => {});
    }
  };

  /* Tapping a skill cell scopes the ledger to that category server-side, so
     a sparse skill's receipts are not lost behind the newest-100 window. */
  useEffect(() => {
    if (!skillFocus) { setCatLedger(null); return; }
    let live = true;
    api(`/users/${encodeURIComponent(username)}/ledger?category=${skillFocus}`)
      .then(r => { if (live) setCatLedger(r); }).catch(() => {});
    return () => { live = false; };
  }, [skillFocus, username]);

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
          <div className="profile-id">
            {/* The wedge ring IS the stat sheet (Avatar Spec): a full wedge is
                the mastery segment, a dark ring self-identifies a newcomer. */}
            <img className="avatar-svg" src={avatarUrl(p.username)} alt="" width="72" height="72" />
            <div>
              <h1 className="profile-name">
                {p.username}
                <span className="total-level" title="Overall level: the sum of all nine skill levels">
                  Lv {p.xp?.totalLevel ?? 0}
                </span>
                {p.role === 'admin' && <span className="tag admin-tag">admin</span>}
                {p.isSelf && <span className="tag">you</span>}
              </h1>
              <span className="stat">
                {p.xp?.primaryTitle && <>{p.xp.primaryTitle} · </>}
                {Math.round(p.xp?.roboXp ?? 0).toLocaleString()} RoboXP · joined {fmtDate(p.joined)}
              </span>
            </div>
          </div>
          {p.xp?.badges?.length > 0 && (
            <span className="badge-row">{p.xp.badges.map(b => <span key={b} className="tag">{b}</span>)}</span>
          )}
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          {p.isSelf && <Link className="btn btn-primary" to="/works/new">Add a work</Link>}
          {p.canManageRole && (p.role === 'admin'
            ? <button className="btn btn-ghost" disabled={roleBusy} onClick={() => setRole('user')}>Demote to member</button>
            : <button className="btn btn-ghost" disabled={roleBusy} onClick={() => setRole('admin')}>Promote to admin</button>)}
          {p.isSelf && <button className="btn btn-ghost logout-btn" onClick={signOut}>Log out</button>}
        </div>
      </div>
      {roleNote && <div className="notice" style={{ marginBottom: '1.5rem' }} role="status">{roleNote}</div>}

      <div className="profile-grid">
        <div>
          <div className="panel">
            {p.isSelf
              ? <BioEditor bio={p.bio}
                           introMinChars={config?.xp?.introBioMinChars || 0}
                           hasIntroXp={(p.xp?.skills.find(x => x.id === 'comm')?.xp || 0) > 0}
                           onSaved={bio => { setP({ ...p, bio }); refresh().catch(() => {}); reloadXp(); }} />
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
                        <strong>▲ {w.upvoteCount}</strong>{w.producedCount > 0 && <> · produced {w.producedCount}×</>} · {w.downloadCount} downloads · v{w.version}
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
          {p.xp && (
            <div className={'panel skill-panel' + (p.xp.innovation ? ' has-aura' : '')}>
              <h2>Skills</h2>
              {!skillFocus && <p className="stat skill-hint">Tap a skill to see its XP history.</p>}
              {/* Each cell opens that skill's own receipts below — where the
                  number came from, event by event. The grid reports; tapping
                  is the tooltip's deeper form, not a prompt. */}
              <div className="skill-grid">
                {p.xp.skills.map(s => (
                  <button key={s.id} type="button"
                          className={'skill-cell' + (s.level >= 99 ? ' maxed' : '') + (skillFocus === s.id ? ' on' : '')}
                          style={{ '--cat': s.color }}
                          aria-pressed={skillFocus === s.id}
                          onClick={() => setSkillFocus(skillFocus === s.id ? null : s.id)}
                          title={`${s.name}: ${s.scope}` +
                                 (s.nextLevelXp !== null ? `\n${Math.ceil(s.nextLevelXp - s.xp)} xp to level ${s.level + 1}` : '\nmaxed') +
                                 (s.title ? `\n${s.title}` : '')}>
                    <span className="skill-name">{s.name}</span>
                    <span className="skill-level">{s.level}</span>
                    <span className="skill-xp">{Math.round(s.xp).toLocaleString()} xp</span>
                  </button>
                ))}
              </div>
              {p.xp.innovation && (
                <button type="button" className={'innov-tier link-btn' + (skillFocus === 'innov' ? ' on' : '')}
                        aria-pressed={skillFocus === 'innov'}
                        onClick={() => setSkillFocus(skillFocus === 'innov' ? null : 'innov')}
                        title="Real-world impact of your ideas. Tap for its receipts.">
                  Innovation: {p.xp.innovation.tier}
                </button>
              )}
              {skillFocus && skillFocus !== 'innov' && (() => {
                const s = p.xp.skills.find(x => x.id === skillFocus);
                if (!s) return null;
                const maxed = s.nextLevelXp === null;
                // Progress within the current level, OSRS-style: floor to next.
                const span = maxed ? 1 : s.nextLevelXp - s.levelFloorXp;
                const pct = maxed ? 100 : Math.max(0, Math.min(100, ((s.xp - s.levelFloorXp) / span) * 100));
                return (
                  <div className="skill-detail" style={{ '--cat': s.color }}>
                    <strong>{s.name}</strong> · level {s.level}{s.title && <> · {s.title}</>}
                    <div className="xp-bar" role="progressbar" aria-valuenow={Math.round(pct)}
                         aria-valuemin={0} aria-valuemax={100}
                         aria-label={maxed ? `${s.name} maxed` : `${Math.round(pct)}% through level ${s.level}`}
                         title={maxed ? 'Maxed' : `${Math.round(s.xp - s.levelFloorXp).toLocaleString()} / ${span.toLocaleString()} into level ${s.level + 1}`}>
                      <span className={'xp-bar-fill' + (maxed ? ' is-maxed' : '')} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="stat">
                      {Math.round(s.xp).toLocaleString()} xp
                      {maxed
                        ? <> · maxed</>
                        : <> · {Math.ceil(s.nextLevelXp - s.xp).toLocaleString()} to level {s.level + 1}</>}
                      <br />{s.scope}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="panel" style={{ marginTop: p.xp ? '1.5rem' : 0 }}>
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

          {p.isSelf && (
            <EquipmentEditor owned={p.equipment || []} config={config}
                             onSaved={equipment => setP({ ...p, equipment })} />
          )}

          {(() => {
            /* One panel, two scopes: everything, or the tapped skill's own
               receipts with that category's share of each entry. */
            const shown = skillFocus ? catLedger : ledger;
            const focusSkill = skillFocus && skillFocus !== 'innov' && p.xp?.skills.find(x => x.id === skillFocus);
            const amountOf = (e) => skillFocus ? (e.split?.[skillFocus] ?? 0) : e.amount;
            if (!skillFocus && !(ledger?.entries?.length > 0)) return null;
            return (
              <div className="panel" style={{ marginTop: '1.5rem' }}>
                <div className="produced-head">
                  <h2>{skillFocus ? `${focusSkill ? focusSkill.name : 'Innovation'} ledger` : 'XP ledger'}</h2>
                  {skillFocus && <button type="button" className="link-btn" onClick={() => setSkillFocus(null)}>✕ all skills</button>}
                </div>
                {!shown ? <p className="stat">Loading…</p>
                  : shown.entries.length === 0 ? <p className="stat">Nothing has routed here yet.</p> : (
                  <ul className="xp-ledger">
                    {shown.entries.slice(0, 30).map((e, i) => (
                      <li key={i} className={amountOf(e) < 0 ? 'loss' : ''}>
                        <span className="xl-amt">{amountOf(e) > 0 ? '+' : ''}{Math.round(amountOf(e) * 10) / 10}</span>
                        {/* One short line per event, linked to its subject.
                            Struck/endorsed reasons stay unnamed on purpose:
                            naming the work would unmask an anonymous downvote. */}
                        <span className="xl-what">
                          {e.kind === 'publish' && <>published <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'publish-derived' && <>published <Link to={`/works/${e.workId}`}>{e.workTitle}</Link> (revision)</>}
                          {e.kind === 'version' && <>new version of <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'upvote' && <>upvote on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link>{e.by && <> by <Link to={`/user/${e.by}`}>@{e.by}</Link></>}</>}
                          {e.kind === 'downvote' && <>downvote on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'downvote-struck' && <>your downvote reason was struck</>}
                          {e.kind === 'reason-endorsed' && <>your downvote reason was endorsed</>}
                          {e.kind === 'referenced' && <><Link to={`/works/${e.workId}`}>{e.workTitle}</Link> used in {e.refTitle ? <Link to={`/works/${e.refId}`}>{e.refTitle}</Link> : 'another work'}{e.by && <> by <Link to={`/user/${e.by}`}>@{e.by}</Link></>}</>}
                          {e.kind === 'accepted-answer' && <>accepted answer on {e.talkId ? <Link to={`/talk/${e.talkId}`}>{e.talkTitle}</Link> : 'a question'}</>}
                          {e.kind === 'standard-compliance' && <>{e.refTitle ? <Link to={`/works/${e.refId}`}>{e.refTitle}</Link> : 'a work'} verified compliant with <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'build' && <>verified build of <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'build-fit' && <>fit findings on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'build-author' && <><Link to={`/works/${e.workId}`}>{e.workTitle}</Link> built{e.by && <> by <Link to={`/user/${e.by}`}>@{e.by}</Link></>}</>}
                          {e.kind === 'fit-report' && <>fit report on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'fit-confirmed' && <>real use of <Link to={`/works/${e.workId}`}>{e.workTitle}</Link> confirmed{e.by && <> by <Link to={`/user/${e.by}`}>@{e.by}</Link></>}</>}
                          {e.kind === 'entry-upvote' && <>your result on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link> upvoted{e.by && <> by <Link to={`/user/${e.by}`}>@{e.by}</Link></>}</>}
                          {e.kind === 'entry-downvote' && <>downvote on your result on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'doc-revision' && <>doc revision accepted on <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                          {e.kind === 'moderation' && <>moderation action upheld</>}
                          {e.kind === 'profile-bio' && <>introduced yourself</>}
                        </span>
                        <span className="when">{fmtDate(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="stat" style={{ marginTop: '.5rem' }}>
                  {skillFocus
                    ? 'Only what routed into this skill, with its share of each event.'
                    : 'Every number above decomposes into these receipts. Public by default.'}
                </p>
              </div>
            );
          })()}

          <div className="panel" style={{ marginTop: '1.5rem' }}>
            <h2>Recent comments</h2>
            {p.comments.length === 0 ? <p className="stat">Nothing yet.</p> : (
              <ul className="comment-feed">
                {p.comments.map(c => (
                  <li key={c.id}>
                    {c.work
                      ? <Link to={`/works/${c.work.id}`}>{c.work.title}</Link>
                      : c.post
                        ? <Link to={`/talk/${c.post.id}`}>Talk: {c.post.title}</Link>
                        : <em>removed</em>}
                    <span className="when" title={fmtExact(c.createdAt)}>{fmtWhen(c.createdAt)}</span>
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
