import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET } = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      ...(API_PROXY_TARGET
        ? {
            proxy: {
              '/api': {
                target: API_PROXY_TARGET,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
