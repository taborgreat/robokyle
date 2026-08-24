import { useEffect, useState } from 'react';
import { api } from './api.js';

/* One fetch of /api/config per page load, shared by every component that needs
   to know whether Google sign-in exists or verification is enforced. */
let pending = null;

export function loadConfig() {
  if (!pending) pending = api('/config').catch(() => ({}));
  return pending;
}

export function useConfig() {
  const [config, setConfig] = useState(null);
  useEffect(() => { let live = true; loadConfig().then(c => live && setConfig(c)); return () => { live = false; }; }, []);
  return config;
}
