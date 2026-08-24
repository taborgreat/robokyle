import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const LINK_KINDS = [
  ['files', 'Model files'],
  ['video', 'Video'],
  ['docs', 'Guide / docs'],
  ['parts', 'Parts to buy'],
  ['other', 'Other'],
];

const blankLink = () => ({ label: '', url: '', kind: 'files', note: '' });
const blankStep = () => ({ title: '', body: '', imageFile: '' });
const lines = (text) => text.split('\n').map(s => s.trim()).filter(Boolean);

// Shared form for creating and editing a design. onSubmit receives a FormData.
export default function DesignForm({ initial = {}, existingFiles = [], submitLabel, onSubmit }) {
  const { user } = useAuth();
  const isEdit = !!initial.id;

  const [title, setTitle] = useState(initial.title || '');
  const [description, setDescription] = useState(initial.description || '');
  const [tags, setTags] = useState((initial.tags || []).join(', '));
  const [editNote, setEditNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(null);

  // Files already stored on this design: caption edits, ordering and removal.
  const [kept, setKept] = useState(() => existingFiles.map((f, i) => ({
    id: f._id, name: f.originalName, kind: f.kind, caption: f.caption || '', order: f.order ?? i, remove: false,
  })));
  // Newly picked files, each with its own caption.
  const [picked, setPicked] = useState([]);

  const [links, setLinks] = useState(() => (initial.links || []).map(l => ({
    label: l.label || '', url: l.url || '', kind: l.kind || 'other', note: l.note || '',
  })));

  const g = initial.guide || {};
  const [guide, setGuide] = useState({
    summary: g.summary || '',
    printSettings: g.printSettings || '',
    materials: (g.materials || []).join('\n'),
    tools: (g.tools || []).join('\n'),
    steps: (g.steps || []).map(s => ({ title: s.title || '', body: s.body || '', imageFile: s.imageFile || '' })),
  });

  useEffect(() => { api('/config').then(setConfig).catch(() => {}); }, []);

  const canUpload = !!user && (!config || !config.uploadsAdminOnly || user.role === 'admin');
  const maxMb = config?.maxUploadMb ?? 50;
  const accept = config?.allowedExtensions?.join(',');
  // Steps can point at an image that is already stored (new uploads have no id yet).
  const stepImages = kept.filter(f => f.kind === 'image' && !f.remove);

  const setGuideField = (patch) => setGuide(prev => ({ ...prev, ...patch }));
  const patchStep = (i, patch) => setGuideField({ steps: guide.steps.map((s, j) => j === i ? { ...s, ...patch } : s) });
  const moveStep = (i, delta) => {
    const next = [...guide.steps];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setGuideField({ steps: next });
  };
  const moveFile = (i, delta) => {
    const next = [...kept];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setKept(next.map((f, idx) => ({ ...f, order: idx })));
  };

  function addFiles(list) {
    const chosen = [...list];
    const tooBig = chosen.filter(f => f.size > maxMb * 1024 * 1024);
    setError(tooBig.length ? `${tooBig.map(f => f.name).join(', ')} is over the ${maxMb} MB limit. Host it elsewhere and add a link instead.` : '');
    setPicked(prev => [...prev, ...chosen.filter(f => f.size <= maxMb * 1024 * 1024).map(file => ({ file, caption: '' }))]);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', description);
    fd.append('tags', tags);
    fd.append('links', JSON.stringify(links.filter(l => l.url.trim())));
    fd.append('guide', JSON.stringify({
      summary: guide.summary,
      printSettings: guide.printSettings,
      materials: lines(guide.materials),
      tools: lines(guide.tools),
      steps: guide.steps.filter(s => s.title.trim() || s.body.trim()),
    }));
    for (const p of picked) fd.append('files', p.file);
    fd.append('captions', JSON.stringify(picked.map(p => p.caption)));
    if (isEdit) {
      fd.append('editNote', editNote);
      fd.append('removeFiles', kept.filter(f => f.remove).map(f => f.id).join(','));
      fd.append('fileMeta', JSON.stringify(kept.map((f, i) => ({ id: f.id, caption: f.caption, order: i }))));
    }
    try { await onSubmit(fd); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <form className="form-card form-wide" onSubmit={submit}>
      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="form-section">
        <h2>The basics</h2>
        <div className="field"><label htmlFor="t">Title</label>
          <input id="t" required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="d">Description</label>
          <textarea id="d" required value={description} onChange={e => setDescription(e.target.value)} />
          <small>What it is, who it helps, what you need to build it.</small></div>
        <div className="field"><label htmlFor="g">Tags</label>
          <input id="g" placeholder="3d-printer, electronics, switch" value={tags} onChange={e => setTags(e.target.value)} />
          <small>Comma separated.</small></div>
      </section>

      <section className="form-section">
        <h2>Files</h2>
        {kept.length > 0 && (
          <ul className="editor-list">
            {kept.map((f, i) => (
              <li key={f.id} className={'editor-row' + (f.remove ? ' is-removed' : '')}>
                <div className="editor-row-head">
                  <span className={`kind-chip kind-${f.kind || 'other'}`}>{f.kind || 'file'}</span>
                  <strong className="editor-row-name">{f.name}</strong>
                  <span className="row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveFile(i, -1)} disabled={i === 0} aria-label={`Move ${f.name} up`}>&uarr;</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveFile(i, 1)} disabled={i === kept.length - 1} aria-label={`Move ${f.name} down`}>&darr;</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKept(kept.map((k, j) => j === i ? { ...k, remove: !k.remove } : k))}>
                      {f.remove ? 'Keep' : 'Remove'}
                    </button>
                  </span>
                </div>
                <input className="caption-input" placeholder="Caption (optional)" maxLength={200}
                       value={f.caption} disabled={f.remove}
                       onChange={e => setKept(kept.map((k, j) => j === i ? { ...k, caption: e.target.value } : k))} />
              </li>
            ))}
          </ul>
        )}

        {canUpload ? (
          <>
            <div className="field"><label htmlFor="f">{kept.length ? 'Add files' : 'Upload files'}</label>
              <input id="f" type="file" multiple accept={accept} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
              <small>Images, STL/OBJ/3MF/STEP/SCAD/G-code, ZIP, PDF. Up to {maxMb} MB each, {config?.maxFiles ?? 20} files.
                Anything bigger belongs on Printables or Drive. Add it as a link below.</small></div>
            {picked.length > 0 && (
              <ul className="editor-list">
                {picked.map((p, i) => (
                  <li key={`${p.file.name}-${i}`} className="editor-row">
                    <div className="editor-row-head">
                      <span className="kind-chip kind-new">new</span>
                      <strong className="editor-row-name">{p.file.name}</strong>
                      <span className="stat">{(p.file.size / 1e6).toFixed(1)} MB</span>
                      <span className="row-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(picked.filter((_, j) => j !== i))}>Remove</button>
                      </span>
                    </div>
                    <input className="caption-input" placeholder="Caption (optional)" maxLength={200}
                           value={p.caption} onChange={e => setPicked(picked.map((q, j) => j === i ? { ...q, caption: e.target.value } : q))} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="notice">Uploads are limited to admins right now. Host your files on Printables, Thingiverse,
            GitHub or Drive and add the links below. They show up the same way on the page.</p>
        )}
      </section>

      <section className="form-section">
        <h2>Links</h2>
        <p className="stat">Files hosted somewhere else: a Printables page, a Drive folder, a build video, a parts list.</p>
        <ul className="editor-list">
          {links.map((l, i) => (
            <li key={i} className="editor-row">
              <div className="link-row">
                <input placeholder="Label (e.g. STL pack on Printables)" maxLength={120}
                       value={l.label} onChange={e => setLinks(links.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <select aria-label="Link type" value={l.kind}
                        onChange={e => setLinks(links.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}>
                  {LINK_KINDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Remove</button>
              </div>
              <input type="url" placeholder="https://…" required value={l.url}
                     onChange={e => setLinks(links.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinks([...links, blankLink()])}>+ Add link</button>
      </section>

      <section className="form-section">
        <h2>Build guide</h2>
        <p className="stat">Optional, but it is what turns a pile of STLs into something someone else can actually make.</p>
        <div className="field"><label htmlFor="gs">Overview</label>
          <textarea id="gs" style={{ minHeight: '6rem' }} value={guide.summary}
                    onChange={e => setGuideField({ summary: e.target.value })} />
          <small>How it goes together, in a paragraph or two.</small></div>
        <div className="field-row">
          <div className="field"><label htmlFor="gm">Materials</label>
            <textarea id="gm" style={{ minHeight: '6rem' }} value={guide.materials}
                      onChange={e => setGuideField({ materials: e.target.value })} />
            <small>One per line.</small></div>
          <div className="field"><label htmlFor="gt">Tools</label>
            <textarea id="gt" style={{ minHeight: '6rem' }} value={guide.tools}
                      onChange={e => setGuideField({ tools: e.target.value })} />
            <small>One per line.</small></div>
        </div>
        <div className="field"><label htmlFor="gp">Print / build settings</label>
          <input id="gp" placeholder="0.2mm layers, 4 walls, PETG, no supports" maxLength={2000}
                 value={guide.printSettings} onChange={e => setGuideField({ printSettings: e.target.value })} /></div>

        <ol className="editor-list steps-editor">
          {guide.steps.map((s, i) => (
            <li key={i} className="editor-row">
              <div className="editor-row-head">
                <span className="step-num">Step {i + 1}</span>
                <span className="row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>&uarr;</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveStep(i, 1)} disabled={i === guide.steps.length - 1} aria-label={`Move step ${i + 1} down`}>&darr;</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGuideField({ steps: guide.steps.filter((_, j) => j !== i) })}>Remove</button>
                </span>
              </div>
              <input placeholder="Step title" maxLength={160} value={s.title} onChange={e => patchStep(i, { title: e.target.value })} />
              <textarea placeholder="What to do" style={{ minHeight: '5rem' }} value={s.body} onChange={e => patchStep(i, { body: e.target.value })} />
              {stepImages.length > 0 && (
                <label className="step-image">Photo
                  <select value={s.imageFile || ''} onChange={e => patchStep(i, { imageFile: e.target.value })}>
                    <option value="">None</option>
                    {stepImages.map(f => <option key={f.id} value={f.id}>{f.caption || f.name}</option>)}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGuideField({ steps: [...guide.steps, blankStep()] })}>+ Add step</button>
        {stepImages.length === 0 && picked.some(p => p.file.type.startsWith('image/')) && (
          <p className="stat" style={{ marginTop: '.6rem' }}>Save first, then edit again to pin one of your photos to a step.</p>
        )}
      </section>

      {isEdit && (
        <section className="form-section">
          <h2>This edit</h2>
          <div className="field"><label htmlFor="n">What changed? (optional)</label>
            <input id="n" placeholder="e.g. Thicker walls on the clip" value={editNote} onChange={e => setEditNote(e.target.value)} />
            <small>A new version is recorded automatically, with the file, link and guide changes listed for you.</small></div>
        </section>
      )}

      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
