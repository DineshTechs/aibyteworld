import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY || 'http://localhost:5000';
  return {
    plugins: [react()],
    build: {
      // Split big libraries so public pages load only what they need.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-image', '@tiptap/extension-link', '@tiptap/extension-placeholder', '@tiptap/extension-underline'],
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // The browser only ever talks to the Vite origin; API calls are proxied.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
        '/sitemap.xml': { target: apiTarget, changeOrigin: true },
        '/robots.txt': { target: apiTarget, changeOrigin: true },
        '/rss.xml': { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
