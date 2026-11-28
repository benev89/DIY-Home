import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative base so the built app works from any folder or host.
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "DIY Home",
        short_name: "DIY Home",
        description: "Remembers your home and helps you fix things.",
        theme_color: "#c2410c",
        background_color: "#fafaf9",
        display: "standalone",
        start_url: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The Anthropic SDK makes the bundle large; allow it to be precached for offline use.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Push notification handling (see public/push-sw.js).
        importScripts: ["push-sw.js"],
      },
    }),
  ],
});
