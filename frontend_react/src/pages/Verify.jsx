import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

// Landing page for the link in the verification email: /verify?token=...
export default function Verify() {
  const [params] = useSearchParams();
  const { adopt } = useAuth();
  const [state, setState] = useState('working');
  const [error, setError] = useState('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;          // StrictMode mounts twice in dev
    once.current = true;
    const token = params.get('token');
    if (!token) { setState('bad'); setError('That link is missing its token.'); return; }
    api('/auth/verify', { method: 'POST', body: { token } })
      .then(d => { adopt(d); setState('done'); })
      .catch(err => { setError(err.message); setState('bad'); });
  }, []);

  return (
    <div className="form-card">
      {state === 'working' && <p className="empty">Confirming your email…</p>}
      {state === 'done' && (
        <>
          <h1>You are all set</h1>
          <p>Your email is confirmed and you are signed in. You can post works and comment now.</p>
          <p><Link className="btn btn-primary" to="/works">Browse the works <span className="arrow" aria-hidden="true">&rarr;</span></Link></p>
        </>
      )}
      {state === 'bad' && (
        <>
          <h1>That link did not work</h1>
          <div className="form-error" role="alert">{error}</div>
          <p className="form-foot">Log in and use the resend button in the banner to get a fresh one.</p>
          <p><Link className="btn btn-ghost" to="/login">Log in</Link></p>
        </>
      )}
    </div>
  );
}
