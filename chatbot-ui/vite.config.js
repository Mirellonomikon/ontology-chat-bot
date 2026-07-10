import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Force all packages to use the same React instance
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
      'react/jsx-runtime': path.resolve('./node_modules/react/jsx-runtime'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/chat': 'http://localhost:8000',
      '/models': 'http://localhost:8000',
      '/providers': 'http://localhost:8000',
      '/history': 'http://localhost:8000',
      '/settings': 'http://localhost:8000',
      '/ingest': 'http://localhost:8000',
      '/kg': 'http://localhost:8000',
    },
  },
})
