import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import DesignForm from './DesignForm.jsx';

export default function DesignEdit() {
  const { id } = useParams();
  const { user, ready } = useAuth();
  const nav = useNavigate();
  const [design, setDesign] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/designs/${id}`).then(setDesign).catch(e => setError(e.message)); }, [id]);

  if (!ready) return null;
  if (!user) return <Navigate to="/login" state={{ from: `/works/${id}/edit` }} replace />;
  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!design) return <p className="empty">Loading…</p>;
  return (
    <>
      <div className="app-head"><h1>Edit: {design.title}</h1></div>
      <DesignForm initial={design} existingFiles={design.files} submitLabel="Save new version"
        onSubmit={async fd => { await api(`/designs/${id}`, { method: 'PUT', form: fd }); nav(`/works/${id}`); }} />
    </>
  );
}
