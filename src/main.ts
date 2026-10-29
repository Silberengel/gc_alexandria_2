import { mount } from 'svelte';
import './app.css';
import './lib/hljs-theme.css';
import './lib/stores/appearance';
import { registerPwa } from './lib/pwa';
import { rewritePathDeepLinkToHash } from './lib/path-to-hash';
import { installViewportLock } from './lib/viewport-lock';
import App from './App.svelte';

// Path deep-links (no #/) must become hash routes before the SPA router mounts.
rewritePathDeepLinkToHash();

// Tablets: kill pinch/double-tap zoom so TopBar + footer stay in the layout.
installViewportLock();

registerPwa();

const app = mount(App, { target: document.getElementById('app')! });
export default app;
