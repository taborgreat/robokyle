import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import '../../public/index.css';
import './app.css';
import { AuthProvider } from './lib/auth.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Designs from './pages/Designs.jsx';
import DesignNew from './pages/DesignNew.jsx';
import DesignView from './pages/DesignView.jsx';
import DesignEdit from './pages/DesignEdit.jsx';
import Verify from './pages/Verify.jsx';
import Profile from './pages/Profile.jsx';

// Old /designs/:id links land on the same work at its new path.
function LegacyDesignLink() {
  const { id } = useParams();
  return <Navigate to={`/works/${id}`} replace />;
}

document.documentElement.classList.add('js'); // index.css gates the mobile nav on html.js

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/user/:username" element={<Profile />} />
            <Route path="/works" element={<Designs />} />
            <Route path="/works/new" element={<DesignNew />} />
            <Route path="/works/:id" element={<DesignView />} />
            <Route path="/works/:id/edit" element={<DesignEdit />} />
            {/* The section used to live at /designs; keep those links working. */}
            <Route path="/designs" element={<Navigate to="/works" replace />} />
            <Route path="/designs/:id" element={<LegacyDesignLink />} />
            <Route path="*" element={<Navigate to="/works" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
