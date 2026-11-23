import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `__dirname` isn't defined in ESM ("type": "module"); derive it from the
// module URL so the alias resolves regardless of how the config is loaded.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // NEXT_PUBLIC_* are the public Supabase vars injected by the Vercel ↔ Supabase integration.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Proxy API requests to the backend during local development
      "/api": {
        target: process.env.VITE_API_PROXY || "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
