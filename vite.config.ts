import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // src/server never reaches the browser: it is run by tsx / the LangGraph CLI.
    rollupOptions: { external: [/^node:/] },
  },
});
