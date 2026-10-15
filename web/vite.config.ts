import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A relative base lets the same build work at https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
