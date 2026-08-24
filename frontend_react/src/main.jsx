import React from 'react';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, useNavigationType } from 'react-router-dom';
import '../../public/index.css';
import './app.css';
import { AuthProvider } from './lib/auth.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Designs from './pages/Designs.jsx';
import DesignView from './pages/DesignView.jsx';
import Verify from './pages/Verify.jsx';
import Profile from './pages/Profile.jsx';
import WorkTree from './pages/WorkTree.jsx';
import Creators from './pages/Creators.jsx';
import WorkWizard from './pages/WorkWizard.jsx';
import Talk from './pages/Talk.jsx';
import TalkForm from './pages/TalkForm.jsx';
import TalkPostView from './pages/TalkPostView.jsx';
import PortHub from './pages/PortHub.jsx';
import ModQueue from './pages/ModQueue.jsx';

/* The router keeps scroll across navigations, so clicking through from a
   scrolled list would land mid-page. New navigations start at the top; the
   back button (POP) keeps its position, the way browsers are supposed to. */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    // A #c-… deep link owns its own scroll; jumping to the top first
    // would just fight it.
    if (navType !== 'POP' && !window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

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
      <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/user/:username" element={<Profile />} />
            <Route path="/creators" element={<Creators />} />
            <Route path="/works" element={<Designs />} />
            <Route path="/works/new" element={<WorkWizard />} />
            <Route path="/works/:id" element={<DesignView />} />
            <Route path="/works/:id/tree" element={<WorkTree />} />
            <Route path="/works/:id/hub" element={<PortHub />} />
            <Route path="/works/:id/edit" element={<WorkWizard />} />
            <Route path="/talk" element={<Talk />} />
            <Route path="/talk/new" element={<TalkForm />} />
            <Route path="/talk/:id" element={<TalkPostView />} />
            <Route path="/whiteblacksit" element={<ModQueue />} />
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
