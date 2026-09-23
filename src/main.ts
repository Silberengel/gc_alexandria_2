import { mount } from 'svelte';
import './app.css';
import './lib/stores/appearance';
import { registerPwa } from './lib/pwa';
import App from './App.svelte';

registerPwa();

const app = mount(App, { target: document.getElementById('app')! });
export default app;
