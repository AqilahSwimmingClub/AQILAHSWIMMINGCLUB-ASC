import { defineConfig } from 'vite'

export default defineConfig({
  // Wajib relatif agar bundle Vite dapat dibuka dari file:///android_asset/ tanpa layar putih.
  base: './',
  server: {
    host: true,
    port: 5173,
    strictPort: true
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
