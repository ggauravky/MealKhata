import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiOrigin = process.env.MEALKHATA_API_ORIGIN || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiOrigin,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
