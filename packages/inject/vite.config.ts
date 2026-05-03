import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    target: 'es2022',
    lib: { entry: 'src/index.tsx', formats: ['iife'], name: 'WalkthroughDrawer', fileName: () => 'inject.js' },
    rollupOptions: { output: { extend: true } },
    minify: 'esbuild',
    cssCodeSplit: false,
  },
});
