import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useConfig } from '../lib/config.js';
import GoogleButton from '../components/GoogleButton.jsx';

export default function Register() {
  const { register, google } = useAuth();
  const config = useConfig();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);   // set once the account exists
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await register(form);
      // Nothing to confirm when verification is off: straight into the works.
      if (!config?.emailVerificationRequired) return nav('/works', { replace: true });
      setSent(res.verification || { sent: false });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function withGoogle(credential) {
    setError('');
    try { await google(credential); nav('/works', { replace: true }); }
    catch (err) { setError(err.message); }
  }

  if (sent) {
    return (
      <div className="form-card">
        <h1>Check your email</h1>
        <p>
          {sent.sent
            ? <>A confirmation link is on its way to <strong>{form.email}</strong>. It is good for 24 hours.</>
            : <>Your account is made, but the confirmation email could not be sent. Try the resend button in the banner, or email us.</>}
        </p>
        {sent.link && (
          <p className="form-foot">
            Mail is off on this server, so here is the link: <a href={sent.link}>confirm this account</a>
          </p>
        )}
        <p className="form-foot">You can look around while you wait. <Link to="/works">Browse the works</Link></p>
      </div>
    );
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <h1>Create an account</h1>
      <p className="form-intro">You only need one to post a work or leave a comment. Browsing and downloading are open to everyone.</p>
      {error && (
        <div className="form-error" role="alert">
          {error}
          {suggestion && <>
            {' '}
            <button type="button" className="link-btn"
                    onClick={() => { setForm({ ...form, username: suggestion }); setError(''); setSuggestion(''); }}>
              Use {suggestion} instead
            </button>
          </>}
        </div>
      )}
      <GoogleButton clientId={config?.googleClientId} onCredential={withGoogle} onError={setError} />
      <div className="field"><label htmlFor="u">Username</label>
        <input id="u" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-]+" autoComplete="username"
               value={form.username} onChange={set('username')} />
        <small>Letters, numbers, dashes and underscores.</small></div>
      <div className="field"><label htmlFor="e">Email</label>
        <input id="e" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        {config?.emailVerificationRequired && <small>You will get a link to confirm it.</small>}</div>
      <div className="field"><label htmlFor="p">Password</label>
        <input id="p" type="password" required minLength={8} autoComplete="new-password"
               value={form.password} onChange={set('password')} />
        <small>At least 8 characters.</small></div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      <p className="form-foot">Already have one? <Link to="/login">Log in</Link></p>
    </form>
  );
}
