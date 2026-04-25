import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// mkcert-signed cert for example.com + localhost. Regenerate with:
//   mkcert -cert-file frontend/certs/example.com.pem \
//          -key-file  frontend/certs/example.com-key.pem \
//          example.com localhost 127.0.0.1 ::1
const certDir = path.resolve(__dirname, "./certs");
const certPath = path.join(certDir, "example.com.pem");
const keyPath  = path.join(certDir, "example.com-key.pem");
const httpsOpts =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    // Dual-stack: `::` with V6ONLY off accepts both IPv4 and IPv6 so
    // https://127.0.0.1:5173, https://localhost:5173 (->::1), and
    // https://example.com (pf rdr on lo0) all reach us.
    host: "::",
    port: 5173,
    strictPort: true,                  // fail fast instead of silently hopping ports
    https: httpsOpts,
    // With /etc/hosts mapping example.com → 127.0.0.1, Vite would reject
    // the Host header by default; whitelist it here.
    allowedHosts: ["example.com", "localhost", "127.0.0.1"],
    proxy: {
      "/api":  { target: "http://localhost:8787", changeOrigin: true },
      "/auth": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
