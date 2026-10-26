import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Porta fissa richiesta da tauri.conf.json (devUrl)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'chrome110', outDir: 'dist', sourcemap: false },
});
