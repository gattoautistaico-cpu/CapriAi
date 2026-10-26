import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { loadPersisted } from './lib/store';
import { invoke } from '@tauri-apps/api/core';
import I18N from './lib/i18n';
import { useApp } from './lib/store';

// niente menu contestuale del browser sull'overlay
window.addEventListener('contextmenu', (e) => e.preventDefault());

loadPersisted().finally(() => {
  I18N.set(useApp.getState().settings.ui.lang || I18N.detect());
  I18N.observe(document.body);
  invoke('set_tray_lang', { lang: I18N.lang }).catch(() => undefined);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
