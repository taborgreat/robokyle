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

/* A private file (a draft's own upload) as an object URL: an <img src> cannot
   carry the bearer token, so the bytes are fetched with it and handed back as
   a blob URL. Cached per path so the wizard's re-renders never refetch. */
const blobUrls = new Map();
export async function apiBlobUrl(path) {
  if (blobUrls.has(path)) return blobUrls.get(path);
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const p = fetch(BASE + '/api' + path, { headers }).then(async res => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
  }).catch(err => { blobUrls.delete(path); throw err; });
  blobUrls.set(path, p);
  return p;
}

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

/* /config is static per deploy: fetch it once and share the promise, so
   pages render category names and vocab on first paint after the first
   load instead of flashing ids while each page refetches. */
let configPromise = null;
export const getConfig = () => {
  if (!configPromise) {
    configPromise = api('/config').catch(err => { configPromise = null; throw err; });
  }
  return configPromise;
};
