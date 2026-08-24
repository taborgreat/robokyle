import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl, avatarUrl, getConfig } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { SkillIcon, ToolIcon, LevelFraction } from '../rs.jsx';
import { useTitle } from '../lib/title.js';

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtExact = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const toolLabel = (id) => id.replace(/-/g, ' ');

function Stat({ n, label }) {
  return <div className="profile-stat"><span className="n rs-num">{n}</span><span className="l">{label}</span></div>;
}

/* ============================================================
   The skills panel (RS Profile Spec §2): the old-RuneScape stats
   tab. 3 x 3 cells in registry order, each an icon and the gold
   level-over-99 fraction; total level and RoboXP in the bottom
   rows; Innovation as a tier-name strip. Hover is a chromed
   tooltip; tapping a cell scopes the ledger to that skill.
   Identical for the owner and everyone else.
   ============================================================ */
function SkillsPanel({ xpv, skillFocus, setSkillFocus, bio }) {
  return (
    <div className={'panel rs-skills' + (xpv.innovation ? ' has-aura' : '')}>
      <div className="rs-skill-grid">
        {xpv.skills.map(s => (
          <button key={s.id} type="button"
                  className={'rs-skill-cell rs-tipwrap' + (s.level >= 99 ? ' maxed' : '') + (skillFocus === s.id ? ' on' : '')}
                  style={{ '--cat': s.color }}
                  aria-pressed={skillFocus === s.id}
                  aria-label={`${s.name}, level ${s.level}`}
                  onClick={() => setSkillFocus(skillFocus === s.id ? null : s.id)}>
            <SkillIcon id={s.id} name={s.name} color={s.color} size={20} />
            <LevelFraction level={s.level} />
            <span className="rs-tip" role="tooltip">
              <strong>{s.name}</strong>
              <span className="rs-tip-scope">{s.scope}</span>
              <span className="rs-tip-line">{Math.round(s.xp).toLocaleString()} xp</span>
              <span className="rs-tip-line">{s.nextLevelXp === null
                ? 'maxed'
                : `${Math.ceil(s.nextLevelXp - s.xp).toLocaleString()} xp to level ${s.level + 1}`}</span>
              {s.title && <span className="rs-tip-line">{s.title}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="rs-total-row">
        <span>Total level:</span>
        <span className="rs-num rs-total-num">{xpv.totalLevel}</span>
      </div>
      <div className="rs-total-row rs-robo-row">
        <span>RoboXP</span>
        <span className="rs-num">{Math.round(xpv.roboXp ?? 0).toLocaleString()}</span>
      </div>
      {xpv.innovation && (
        <button type="button"
                className={'rs-innov-strip' + (skillFocus === 'innov' ? ' on' : '')}
                aria-pressed={skillFocus === 'innov'}
                onClick={() => setSkillFocus(skillFocus === 'innov' ? null : 'innov')}
                title="The real-world impact of your ideas">
          Innovation: {xpv.innovation.tier}
        </button>
      )}
      {skillFocus && skillFocus !== 'innov' && (() => {
        const s = xpv.skills.find(x => x.id === skillFocus);
        if (!s) return null;
        const maxed = s.nextLevelXp === null;
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
              {maxed ? <> · maxed</> : <> · {Math.ceil(s.nextLevelXp - s.xp).toLocaleString()} to level {s.level + 1}</>}
            </span>
          </div>
        );
      })()}
      {bio}
    </div>
  );
}

/* One work as one item in a slot: image cropped square, Produced count as
   the stack number top-left, examine text on hover. */
function WorkSlot({ w, isSelf, dragProps }) {
  const catId = w.categories?.[0]?.id;
  const examine = (w.description || '').length > 140 ? w.description.slice(0, 140) + '…' : w.description;
  return (
    <Link to={`/works/${w.id}`} className="rs-slot rs-item rs-tipwrap" {...(dragProps || {})}>
      {w.thumbUrl
        ? <img className="rs-item-img" src={fileUrl(w.thumbUrl)} alt="" loading="lazy" />
        : <SkillIcon id={catId || 'mech'} name={w.title} size={24} />}
      {w.producedCount > 0 && <span className="rs-num rs-stack">{w.producedCount}</span>}
      <span className="rs-tip" role="tooltip">
        <strong>{w.title}</strong>
        {examine && <em className="rs-examine">{examine}</em>}
        {w.producedCount > 0 && <span className="rs-tip-line">produced {w.producedCount}×</span>}
        {isSelf && <span className="rs-tip-line">drag to reorder</span>}
      </span>
    </Link>
  );
}

/* ============================================================
   The inventory (§3): 4 wide, 7 tall, 28 slots — works as items.
   Empty slots are open recessed wells. The owner drags to curate
   the front-of-bag order (saved to the profile); more than 28
   works opens the bank view with per-skill tabs.
   ============================================================ */
function Inventory({ p, isSelf, config }) {
  const [order, setOrder] = useState(p.works);
  const [bank, setBank] = useState(null);        // null closed, [] loading done
  const [bankOpen, setBankOpen] = useState(false);
  const [bankTab, setBankTab] = useState('');
  const dragFrom = useRef(null);
  useEffect(() => { setOrder(p.works); }, [p.works]);

  const total = p.stats.works;
  const slots = [...order.slice(0, 28)];
  while (slots.length < 28) slots.push(null);

  function drop(i) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === i || !order[from]) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(Math.min(i, next.length), 0, moved);
    setOrder(next);
    api('/users/me', { method: 'PATCH', body: { inventoryOrder: next.map(w => String(w.id)) } }).catch(() => {});
  }

  async function openBank() {
    setBankOpen(true);
    if (bank) return;
    try {
      const r = await api(`/designs?by=${encodeURIComponent(p.username)}&limit=50&sort=new`);
      setBank(r.items);
    } catch { setBank([]); }
  }

  const cats = (config?.xp?.categories || []).filter(c => !c.hidden);
  const catOf = (w) => w.categories?.[0]?.id;
  const bankCats = bank ? cats.filter(c => bank.some(w => catOf(w) === c.id)) : [];
  const bankShown = bank ? (bankTab ? bank.filter(w => catOf(w) === bankTab) : bank) : null;

  return (
    <div className="panel rs-inv-panel">
      <div className="produced-head">
        <h2>{isSelf ? 'Your works' : `Works by ${p.username}`} <span className="rs-num">{total}</span></h2>
        {isSelf && <Link className="btn btn-build btn-sm" to="/works/new">Create</Link>}
      </div>
      {total === 0 && (
        <p className="stat">
          {isSelf ? <>Nothing in the bag yet. <Link to="/works/new">Create your first work</Link>.</> : 'Nothing posted yet.'}
        </p>
      )}
      <div className="rs-inv" role="list">
        {slots.map((w, i) => w ? (
          <WorkSlot key={String(w.id)} w={w} isSelf={isSelf}
                    dragProps={isSelf ? {
                      draggable: true,
                      onDragStart: (e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; },
                      onDragOver: (e) => e.preventDefault(),
                      onDrop: (e) => { e.preventDefault(); drop(i); },
                    } : {
                      onDragOver: undefined,
                    }} />
        ) : (
          <span key={`empty-${i}`} className="rs-slot rs-empty" aria-hidden="true"
                onDragOver={isSelf ? (e) => e.preventDefault() : undefined}
                onDrop={isSelf ? (e) => { e.preventDefault(); drop(order.length - 1); } : undefined} />
        ))}
      </div>
      {total > 28 && !bankOpen && (
        <button type="button" className="rs-bankbar" onClick={openBank}>View all {total}</button>
      )}
      {bankOpen && (
        <div className="rs-bank">
          <div className="rs-bank-tabs" role="tablist">
            <button type="button" className={'rs-bank-tab' + (bankTab === '' ? ' on' : '')}
                    onClick={() => setBankTab('')}>All</button>
            {bankCats.map(c => (
              <button key={c.id} type="button" className={'rs-bank-tab' + (bankTab === c.id ? ' on' : '')}
                      style={{ '--cat': c.color }} onClick={() => setBankTab(c.id)}>
                <SkillIcon id={c.id} name={c.name} color={c.color} size={18} />
              </button>
            ))}
            <button type="button" className="link-btn" style={{ marginLeft: 'auto' }}
                    onClick={() => setBankOpen(false)}>close</button>
          </div>
          {!bankShown ? <p className="stat">Loading…</p> : (
            <div className="rs-inv rs-inv-bank">
              {bankShown.map(w => <WorkSlot key={String(w.id)} w={w} />)}
            </div>
          )}
        </div>
      )}
      {p.contributions?.length > 0 && (
        <p className="stat rs-contrib">
          Contributed to:{' '}
          {p.contributions.map((c, i) => (
            <span key={String(c.id)}>{i > 0 && ', '}<Link to={`/works/${c.id}`}>{c.title}</Link></span>
          ))}
          {' '}(accepted doc revisions)
        </p>
      )}
    </div>
  );
}

/* ============================================================
   The tools panel (§4): what you own, one slot per equipment
   item, public by default with a hide toggle. On your own view
   an add slot opens the vocabulary picker, and the checkbox
   under the shelf applies the buildable filter site-wide —
   your equipment IS the filter.
   ============================================================ */
function ToolsPanel({ p, setP, config }) {
  const isSelf = p.isSelf;
  const owned = p.equipment || [];
  const items = config?.xp?.equipmentItems || [];
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isSelf && (owned.length === 0)) return null;

  async function save(next) {
    setBusy(true);
    try { await api('/users/me', { method: 'PATCH', body: { equipment: next } }); setP({ ...p, equipment: next }); }
    catch {} finally { setBusy(false); }
  }
  async function toggleHidden() {
    const next = !p.equipmentHidden;
    setP({ ...p, equipmentHidden: next });
    try { await api('/users/me', { method: 'PATCH', body: { equipmentHidden: next } }); } catch {}
  }
  const unowned = items.filter(i => !owned.includes(i));
  return (
    <div className="panel rs-tools">
      <h2>Tools</h2>
      <div className="rs-toolrow">
        {owned.map(id => (
          <span key={id} className="rs-slot rs-tool rs-tipwrap" tabIndex={0}>
            <ToolIcon id={id} />
            <span className="rs-tip" role="tooltip">
              <strong>{toolLabel(id)}</strong>
              {isSelf && <span className="rs-tip-line">click × to remove</span>}
            </span>
            {isSelf && (
              <button type="button" className="rs-tool-x" aria-label={`Remove ${toolLabel(id)}`}
                      disabled={busy} onClick={() => save(owned.filter(x => x !== id))}>×</button>
            )}
          </span>
        ))}
        {isSelf && (
          <button type="button" className="rs-slot rs-ghost" aria-label="Add a tool"
                  onClick={() => setPicking(!picking)}>+</button>
        )}
      </div>
      {picking && (
        <div className="rs-tool-picker">
          {unowned.length === 0 ? <p className="stat">You own everything on the list.</p> : unowned.map(id => (
            <button key={id} type="button" className="tag need-chip" disabled={busy}
                    onClick={() => save([...owned, id])}>{toolLabel(id)}</button>
          ))}
        </div>
      )}
      {isSelf && (
        <div className="rs-tool-prefs">
          <label>
            <input type="checkbox" checked={!!p.equipmentHidden} onChange={toggleHidden} />
            <span>Hide my tools from other people</span>
          </label>
        </div>
      )}
      {!isSelf && <p className="stat">Works show whether this member could build them from this shelf.</p>}
    </div>
  );
}

function BioEditor({ bio, onSaved, introMinChars, hasIntroXp }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
        <button type="button" className="link-btn" onClick={() => { setText(bio); setEditing(true); }}>
          {bio ? 'edit' : 'add a bio'}
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

/* What happened to your things since you last looked: comments, builds, doc
   revisions, replies, forks. Derived server-side from the domain data; opening
   the panel marks it seen, and new items glow until then. Own profile only. */
/* One notification line, live or dead: who did what to which of your things. */
function NotifList({ items }) {
  return (
    <ul className="notif-list">
      {items.map((n, i) => (
        <li key={i} className={n.isNew ? 'is-new' : ''}>
          {n.who ? <Link to={`/user/${n.who}`}>{n.who}</Link> : 'someone'}{' '}
          {n.verb}{' '}
          {n.link ? <Link to={n.link}>{n.about}</Link> : n.about}
          <span className="when">{fmtWhen(n.at)}</span>
          {n.snippet && (n.link
            ? <Link className="notif-snippet" to={n.link}>{n.snippet}</Link>
            : <span className="notif-snippet">{n.snippet}</span>)}
        </li>
      ))}
    </ul>
  );
}

export default function Profile() {
  const { username } = useParams();
  useTitle(username);
  const { logout, refresh } = useAuth();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendDays, setSuspendDays] = useState('7');
  const [suspendWhy, setSuspendWhy] = useState('');
  const [ledger, setLedger] = useState(null);
  const [config, setConfig] = useState(null);
  const [roleNote, setRoleNote] = useState('');
  const [skillFocus, setSkillFocus] = useState(null);   // a category id, or null for everything
  const [catLedger, setCatLedger] = useState(null);
  const [notif, setNotif] = useState(null);             // own profile: {items, unseen}

  /* Notifications split by life: new ones ride high in the side stack with
     the green dot; once seen they fall to Dead notifications at the bottom.
     Opening the page is what marks them seen. */
  useEffect(() => {
    if (!p?.isSelf) { setNotif(null); return; }
    let live = true;
    api('/users/me/notifications').then(r => {
      if (!live) return;
      setNotif(r);
      if (r.unseen > 0) api('/users/me/notifications/seen', { method: 'POST' }).catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, [p?.isSelf, username]);

  useEffect(() => {
    setP(null); setError(''); setRoleNote(''); setSkillFocus(null); setCatLedger(null);
    api(`/users/${encodeURIComponent(username)}`).then(setP).catch(e => setError(e.message));
    api(`/users/${encodeURIComponent(username)}/ledger`).then(setLedger).catch(() => {});
    getConfig().then(setConfig).catch(() => {});
  }, [username]);

  const reloadXp = () => {
    api(`/users/${encodeURIComponent(username)}`).then(setP).catch(() => {});
    api(`/users/${encodeURIComponent(username)}/ledger`).then(setLedger).catch(() => {});
    if (skillFocus) {
      api(`/users/${encodeURIComponent(username)}/ledger?category=${skillFocus}`).then(setCatLedger).catch(() => {});
    }
  };

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

  /* The bio at the skills panel's foot: character-sheet flavor text. */
  const bioBlock = (
    <div className="rs-bio">
      <span className="rs-bio-label">About</span>
      {p.isSelf
        ? <BioEditor bio={p.bio}
                     introMinChars={config?.xp?.introBioMinChars || 0}
                     hasIntroXp={(p.xp?.skills.find(x => x.id === 'comm')?.xp || 0) > 0}
                     onSaved={bio => { setP({ ...p, bio }); refresh().catch(() => {}); reloadXp(); }} />
        : (p.bio ? <p className="desc">{p.bio}</p> : <p className="stat">This member has not written a bio.</p>)}
    </div>
  );

  return (
    <>
      <div className="app-head">
        <div>
          <div className="profile-id">
            {/* The wedge ring IS the stat sheet (Avatar Spec): a full wedge is
                the mastery segment, a dark ring self-identifies a newcomer. */}
            <img className="avatar-svg" src={avatarUrl(p.username)} alt="" width="80" height="80" />
            <div>
              <h1 className="profile-name">
                {p.username}
                <span className="total-level" title="The sum of all nine skill levels">
                  Lv <span className="rs-num">{p.xp?.totalLevel ?? 0}</span>
                </span>
                {p.role === 'admin' && <span className="tag admin-tag">admin</span>}
                {p.suspended && <span className="tag miss-tag" title={p.suspended.reason || undefined}>
                  suspended until {fmtDate(p.suspended.until)}</span>}
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
          {p.canManageRole && (p.role === 'admin'
            ? <button className="btn btn-ghost" disabled={roleBusy} onClick={() => setRole('user')}>Demote to member</button>
            : <button className="btn btn-ghost" disabled={roleBusy} onClick={() => setRole('admin')}>Promote to admin</button>)}
          {p.canManageRole && p.role !== 'admin' && (
            <button className="btn btn-ghost" disabled={roleBusy} onClick={async () => {
              setRoleBusy(true);
              try {
                await api(`/users/${encodeURIComponent(username)}/role`, { method: 'POST', body: { mod: !p.isMod } });
                setP({ ...p, isMod: !p.isMod });
              } catch (err) { setRoleNote(err.message); }
              finally { setRoleBusy(false); }
            }}>{p.isMod ? 'Remove mod' : 'Make mod'}</button>
          )}
          {p.canModerate && p.role !== 'admin' && (p.suspended
            ? <button className="btn btn-ghost" disabled={roleBusy} onClick={async () => {
                try { await api(`/users/${encodeURIComponent(username)}/unsuspend`, { method: 'POST', body: {} }); setP({ ...p, suspended: null }); }
                catch (err) { setRoleNote(err.message); }
              }}>Lift suspension</button>
            : <button className="btn btn-ghost logout-btn" onClick={() => setSuspendOpen(o => !o)}>Suspend</button>)}
          {p.isSelf && <button className="btn btn-ghost logout-btn" onClick={signOut}>Log out</button>}
        </div>
      </div>
      {roleNote && <div className="notice" style={{ marginBottom: '1.5rem' }} role="status">{roleNote}</div>}
      {suspendOpen && !p.suspended && (
        <form className="panel" style={{ marginBottom: '1.5rem' }}
              onSubmit={async e => {
                e.preventDefault();
                try {
                  const r = await api(`/users/${encodeURIComponent(username)}/suspend`,
                    { method: 'POST', body: { days: Number(suspendDays), reason: suspendWhy } });
                  setP({ ...p, suspended: { until: r.until, reason: suspendWhy } });
                  setSuspendOpen(false); setSuspendWhy('');
                } catch (err) { setRoleNote(err.message); }
              }}>
          <div className="toolbar" style={{ margin: 0, alignItems: 'center' }}>
            <span>Suspend for</span>
            <select value={suspendDays} onChange={e => setSuspendDays(e.target.value)} aria-label="Days">
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <input style={{ flex: 1, minWidth: '12rem' }} required maxLength={300} placeholder="Why, in one line (they will see this)"
                   value={suspendWhy} onChange={e => setSuspendWhy(e.target.value)} />
            <button className="btn btn-danger btn-sm" disabled={suspendWhy.trim().length < 5}>Suspend</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSuspendOpen(false)}>Cancel</button>
          </div>
          <p className="stat" style={{ margin: '.5rem 0 0' }}>They keep reading, every action refuses until the date, and the suspension shows on this profile.</p>
        </form>
      )}

      {/* §5 composition: skills fixed left, the bag and the shelf right,
          ledger full-width beneath, conversation panels last. */}
      <div className="rs-layout">
        <div className="rs-left">
          {p.xp
            ? <SkillsPanel xpv={p.xp} skillFocus={skillFocus} setSkillFocus={setSkillFocus} bio={bioBlock} />
            : <div className="panel rs-skills">{bioBlock}</div>}
        </div>

        <div className="rs-mainCol">
          <div className="rs-row">
            <Inventory p={p} isSelf={p.isSelf} config={config} />
            <div className="rs-sideStack">
              {/* Only exists while there is news; quiet days keep the stack clean.
                  Everything already seen lives in Dead notifications below. */}
              {p.isSelf && notif && notif.items.some(n => n.isNew) && (
                <div className="panel">
                  <h2><span className="notif-dot live" aria-hidden="true"></span>Notifications
                    <span className="tag endorsed-tag"> {notif.items.filter(n => n.isNew).length} new</span>
                  </h2>
                  <NotifList items={notif.items.filter(n => n.isNew)} />
                </div>
              )}
              <ToolsPanel p={p} setP={setP} config={config} />
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
            </div>
          </div>
        </div>
      </div>

      {(() => {
        const shown = skillFocus ? catLedger : ledger;
        const focusSkill = skillFocus && skillFocus !== 'innov' && p.xp?.skills.find(x => x.id === skillFocus);
        const amountOf = (e) => skillFocus ? (e.split?.[skillFocus] ?? 0) : e.amount;
        if (!skillFocus && !(ledger?.entries?.length > 0)) return null;
        return (
          <div className="panel rs-ledger">
            <div className="produced-head">
              <h2>{skillFocus ? `${focusSkill ? focusSkill.name : 'Innovation'} ledger` : 'XP ledger'}</h2>
              {skillFocus && <button type="button" className="link-btn" onClick={() => setSkillFocus(null)}>✕ all skills</button>}
            </div>
            {!shown ? <p className="stat">Loading…</p>
              : shown.entries.length === 0 ? <p className="stat">Nothing has routed here yet.</p> : (
              <ul className="xp-ledger">
                {shown.entries.slice(0, 30).map((e, i) => (
                  <li key={i} className={amountOf(e) < 0 ? 'loss' : ''}>
                    <span className="xl-amt rs-num">{amountOf(e) > 0 ? '+' : ''}{Math.round(amountOf(e) * 10) / 10}</span>
                    {/* One short line per event, linked to its subject.
                        Struck/endorsed reasons stay unnamed on purpose:
                        naming the work would unmask an anonymous downvote. */}
                    <span className="xl-what">
                      {e.kind === 'publish' && <>published <Link to={`/works/${e.workId}`}>{e.workTitle}</Link></>}
                      {e.kind === 'publish-derived' && <>published <Link to={`/works/${e.workId}`}>{e.workTitle}</Link> (remix)</>}
                      {e.kind === 'remixed' && <><Link to={`/works/${e.workId}`}>{e.workTitle}</Link> remixed as {e.refTitle ? <Link to={`/works/${e.refId}`}>{e.refTitle}</Link> : 'another work'}{e.by && <> by <Link to={`/user/${e.by}`}>@{e.by}</Link></>}</>}
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
            {skillFocus && (
              <p className="stat" style={{ marginTop: '.5rem' }}>
                Only what routed into this skill, with its share of each event.
              </p>
            )}
          </div>
        );
      })()}

      <div className="rs-below">
        {p.talk?.posts?.length > 0 && (
          <div className="panel">
            <h2>Talk</h2>
            {p.talk.accepted > 0 && (
              <p className="stat">{p.talk.accepted} answer{p.talk.accepted === 1 ? '' : 's'} accepted by other people.</p>
            )}
            <ul className="talk-feed">
              {p.talk.posts.map(t => (
                <li key={String(t.id)}>
                  <span className="tag">{t.type === 'linked' ? 'about a work' : t.type}</span>
                  <Link to={`/talk/${t.id}`}>{t.title}</Link>
                  {t.status && <span className={'stat' + (t.status === 'became a work' ? ' talk-became' : '')}> · {t.status}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="panel">
          <h2>Recent comments</h2>
          {p.comments.length === 0 ? <p className="stat">Nothing yet.</p> : (
            <ul className="comment-feed">
              {p.comments.map(c => (
                <li key={c.id}>
                  <span className="cf-meta">
                    {(() => {
                      const src = c.post ? 'talk' : c.kind === 'produced' ? 'result' : 'work';
                      return <span className={`tag src-${src}`}>{src}</span>;
                    })()}
                    {c.work
                      ? <Link to={`/works/${c.work.id}#c-${c.id}`}>{c.work.title}</Link>
                      : c.post
                        ? <Link to={`/talk/${c.post.id}#c-${c.id}`}>{c.post.title}</Link>
                        : <em>removed</em>}
                    {c.accepted && <span className="tag endorsed-tag">✓ accepted answer</span>}
                    {c.upvoteCount > 0 && <span className="stat">▲ <span className="rs-num">{c.upvoteCount}</span></span>}
                    <span className="when" title={fmtExact(c.createdAt)}>{fmtWhen(c.createdAt)}</span>
                  </span>
                  {(() => {
                    const to = c.work ? `/works/${c.work.id}#c-${c.id}` : c.post ? `/talk/${c.post.id}#c-${c.id}` : null;
                    const text = c.body.length > 180 ? c.body.slice(0, 180) + '…' : c.body;
                    return to ? <Link className="cf-quote" to={to}>{text}</Link> : <p className="cf-quote">{text}</p>;
                  })()}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The graveyard: already-seen notifications, visible only to you.
            They fall here so the panel up top stays only what is new. */}
        {p.isSelf && notif && notif.items.some(n => !n.isNew) && (
          <div className="panel">
            <h2><span className="notif-dot dead" aria-hidden="true"></span>Dead notifications</h2>
            <NotifList items={notif.items.filter(n => !n.isNew)} />
          </div>
        )}
      </div>
    </>
  );
}
