import { mount } from 'svelte';
import './app.css';
import './lib/stores/appearance';
import { registerPwa } from './lib/pwa';
import { rewritePathDeepLinkToHash } from './lib/path-to-hash';
import App from './App.svelte';

// Path deep-links (no #/) must become hash routes before the SPA router mounts.
rewritePathDeepLinkToHash();

registerPwa();

const app = mount(App, { target: document.getElementById('app')! });
export default app;
