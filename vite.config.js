import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Polling is reliable on every drive type (native file events were missed on some Windows drives).
    watch: { usePolling: true, interval: 250 },
    proxy: { '/api': 'http://127.0.0.1:4310', '/ocr': 'http://127.0.0.1:4310' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
