// Every command the page sends goes through the hand's real HTTP API, exactly as an
// external client's would. Resolves to { ok, status, body }; never rejects.
//
// Paths are the spec's ('/gesture/execute') but resolve against the page, not the
// origin, so the viewer works both standalone at / and mounted under a prefix such
// as /brunel/ inside a host server.
export const resolve = (path) => new URL(path.replace(/^\/+/, ''), document.baseURI).href;

export async function api(method, path, body) {
  try {
    const res = await fetch(resolve(path), {
      method,
      headers: body && { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  } catch {
    return { ok: false, status: 0, body: { status: 'error', error_code: 'UNREACHABLE', message: 'Hand unreachable.' } };
  }
}
