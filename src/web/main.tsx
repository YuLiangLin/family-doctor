import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { captureInstallPrompt } from './installApp';
import { listenForNotificationClicks } from './push';
import { applyTheme, readTheme } from './theme';
import './styles.css';

applyTheme(readTheme());
captureInstallPrompt();
listenForNotificationClicks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
