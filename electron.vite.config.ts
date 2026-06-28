import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(_dirname, 'electron/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@electron': resolve(_dirname, 'electron'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(_dirname, 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: {
          index: resolve(_dirname, 'index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(_dirname, 'src'),
      },
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.js',
    },
  },
});
