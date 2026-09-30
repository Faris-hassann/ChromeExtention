import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ plugins: [react()], build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { sidepanel: resolve(here, 'sidepanel.html'), background: resolve(here, 'src/background/index.ts') }, output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
