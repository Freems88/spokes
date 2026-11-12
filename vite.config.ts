import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites and Netlify alike.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  // MapLibre 6 loads its worker relative to its own module file; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
