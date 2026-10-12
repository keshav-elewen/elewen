import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { ViteImageOptimizer } from './plugins/vite-image-optimizer.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      ViteImageOptimizer({
        jpg: { quality: 80 },
        jpeg: { quality: 80 },
        png: { quality: 85 },
        webp: { quality: 80 },
      }),
    ],
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    },
    build: {
      rollupOptions: {
        output: {
          // Vite 8 / Rolldown requires a function (object form is Rollup 3 only)
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined

            if (
              id.includes('/react/') ||
              id.includes('\\react\\') ||
              id.includes('/react-dom/') ||
              id.includes('\\react-dom\\') ||
              id.includes('/react-router-dom/') ||
              id.includes('\\react-router-dom\\')
            ) {
              return 'vendor-react'
            }

            if (id.includes('framer-motion') || id.includes('gsap')) {
              return 'vendor-animation'
            }

            if (id.includes('/swiper/') || id.includes('\\swiper\\')) {
              return 'vendor-ui'
            }

            if (id.includes('@tanstack/react-query')) {
              return 'vendor-query'
            }

            return undefined
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_DEV_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
        '/cms': {
          target: env.VITE_STRAPI_PROXY_TARGET || env.VITE_STRAPI_URL || 'http://localhost:1337',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/cms/, ''),
        },
      },
    },
  }
});
