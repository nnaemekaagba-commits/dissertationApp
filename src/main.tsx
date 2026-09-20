import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './styles/index.css';

const ResearcherFBDReplayPage = React.lazy(() => import('./app/ResearcherFBDReplayPage'));
const researcherReplay = window.location.hash === '#/researcher/fbd-replay';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {researcherReplay ? <React.Suspense fallback={<div className="p-6">Loading researcher replay…</div>}>
      <ResearcherFBDReplayPage />
    </React.Suspense> : <App />}
  </React.StrictMode>,
);
