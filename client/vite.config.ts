import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3100', ws: true },
      '/api': { target: 'http://localhost:3100', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
