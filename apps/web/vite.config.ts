import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/auth": "http://localhost:3001",
      "/events": "http://localhost:3001",
      "/inventory": "http://localhost:3001",
      "/categories": "http://localhost:3001",
      "/admin": "http://localhost:3001",
      "/stream": {
        target: "http://localhost:3001",
        ws: false
      },
      "/storage": "http://localhost:3001",
      "/meta": "http://localhost:3001"
    }
  }
});

