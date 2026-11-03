import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_URL is baked in at build time. Local dev default points at the
// local API; the Vercel deploy sets it to the Render backend URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
