/* Where the API lives, decided at run time rather than baked in:
   - served by the Node server locally, the API is the same origin, so ''
   - served by GitHub Pages, it is a different host, so the built-in URL
   window.RK_API_URL overrides both, the same escape hatch public/site.js has. */
const BUILT_IN_API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', ''];

function apiBase() {
  if (typeof window === 'undefined') return BUILT_IN_API;
  if (window.RK_API_URL != null) return String(window.RK_API_URL).replace(/\/$/, '');
  return LOCAL_HOSTS.includes(location.hostname) ? '' : BUILT_IN_API;
}

const BASE = apiBase();
const TOKEN_KEY = 'rk_token';

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

export function fileUrl(path) { return BASE + path; }

/* The adaptive avatar: the ring IS the stat sheet, rendered server-side and
   cached hard. One URL per member; the bytes change only when a level does. */
export const avatarUrl = (username, size) => `${BASE}/api/users/${encodeURIComponent(username)}/avatar.svg${size ? `?s=${size}` : ''}`;

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + '/api' + path, {
    method, headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;          // e.g. the free username offered on a name clash
    throw err;
  }
  return data;
}
