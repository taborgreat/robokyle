import { useEffect, useRef } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise = null;

// Google Identity Services is loaded on demand, so anyone without a configured
// client ID never pulls it in.
function loadGis() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google sign-in could not load'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/* Renders Google's own button and hands the resulting ID token to onCredential,
   which posts it to /api/auth/google. Renders nothing without a client ID. */
export default function GoogleButton({ clientId, onCredential, onError }) {
  const box = useRef(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !window.google || !box.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handler.current(response.credential),
        });
        window.google.accounts.id.renderButton(box.current, {
          theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 280,
        });
      })
      .catch(err => { if (!cancelled && onError) onError(err.message); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="google-signin">
      <div ref={box} />
      <span className="or">or use an email and password</span>
    </div>
  );
}
