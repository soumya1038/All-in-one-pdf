// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
var __electron_vite_injected_dirname = "D:\\Projects\\VS code\\All in one PDF maker";
var __electron_vite_injected_import_meta_url = "file:///D:/Projects/VS%20code/All%20in%20one%20PDF%20maker/electron.vite.config.ts";
var _dirname = typeof __electron_vite_injected_dirname !== "undefined" ? __electron_vite_injected_dirname : dirname(fileURLToPath(__electron_vite_injected_import_meta_url));
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(_dirname, "electron/main/index.ts")
      }
    },
    resolve: {
      alias: {
        "@electron": resolve(_dirname, "electron")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(_dirname, "electron/preload/index.ts")
      }
    }
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: {
          index: resolve(_dirname, "index.html")
        }
      }
    },
    resolve: {
      alias: {
        "@": resolve(_dirname, "src")
      }
    },
    plugins: [react()],
    css: {
      postcss: "./postcss.config.js"
    }
  }
});
export {
  electron_vite_config_default as default
};
