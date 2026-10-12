import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { LiveProvider } from './live.jsx';
import Alerts from './pages/Alerts.jsx';
import Costs from './pages/Costs.jsx';
import DataQuality from './pages/DataQuality.jsx';
import Login from './pages/Login.jsx';
import Orphaned from './pages/Orphaned.jsx';
import Overview from './pages/Overview.jsx';
import Reports from './pages/Reports.jsx';

// Hiding a page is only for convenience; the API enforces the same permission (403).
function Guard({ permission, children }) {
  const { can } = useAuth();
  return can(permission) ? children : <div className="empty">Your role does not have access to this page.</div>;
}

function App() {
  const { token } = useAuth();
  if (!token) return <Login />;

  return (
    <LiveProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="reports" element={<Reports />} />
          <Route path="orphaned" element={<Orphaned />} />
          <Route path="costs" element={<Guard permission="costs:read"><Costs /></Guard>} />
          <Route path="data-quality" element={<Guard permission="dq:read"><DataQuality /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LiveProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
