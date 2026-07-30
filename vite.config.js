import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Ensures relative path loading on GitHub Pages (https://hwang45698253-bot.github.io/sample-scan/)
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true
  }
});
