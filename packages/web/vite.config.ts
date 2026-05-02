import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: ".",
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
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Marble Love",
        short_name: "MarbleLove",
        description:
          "Reimplementazione TypeScript di Marble Madness (Atari 1984).",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "fullscreen",
        orientation: "landscape",
        icons: [
          // Phase 7: aggiungere icone vere in public/icons/
        ],
      },
      workbox: {
        // Solo asset di codice. Le ROM stanno SOLO client-side e mai cached.
        globPatterns: ["**/*.{js,css,html,ico,svg}"],
      },
    }),
  ],
});
