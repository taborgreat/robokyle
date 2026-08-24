import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import DesignForm from './DesignForm.jsx';

export default function DesignNew() {
  const { user, ready } = useAuth();
  const nav = useNavigate();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" state={{ from: '/works/new' }} replace />;
  return (
    <>
      <div className="app-head"><h1>Add a work</h1></div>
      <DesignForm submitLabel="Publish"
        onSubmit={async fd => { const d = await api('/designs', { method: 'POST', form: fd }); nav(`/works/${d.id}`); }} />
    </>
  );
}
