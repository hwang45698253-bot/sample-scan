import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true // Allow all external tunnel hosts (Cloudflare, Localtunnel, etc.)
  }
});
