import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { api } from './lib/api.js';
import { useAuth } from './lib/auth.jsx';
import { useConfig } from './lib/config.js';

/* Shown until the address is confirmed. Reading is unaffected; posting is what
   the server blocks, so the banner explains why and offers another email. */
function VerifyBanner() {
  const { user, refresh } = useAuth();
  const config = useConfig();
  const [state, setState] = useState(null);

  if (!user || user.emailVerified || !config?.emailVerificationRequired) return null;

  async function resend() {
    setState('sending');
    try {
      const r = await api('/auth/resend', { method: 'POST' });
      if (r.alreadyVerified) { await refresh(); return; }
      setState(r.link ? `Mail is off on this server. Link: ${r.link}` : r.sent ? 'Sent. Check your inbox.' : 'Could not send it just now.');
    } catch (err) { setState(err.message); }
  }

  return (
    <div className="verify-banner" role="status">
      <span>Confirm your email to post works and comments.</span>
      {state === 'sending'
        ? <span className="stat">Sending…</span>
        : <button type="button" className="btn btn-ghost btn-sm" onClick={resend}>Resend the email</button>}
      {state && state !== 'sending' && <span className="stat">{state}</span>}
    </div>
  );
}

// Mirrors the "site nav" block in the flat HTML pages so the React pages look identical.
/* §7.1: the level-up moment is a single small toast, "Mechanical 23 to 24",
   that dismisses itself. The permanent record is the profile ledger, not the
   animation. Levels come from /auth/me; the last-seen set lives in the browser. */
function LevelToasts({ user }) {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!user || !user.levels) return;
    const key = `rk_levels_${user.id}`;
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
    const risen = Object.entries(user.levels)
      .filter(([id, lvl]) => lvl > (seen[id] ?? 0) && Object.keys(seen).length > 0)
      .map(([id, lvl]) => ({ id, from: seen[id] ?? 0, to: lvl }));
    try { localStorage.setItem(key, JSON.stringify(user.levels)); } catch {}
    if (!risen.length) return;
    setToasts(risen);
    const t = setTimeout(() => setToasts([]), 5000);
    return () => clearTimeout(t);
  }, [user]);

  if (!toasts.length) return null;
  return (
    <div className="level-toasts" role="status">
      {toasts.map(t => (
        <div key={t.id} className="level-toast">
          {t.id.charAt(0).toUpperCase() + t.id.slice(1)} level {t.from} to {t.to}
        </div>
      ))}
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <nav className="site-nav" aria-label="Main">
          <a className="site-logo" href="/" aria-label="Robo Kyle home">
            <span className="logo-mark" aria-hidden="true"></span>
            <span className="logo-word">Robo Kyle</span>
          </a>
          <button className="nav-toggle" type="button" aria-expanded={open} aria-controls="site-menu"
                  aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(o => !o)}>
            <span className="nav-toggle-bars" aria-hidden="true"><span></span><span></span><span></span></span>
            <span className="nav-toggle-text">Menu</span>
          </button>
          <ul id="site-menu" className={'nav-links' + (open ? ' is-open' : '')}>
            <li><a href="/about.html">About</a></li>
            <li><NavLink className="nav-strong" to="/works">Works</NavLink></li>
            <li><NavLink to="/creators">Creators</NavLink></li>
            <li><NavLink to="/talk">Talk</NavLink></li>
            {/* One slot either way, so the nav does not change shape when you sign in. */}
            {user
              ? <li><NavLink to={`/user/${user.username}`}>Profile</NavLink></li>
              : <li><NavLink to="/login">Log in</NavLink></li>}
          </ul>
        </nav>
      </header>
      <LevelToasts user={user} />
      <main id="main" className="app-main">
        <div className="wrap"><VerifyBanner /><Outlet /></div>
      </main>
      {/* Same footer as the flat pages, so it does not change when you cross
          from about.html into the app. */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-brand">
              <a className="site-logo" href="/" aria-label="Robo Kyle home">
                <span className="logo-mark" aria-hidden="true"></span>
                <span className="logo-word">Robo Kyle</span>
              </a>
              <p>Free designs for adaptive gear anyone can build, shared by the people who made them.</p>
            </div>
            <div>
              <h4>Site</h4>
              <ul>
                <li><Link to="/works">Works</Link></li>
                <li><Link to="/talk">Talk</Link></li>
                <li><Link to="/creators">Creators</Link></li>
                <li><a href="/about.html">About</a></li>
                <li><a href="/public/game/game.html">Game</a></li>
              </ul>
            </div>
            <div>
              <h4>Get in touch</h4>
              <ul>
                <li><a href="mailto:robokyleorg@gmail.com">robokyleorg@gmail.com</a></li>
                <li><a href="https://github.com/taborgreat/robokyle">GitHub</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>&copy; {new Date().getFullYear()} Robo Kyle</span>
            <span>Everything here is free to download and build.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
