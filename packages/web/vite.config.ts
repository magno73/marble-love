import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // Relative base so the build works under a subpath (GitHub Pages project
  // site) as well as at the dev-server root. Public-asset fetches go through
  // src/public-base-url.ts for the same reason.
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: true,
  },
});
