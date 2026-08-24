import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTitle } from '../lib/title.js';
import { useConfig } from '../lib/config.js';
import GoogleButton from '../components/GoogleButton.jsx';

export default function Login() {
  useTitle('Log in');
  const { login, google } = useAuth();
  const config = useConfig();
  const nav = useNavigate();
  const from = useLocation().state?.from || '/works';
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(form); nav(from, { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function withGoogle(credential) {
    setError('');
    try { await google(credential); nav(from, { replace: true }); }
    catch (err) { setError(err.message); }
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <h1>Log in</h1>
      {error && <div className="form-error" role="alert">{error}</div>}
      <GoogleButton clientId={config?.googleClientId} onCredential={withGoogle} onError={setError} />
      <div className="field"><label htmlFor="u">Username or email</label>
        <input id="u" autoComplete="username" required value={form.username}
               onChange={e => setForm({ ...form, username: e.target.value })} /></div>
      <div className="field"><label htmlFor="p">Password</label>
        <input id="p" type="password" autoComplete="current-password" required value={form.password}
               onChange={e => setForm({ ...form, password: e.target.value })} /></div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p className="form-foot">No account? <Link to="/register">Create one</Link></p>
    </form>
  );
}
