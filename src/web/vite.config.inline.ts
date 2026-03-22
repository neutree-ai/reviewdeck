import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Inline build: all JS in a single file (no dynamic imports).
 * Used for --html static export where everything must be self-contained.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "../../dist/web-inline",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
