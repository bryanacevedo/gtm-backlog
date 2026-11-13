import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  // Each database test file starts its own in-memory Postgres (WebAssembly); several at once on a busy machine need more than 10 seconds.
  test: { hookTimeout: 60_000, testTimeout: 60_000 },
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: { main: "index.html", signin: "signin.html" } } },
});
