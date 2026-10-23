import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, 'web')
const target = 'http://127.0.0.1:3600'

export default defineConfig({
  root,
  server: {
    proxy: Object.fromEntries(['/api', '/uploads', '/tex', '/admin'].map((p) => [p, target])),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 800, // three.js alone is about 550 kB
    rollupOptions: {
      input: Object.fromEntries(
        ['index', 'crate', 'museum', 'arkiv'].map((n) => [n, resolve(root, `${n}.html`)]),
      ),
    },
  },
})
