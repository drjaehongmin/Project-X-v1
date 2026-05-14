import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { moduleRegistry } from './modules/registry';
import { registeredModules } from './modules/registered';
import './styles.css';

// Register every module up-front. The registry validates each manifest
// at registration time; an invalid manifest throws here so the app
// never reaches a render with a broken module loaded.
for (const def of registeredModules) {
  moduleRegistry.register(def);
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
