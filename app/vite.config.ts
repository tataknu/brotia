import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // strictPort: the service's CORS allows exactly :5190, so never drift to another port.
  server: { port: 5190, strictPort: true },
  preview: { port: 5190, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
});
