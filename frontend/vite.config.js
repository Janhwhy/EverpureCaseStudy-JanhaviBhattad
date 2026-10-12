import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies the API and WebSocket to the backend, so the browser
// talks to a single origin and no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
