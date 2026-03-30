import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "lib-entry.ts"),
      formats: ["es"],
      fileName: "reviewdeck-ui",
      cssFileName: "style",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
});
