import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('xlsx')) return 'vendor-xlsx';
          if (id.includes('recharts') || id.includes('d3-array') || id.includes('d3-shape') || id.includes('d3-scale') || id.includes('d3-path') || id.includes('d3-time') || id.includes('d3-interpolate') || id.includes('d3-color') || id.includes('d3-format') || id.includes('d3-ease')) {
            return 'vendor-charts';
          }
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('@tanstack/react-virtual')) return 'vendor-virtual';
          if (id.includes('react-router')) return 'vendor-router';
          // 仅核心 React，避免与 vendor 循环依赖（勿用宽泛的 /react/ 匹配 @emotion/react 等）
          if (id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/scheduler/')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
