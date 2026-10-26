import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { loadPersisted } from './lib/store';

// niente menu contestuale del browser sull'overlay
window.addEventListener('contextmenu', (e) => e.preventDefault());

loadPersisted().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
