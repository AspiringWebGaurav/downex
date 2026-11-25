import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import process from 'node:process';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'https://gphost.eu.cc',
        changeOrigin: true,
        secure: true,
      },
    },
    watch: {
      ignored: ['**/src-tauri/**', '**/reference/**', '**/browser-extension/**', '**/downex-browser-extension/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      onwarn(warning, defaultWarn) {
        if (
          warning.code === 'DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE' ||
          (warning.message && warning.message.includes('dynamically imported by'))
        ) {
          return;
        }
        defaultWarn(warning);
      },
    },
  },
});
