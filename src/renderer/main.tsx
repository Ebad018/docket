import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo';
import '@fontsource-variable/azeret-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/console.css';
import './styles/listing.css';
import './styles/viewers.css';
import './styles/bay.css';
import { App } from './App';

const host = document.getElementById('root');
if (!host) throw new Error('The application root is missing from index.html.');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>
);
