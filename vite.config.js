import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: { '/api': 'http://localhost:3001' }
    },
    define: {
      __SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL || ''),
      __SUPABASE_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.anon || ''),
    }
  };
});
