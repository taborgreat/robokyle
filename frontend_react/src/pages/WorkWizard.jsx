import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import NeedTagPicker from '../NeedTagPicker.jsx';
import RequiresEditor from '../RequiresEditor.jsx';
import PortsEditor from '../PortsEditor.jsx';

/* The three-stage wizard. Everything autosaves as a draft, per change,
   debounced, so closing the tab mid-step loses nothing. Nothing is public
   and no XP fires until Stage 3's publish button. */

const STAGES = ['What is it?', 'How is it made?', 'Ship it'];

const blankStep = () => ({ title: '', body: '', duration: '', attachments: [], links: [], workRef: { work: null, version: null } });

/* Stage 3 suggests a starting declaration from what the steps contain.
   A convenience only; the declaration is the author's. */
function suggestDeclaration(files, steps) {
  const all = [...files, ...steps.flatMap(s => s.attachments || [])];
  const models = all.filter(f => f.kind === 'model').length;
  const refs = steps.filter(s => s.workRef?.work).length;
  if (refs >= 2) return [{ id: 'sys', weight: 50 }, { id: 'abil', weight: 25 }, { id: 'docs', weight: 25 }];
  if (models > 0) return [{ id: 'mech', weight: 40 }, { id: 'fab', weight: 35 }, { id: 'docs', weight: 25 }];
  return [{ id: 'mech', weight: 50 }, { id: 'docs', weight: 50 }];
}

export default function WorkWizard() {
  const { id: editWorkId } = useParams();          // present on /works/:id/edit
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user, ready } = useAuth();

  const [draft, setDraft] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const saveTimer = useRef(null);
  const draftId = useRef(null);

  useEffect(() => { api('/config').then(setConfig).catch(() => {}); }, []);

  /* Find or create the draft: an edit reopens the same wizard prefilled. */
  useEffect(() => {
    if (!ready) return;
    if (!user) { nav('/login', { state: { from: editWorkId ? `/works/${editWorkId}/edit` : '/works/new' } }); return; }
    (async () => {
      try {
        let d;
        if (editWorkId) {
          d = await api('/drafts', { method: 'POST', body: { fromWork: editWorkId } });
        } else if (params.get('draft')) {
          d = await api(`/drafts/${params.get('draft')}`);
        } else {
          const mine = await api('/drafts');
          const resumable = mine.items.find(x => !x.fromWork);
          d = resumable ? await api(`/drafts/${resumable.id}`) : await api('/drafts', { method: 'POST', body: {} });
        }
        draftId.current = d.id;
        if (!d.steps.length) d.steps = [blankStep()];
        // Drafts written before the standard-toggle fix can carry a phantom
        // 'standard' type with no definition; load them as the plain works
        // their authors meant.
        if (d.type === 'standard' && !(d.standard?.portName || d.standard?.fields?.length)) {
          d.type = 'design';
          d.standard = null;
        }
        // Coming back always starts at the first page: the draft's content is
        // saved, but the walk through the stages starts over.
        d.stage = 1;
        setDraft(d);
      } catch (err) { setError(err.message); }
    })();
  }, [ready, user, editWorkId]);

  /* The autosave: any change schedules a debounced PUT of the whole draft. */
  const scheduleSave = useCallback((next) => {
    setDraft(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        await api(`/drafts/${draftId.current}`, { method: 'PUT', body: {
          title: next.title, description: next.description,
          tags: next.tags, needTags: next.needTags,
          files: next.files, steps: next.steps,
          categories: next.categories, links: next.links,
          type: next.type, standard: next.standard, ports: next.ports,
          editNote: next.editNote, stage: next.stage,
        } });
      } catch (err) { setError(err.message); }
      finally { setSaving(false); }
    }, 800);
  }, []);
  const patch = (fields) => scheduleSave({ ...draft, ...fields });

  async function uploadFiles(fileList, place) {
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    try {
      const r = await api(`/drafts/${draftId.current}/files`, { method: 'POST', form: fd });
      place(r.files);
    } catch (err) { setError(err.message); }
  }

  async function discard() {
    if (!confirm(draft.fromWork
      ? 'Discard your unpublished changes? The published work is untouched.'
      : 'Delete this draft and start over?')) return;
    try {
      clearTimeout(saveTimer.current);
      await api(`/drafts/${draftId.current}`, { method: 'DELETE' });
      if (draft.fromWork) return nav(`/works/${draft.fromWork}`);
      const fresh = await api('/drafts', { method: 'POST', body: {} });
      draftId.current = fresh.id;
      fresh.steps = [blankStep()];
      fresh.stage = 1;
      setDraft(fresh);
    } catch (err) { setError(err.message); }
  }

  async function publish() {
    setPublishing(true); setError('');
    try {
      clearTimeout(saveTimer.current);
      await api(`/drafts/${draftId.current}`, { method: 'PUT', body: draft });
      const r = await api(`/drafts/${draftId.current}/publish`, { method: 'POST' });
      nav(`/works/${r.id}`);
    } catch (err) { setError(err.message); }
    finally { setPublishing(false); }
  }

  if (error && !draft) return <div className="form-error" role="alert">{error}</div>;
  if (!draft) return <p className="empty">Loading…</p>;

  const stage = draft.stage || 1;
  const cats = (config?.xp?.categories || []).filter(c => !c.hidden);
  const catSum = (draft.categories || []).reduce((a, c) => a + c.weight, 0);
  const hasContent = draft.files.length || draft.steps.some(s => s.title || s.body || s.attachments?.length || s.links?.length || s.workRef?.work);
  const canUpload = !config?.uploadsAdminOnly || user?.role === 'admin';
  const portNameOk = draft.type !== 'standard' || /^[a-z0-9][a-z0-9-]{0,39}$/.test(draft.standard?.portName || '');
  const readyToPublish = draft.title.trim() && hasContent && draft.categories?.length > 0 && catSum === 100
    && portNameOk && (!draft.fromWork || draft.editNote.trim());
  const setStage = (n) => patch({ stage: n });

  return (
    <div className="wizard">
      <div className="app-head">
        <div>
          <h1>{draft.fromWork ? 'Edit the work' : 'Add a work'}</h1>
          <span className="stat">{saving ? 'Saving…' : 'Draft saved automatically. Come back any time.'}</span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          {(draft.title || draft.description || draft.steps.some(st => st.title || st.body || st.attachments?.length) || draft.files.length > 0) && (
            <button type="button" className="btn btn-ghost btn-sm logout-btn" onClick={discard}>
              {draft.fromWork ? 'Discard changes' : 'Clear draft'}
            </button>
          )}
        </div>
      </div>

      <ol className="wizard-stages" aria-label="Stages">
        {STAGES.map((label, i) => (
          <li key={label} className={stage === i + 1 ? 'on' : stage > i + 1 ? 'done' : ''}>
            <button type="button" onClick={() => setStage(i + 1)}>{i + 1}. {label}</button>
          </li>
        ))}
      </ol>

      {error && <div className="form-error" role="alert">{error}</div>}

      {stage === 1 && (
        <section>
          <div className="panel wizard-panel">
            <div className="field"><label htmlFor="wt">Name</label>
              <input id="wt" maxLength={120} value={draft.title} onChange={e => patch({ title: e.target.value })} /></div>
            <div className="field"><label htmlFor="wd">Description</label>
              <textarea id="wd" style={{ minHeight: '4.5rem' }} value={draft.description}
                        placeholder="The card blurb, not the manual. The steps are the manual."
                        onChange={e => patch({ description: e.target.value })} /></div>
            <div className="field">
              <label>Overview images</label>
              <small>Hero shots of the finished thing. Photos of individual steps go on the steps.</small>
              <div className="wizard-files">
                {(draft.files || []).map((f, i) => (
                  <span key={f.storedName + i} className="wizard-file">
                    {f.originalName}
                    <button type="button" aria-label={`Remove ${f.originalName}`}
                            onClick={() => patch({ files: draft.files.filter((_, j) => j !== i) })}>×</button>
                  </span>
                ))}
              </div>
              {canUpload
                ? <input type="file" multiple accept="image/*"
                         onChange={e => { uploadFiles(e.target.files, fs => patch({ files: [...draft.files, ...fs] })); e.target.value = ''; }} />
                : <small>Uploads are admin only for now. Link your images and files in the External links panel on the next page.</small>}
            </div>
          </div>

          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>What need does it serve?</h2>
            <p className="stat">How people find the work. Pick everything that applies; it never affects XP.</p>
            <NeedTagPicker vocabulary={config?.xp?.needVocabulary} value={draft.needTags}
                           onChange={needTags => patch({ needTags })} />
          </div>

          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>Standard</h2>
            <div className="field">
              <label>
                <input type="checkbox" checked={draft.type === 'standard'} disabled={!!draft.fromWork}
                       onChange={e => patch({ type: e.target.checked ? 'standard' : 'design',
                                              standard: e.target.checked ? (draft.standard || { portName: '', fields: [] }) : null })} />
                {' '}This work defines a <strong>standard</strong>, a named interface other works can provide or accept
              </label>
              {draft.fromWork && <small>A work's kind is fixed at publish; other works may already point at it.</small>}
            </div>
            {draft.type === 'standard' && (
              <StandardDefEditor standard={draft.standard || { portName: '', fields: [] }}
                                 onChange={standard => patch({ standard })} />
            )}
          </div>

          <div className="toolbar" style={{ marginTop: '1.5rem' }}>
            <button className="btn btn-primary" onClick={() => setStage(2)}>Next: the steps →</button>
          </div>
        </section>
      )}

      {stage === 2 && (
        <section>
          <p className="stat">
            Each step is its own block: the photo of the jig lives on the step that uses the jig,
            the bracket STL on the printing step. A step can also <em>be</em> another work.
          </p>
          {(draft.steps || []).map((st, i) => (
            <div key={i} className="panel step-block">
              <div className="step-block-head">
                <strong>Step {i + 1}</strong>
                <span className="toolbar" style={{ margin: 0 }}>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0}
                          onClick={() => { const s = [...draft.steps]; [s[i - 1], s[i]] = [s[i], s[i - 1]]; patch({ steps: s }); }}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === draft.steps.length - 1}
                          onClick={() => { const s = [...draft.steps]; [s[i + 1], s[i]] = [s[i], s[i + 1]]; patch({ steps: s }); }}>↓</button>
                  <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => patch({ steps: draft.steps.filter((_, j) => j !== i) })}>Remove</button>
                </span>
              </div>
              {st.workRef?.work ? (
                <RefStep step={st} accepts={draft.ports?.accepts}
                         onChange={next => patch({ steps: draft.steps.map((x, j) => j === i ? next : x) })} />
              ) : (
                <>
                  <div className="field-row">
                    <div className="field"><label htmlFor={`st${i}`}>Title</label>
                      <input id={`st${i}`} maxLength={160} placeholder="Print the parts" value={st.title}
                             onChange={e => patch({ steps: draft.steps.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} /></div>
                    <div className="field"><label htmlFor={`sd${i}`}>Takes about</label>
                      <input id={`sd${i}`} maxLength={80} placeholder="3h print" value={st.duration}
                             onChange={e => patch({ steps: draft.steps.map((x, j) => j === i ? { ...x, duration: e.target.value } : x) })} /></div>
                  </div>
                  <div className="field"><label htmlFor={`sb${i}`}>Instructions</label>
                    <textarea id={`sb${i}`} style={{ minHeight: '4rem' }} value={st.body}
                              onChange={e => patch({ steps: draft.steps.map((x, j) => j === i ? { ...x, body: e.target.value } : x) })} /></div>
                  <div className="wizard-files">
                    {(st.attachments || []).map((f, k) => (
                      <span key={f.storedName + k} className="wizard-file">{f.originalName}
                        <button type="button" aria-label={`Remove ${f.originalName}`}
                                onClick={() => patch({ steps: draft.steps.map((x, j) => j === i ? { ...x, attachments: x.attachments.filter((_, m) => m !== k) } : x) })}>×</button>
                      </span>
                    ))}
                  </div>
{canUpload && (
                                    <input type="file" multiple
                         onChange={e => { uploadFiles(e.target.files, fs => patch({ steps: draft.steps.map((x, j) => j === i ? { ...x, attachments: [...x.attachments, ...fs] } : x) })); e.target.value = ''; }} />
                  )}
                  <StepLinks links={st.links || []}
                             onChange={links => patch({ steps: draft.steps.map((x, j) => j === i ? { ...x, links } : x) })} />
                  {(draft.requires?.equipment || []).length > 0 && (
                    <div className="step-needs">
                      <span className="stat">Needed for this step: </span>
                      {(draft.requires.equipment || []).map(e => (
                        <button key={e.item} type="button"
                                className={'tag need-chip' + ((st.needs || []).includes(e.item) ? ' on' : '')}
                                aria-pressed={(st.needs || []).includes(e.item)}
                                onClick={() => patch({ steps: draft.steps.map((x, j) => j === i
                                  ? { ...x, needs: (x.needs || []).includes(e.item) ? x.needs.filter(n => n !== e.item) : [...(x.needs || []), e.item] } : x) })}>
                          {e.item}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="stat" style={{ marginTop: '.4rem' }}>
                    <WorkPicker exclude={draft.fromWork} onPick={w => patch({ steps: draft.steps.map((x, j) => j === i
                      ? { ...blankStep(), title: `Build the ${w.title}`, workRef: { work: w.id, version: w.version }, _refMeta: w } : x) })} />
                  </p>
                </>
              )}
            </div>
          ))}
          <div className="toolbar">
            <button type="button" className="btn btn-ghost" onClick={() => patch({ steps: [...draft.steps, blankStep()] })}>+ Add a step</button>
            {draft.steps.length > 15 && <span className="stat">That is a lot of steps. Consider splitting part of this into its own work and referencing it.</span>}
          </div>
          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>What building it takes</h2>
            <RequiresEditor config={config} value={draft.requires}
                            onChange={requires => patch({ requires })} />
          </div>

          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>External links</h2>
            <p className="stat">
              Files too big to host here, videos, or anything living on Printables,
              GitHub or Drive. They show on the work page grouped by kind.
            </p>
            {(draft.links || []).map((l, i) => (
              <div key={i} className="link-edit-row">
                <input aria-label="Label" placeholder="label" maxLength={120} value={l.label || ''}
                       onChange={e => patch({ links: draft.links.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <input aria-label="URL" type="url" placeholder="https://…" maxLength={2000} value={l.url || ''}
                       onChange={e => patch({ links: draft.links.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} />
                <select aria-label="Kind" value={l.kind || 'other'}
                        onChange={e => patch({ links: draft.links.map((x, j) => j === i ? { ...x, kind: e.target.value } : x) })}>
                  <option value="files">model files</option>
                  <option value="video">video</option>
                  <option value="docs">guide or docs</option>
                  <option value="parts">parts to buy</option>
                  <option value="other">other</option>
                </select>
                <button type="button" className="link-btn" aria-label="Remove link"
                        onClick={() => patch({ links: draft.links.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            {(draft.links || []).length < 12 &&
              <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => patch({ links: [...(draft.links || []), { label: '', url: '', kind: 'other', note: '' }] })}>+ Add a link</button>}
          </div>

          <div className="toolbar" style={{ marginTop: '1.5rem' }}>
            <button className="btn btn-ghost" onClick={() => setStage(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => { if (!draft.categories?.length) patch({ categories: suggestDeclaration(draft.files, draft.steps), stage: 3 }); else setStage(3); }}>Next: ship it →</button>
          </div>
        </section>
      )}

      {stage === 3 && (
        <section>
          <div className="panel wizard-panel">
            <h2>Preview</h2>
            <div className="wizard-preview">
              <h3>{draft.title || <em>Untitled</em>}</h3>
              <p className="desc">{draft.description}</p>
              {(draft.files || []).filter(f => f.kind === 'image').length > 0 && <p className="stat">{draft.files.filter(f => f.kind === 'image').length} overview image(s)</p>}
              <ol className="preview-steps">
                {draft.steps.filter(s => s.title || s.body || s.workRef?.work).map((s, i) => (
                  <li key={i}>{s.workRef?.work ? <em>→ {s.title || 'another work'}</em> : <><strong>{s.title}</strong>{s.body && <>: {s.body.slice(0, 120)}</>}{s.attachments?.length > 0 && <span className="stat"> · {s.attachments.length} file(s)</span>}{s.links?.length > 0 && <span className="stat"> · {s.links.length} link(s)</span>}</>}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>What kind of work did this turn out to be? <span className="required-mark">required</span></h2>
            <p className="stat">
              Pick 1 to {config?.xp?.declaration?.max || 4} categories and split 100 points between them.
              This decides which skills the work earns XP in, for you and for everyone who builds
              on it, and the claim is public. The pre-filled split is only a guess from your
              steps; read what each category covers and make it yours.
            </p>
            <ul className="cat-rows">
              {cats.map(c => {
                const chosen = (draft.categories || []).find(x => x.id === c.id);
                return (
                  <li key={c.id} className={chosen ? 'on' : ''}>
                    <button type="button" className="cat-row-toggle" aria-pressed={!!chosen} onClick={() => {
                      let next = chosen ? draft.categories.filter(x => x.id !== c.id) : [...(draft.categories || []), { id: c.id, weight: 0 }];
                      if (next.length > (config?.xp?.declaration?.max || 4)) return;
                      const even = Math.floor(100 / (next.length || 1));
                      next = next.map((x, i) => ({ ...x, weight: i === 0 ? 100 - even * (next.length - 1) : even }));
                      patch({ categories: next });
                    }}>
                      <span className="cat-row-name">{c.name}</span>
                      <span className="cat-row-scope">{c.scope}</span>
                    </button>
                    {chosen && <input type="number" min="1" max="100" aria-label={`${c.name} weight`} value={chosen.weight}
                                      onChange={e => patch({ categories: draft.categories.map(x => x.id === c.id ? { ...x, weight: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) } : x) })} />}
                  </li>
                );
              })}
            </ul>
            <p className={'stat' + (catSum === 100 && draft.categories?.length ? '' : ' cat-sum-off')}>
              {!draft.categories?.length ? 'Nothing chosen yet.'
                : catSum === 100 ? 'Adds up to 100.' : `Adds up to ${catSum}. It needs to be exactly 100.`}
            </p>
          </div>

          {(draft.categories || []).some(c => c.id === 'soft') && (
            <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
              <h2>Software facets</h2>
              <p className="stat">What kind of software this is. Discovery only; never affects XP.</p>
              <div className="need-chips">
                {(config?.xp?.softwareFacets || []).map(f => (
                  <button key={f} type="button" className={'tag need-chip' + ((draft.facets || []).includes(f) ? ' on' : '')}
                          aria-pressed={(draft.facets || []).includes(f)}
                          onClick={() => patch({ facets: (draft.facets || []).includes(f)
                            ? draft.facets.filter(x => x !== f) : [...(draft.facets || []), f] })}>{f}</button>
                ))}
              </div>
            </div>
          )}

          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>Ports: how this work connects</h2>
            <p className="stat">
              Optional. Declaring what this work provides puts it on that standard's hub for
              everyone designing around it; declaring what it accepts lights up the mate-check
              wherever the pieces meet. Provided interfaces start as claims until a qualified
              reviewer verifies them.
            </p>
            <PortsEditor ports={draft.ports} onChange={ports => patch({ ports })} />
          </div>

          <div className="panel wizard-panel" style={{ marginTop: '1.5rem' }}>
            <h2>Checklist</h2>
            <ul className="pub-checklist">
              <li className={draft.title ? 'done' : 'todo'}>A name (required)</li>
              <li className={hasContent ? 'done' : 'todo'}>At least one file or step (required)</li>
              <li className={(draft.categories?.length && catSum === 100) ? 'done' : 'todo'}>Categories declared, adding to 100 (required)</li>
              {draft.type === 'standard' && (
                <li className={portNameOk ? 'done' : 'todo'}>A port name for the standard (required)</li>
              )}
              <li className={draft.description ? 'done' : 'todo'}>A description</li>
              {canUpload && <li className={draft.files.some(f => f.kind === 'image') ? 'done' : 'todo'}>An overview image</li>}
              <li className={draft.steps.some(s => s.body) ? 'done' : 'todo'}>Instructions someone else can follow</li>
            </ul>
            {draft.fromWork && (
              <div className="field" style={{ marginTop: '.75rem' }}>
                <label htmlFor="chlog">What changed? (one line, required)</label>
                <input id="chlog" maxLength={300} value={draft.editNote} placeholder="Stronger detent spring"
                       onChange={e => patch({ editNote: e.target.value })} />
              </div>
            )}
            <div className="toolbar" style={{ marginTop: '1rem' }}>
              <button className="btn btn-ghost" onClick={() => setStage(2)}>← Back</button>
              <button className="btn btn-primary" onClick={publish} disabled={publishing || !readyToPublish}
                      title={readyToPublish ? undefined : 'Finish the required items above first'}>
                {publishing ? 'Publishing…' : draft.fromWork ? 'Publish this version' : 'Publish'}
              </button>
              {!readyToPublish && <span className="stat">Finish the required items above to publish.</span>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/* The machine-readable half of a standard (Ports Spec §1): its port name and
   the flat facts a provider must state. Deliberately no nested schema builder;
   a standard needing structure puts it in its documents. */
function StandardDefEditor({ standard, onChange }) {
  const fields = Array.isArray(standard.fields) ? standard.fields : [];
  const setField = (i, k, v) => onChange({ ...standard, fields: fields.map((f, j) => j === i ? { ...f, [k]: v } : f) });
  return (
    <div className="panel port-std-editor">
      <div className="field">
        <label htmlFor="pn">Port name</label>
        <input id="pn" maxLength={40} placeholder="qr-15" value={standard.portName || ''}
               onChange={e => onChange({ ...standard, portName: e.target.value.toLowerCase() })} />
        <small>The short id works declare against. Lowercase letters, digits and dashes.</small>
      </div>
      <div className="field">
        <label>Fields a provider must state</label>
        <small>Flat rows of name, unit and required. The values become searchable and comparable across every provider. The spec itself (drawings, tolerances, pinouts) goes in the work's files and steps.</small>
        {fields.map((f, i) => (
          <div key={i} className="port-field-row">
            <input aria-label="Field name" placeholder="face-diameter" maxLength={40} value={f.name || ''}
                   onChange={e => setField(i, 'name', e.target.value.toLowerCase())} />
            <input aria-label="Unit" placeholder="mm" maxLength={20} value={f.unit || ''}
                   onChange={e => setField(i, 'unit', e.target.value)} />
            <label className="stat"><input type="checkbox" checked={!!f.required}
                   onChange={e => setField(i, 'required', e.target.checked)} /> required</label>
            <button type="button" className="link-btn" aria-label="Remove field"
                    onClick={() => onChange({ ...standard, fields: fields.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        {fields.length < 12 &&
          <button type="button" className="link-btn" onClick={() => onChange({ ...standard, fields: [...fields, { name: '', unit: '', required: false }] })}>+ Add a field</button>}
      </div>
    </div>
  );
}

/* Per-step external links: the STL on Printables, the wiring photo, the
   walkthrough video — attached to the step that uses them. While uploads are
   admin-only, this is how most members attach anything at all. */
function StepLinks({ links, onChange }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  function add() {
    const u = url.trim();
    if (!u) return;
    onChange([...links, { label: label.trim(), url: /^https?:\/\//i.test(u) ? u : `https://${u}`, kind: 'other', note: '' }]);
    setUrl(''); setLabel('');
  }

  return (
    <div className="step-links">
      {links.length > 0 && (
        <div className="wizard-files">
          {links.map((l, i) => (
            <span key={l.url + i} className="wizard-file" title={l.url}>
              {l.label || l.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
              <button type="button" aria-label={`Remove ${l.label || l.url}`}
                      onClick={() => onChange(links.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}
      {links.length < 8 && (
        <div className="step-link-row">
          <input placeholder="Link a file, image or video (https://…)" value={url}
                 onChange={e => setUrl(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <input placeholder="label (optional)" value={label} maxLength={120}
                 onChange={e => setLabel(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={!url.trim()}>Add link</button>
        </div>
      )}
    </div>
  );
}

/* A step that IS another work. */
function RefStep({ step, onChange, accepts }) {
  const w = step._refMeta;
  // The mate-check (Ports Spec §3): the referenced work provides a port this
  // draft accepts, so composition is visibly correct before publish.
  const mates = !!w && (accepts || []).some(a =>
    (w.providesStandards || []).map(String).includes(String(a.standard)));
  return (
    <div className="ref-step">
      <p>
        This step is another work: <strong>{step.title || 'a referenced work'}</strong>
        {w && <span className="stat"> (v{w.version} by {w.author?.username})</span>}
        {mates && <span className="tag endorsed-tag" title="This part provides an interface your work accepts"> ✓ mates</span>}
      </p>
      <div className="toolbar" style={{ margin: 0 }}>
        <select aria-label="Version to build against" value={step.workRef.version === null ? 'latest' : String(step.workRef.version)}
                onChange={e => onChange({ ...step, workRef: { ...step.workRef, version: e.target.value === 'latest' ? null : Number(e.target.value) } })}>
          {w && Array.from({ length: w.version }, (_, k) => w.version - k).map(v => <option key={v} value={v}>Pin to v{v}</option>)}
          {!w && step.workRef.version !== null && <option value={String(step.workRef.version)}>Pin to v{step.workRef.version}</option>}
          <option value="latest">Follow the latest</option>
        </select>
        <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => onChange({ ...step, workRef: { work: null, version: null } })}>Make it a normal step</button>
      </div>
    </div>
  );
}

/* Inline search for the reference-step picker. Focusing it lists the newest
   works before anything is typed, so what is available to build on is visible
   at a glance; typing narrows. */
function WorkPicker({ onPick, exclude }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  async function load(query) {
    try {
      const r = await api(`/designs?${query ? `q=${encodeURIComponent(query)}&` : 'sort=new&'}limit=6`);
      setResults(r.items.filter(w => String(w.id) !== String(exclude)));
      setBrowsing(!query);
    } catch { setResults([]); }
  }
  return (
    <span className="work-picker">
      …or make this step another work:{' '}
      <input placeholder="search works" value={q} onChange={e => setQ(e.target.value)}
             onFocus={() => { if (!results) load(''); }}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); load(q.trim()); } }} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(q.trim())}>Find</button>
      {results && (results.length === 0
        ? <em> {browsing ? 'no works yet' : 'nothing matched'}</em>
        : <>
            {browsing && <span className="stat"> recent: </span>}
            {results.map(w => (
              <button key={w.id} type="button" className="link-btn" style={{ marginLeft: '.5rem' }}
                      onClick={() => { onPick({ ...w, author: w.author }); setResults(null); setQ(''); }}>{w.title}</button>
            ))}
          </>)}
    </span>
  );
}
