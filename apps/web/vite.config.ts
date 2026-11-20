import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = "http://localhost:3001";
const appRouteProxy: ProxyOptions = {
  target: apiTarget,
  bypass(request) {
    const pathname = request.url?.split("?")[0] ?? "";
    if (request.method === "GET" && request.headers.accept?.includes("text/html") &&
      /^\/(?:events(?:\/[^/]+)?|inventory(?:\/transfers)?)\/?$/.test(pathname)) {
      return "/index.html";
    }
  }
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/auth": apiTarget,
      "/events": appRouteProxy,
      "/inventory": appRouteProxy,
      "/warehouses": apiTarget,
      "/categories": apiTarget,
      "/admin": apiTarget,
      "/stream": {
        target: apiTarget,
        ws: false
      },
      "/storage": apiTarget,
      "/meta": apiTarget
    }
  }
});

