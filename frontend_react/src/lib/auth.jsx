import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api('/auth/me').then(d => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const finish = (d) => { setToken(d.token); setUser(d.user); return d; };
  const value = {
    user, ready,
    login: (creds) => api('/auth/login', { method: 'POST', body: creds }).then(finish),
    register: (creds) => api('/auth/register', { method: 'POST', body: creds }).then(finish),
    // Google Identity Services hands us an ID token; the server verifies it.
    google: (credential) => api('/auth/google', { method: 'POST', body: { credential } }).then(finish),
    // Called after the verify link is used, so the app sees emailVerified without a re-login.
    adopt: finish,
    refresh: () => api('/auth/me').then(d => { setUser(d.user); return d.user; }),
    logout: () => { setToken(null); setUser(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
