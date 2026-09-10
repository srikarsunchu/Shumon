import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  /* the desktop app's preview assigns a port through PORT; fall back to
     Vite's default when run by hand */
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
});
