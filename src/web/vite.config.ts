import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
