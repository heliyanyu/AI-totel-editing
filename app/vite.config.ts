import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@schemas": resolve(__dirname, "../src/schemas"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3456",
      "/media": "http://localhost:3456",
    },
  },
  build: {
    outDir: "../dist",
  },
});
