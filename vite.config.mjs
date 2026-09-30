import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5179",
      "/mock-sso": "http://127.0.0.1:5179"
    }
  },
  build: {
    outDir: "dist"
  }
});
