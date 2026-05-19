import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// mkcert-signed cert for redstonecipher.com + localhost. Regenerate with:
//   mkcert -cert-file frontend/certs/redstonecipher.com.pem \
//          -key-file  frontend/certs/redstonecipher.com-key.pem \
//          redstonecipher.com localhost 127.0.0.1 ::1
const certDir = path.resolve(__dirname, "./certs");
const certPath = path.join(certDir, "redstonecipher.com.pem");
const keyPath  = path.join(certDir, "redstonecipher.com-key.pem");
const httpsOpts =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Vite 8 / Rolldown cannot resolve transitive @radix-ui/* deps from
      // inside sibling @radix-ui packages during the production build.
      // Explicit aliases point Rolldown directly at the dist files.
      "@radix-ui/react-compose-refs": path.resolve(
        __dirname, "node_modules/@radix-ui/react-compose-refs/dist/index.mjs",
      ),
    },
  },
  server: {
    // Dual-stack: `::` with V6ONLY off accepts both IPv4 and IPv6 so
    // https://127.0.0.1:5173, https://localhost:5173 (->::1), and
    // https://redstonecipher.com (pf rdr on lo0) all reach us.
    host: "::",
    port: 5173,
    strictPort: true,                  // fail fast instead of silently hopping ports
    https: httpsOpts,
    // With /etc/hosts mapping redstonecipher.com → 127.0.0.1, Vite would reject
    // the Host header by default; whitelist it here.
    allowedHosts: ["redstonecipher.com", "localhost", "127.0.0.1"],
    proxy: {
      "/api":  { target: "http://localhost:8787", changeOrigin: true },
      "/auth": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // Vite 8's Rolldown bundler has a known issue resolving transitive
  // @radix-ui/* peer deps from within sibling @radix-ui packages.
  // Explicit inclusion forces Vite to pre-bundle these up-front.
  optimizeDeps: {
    include: [
      "@radix-ui/react-compose-refs",
      "@radix-ui/react-primitive",
      "@radix-ui/react-context",
      "@radix-ui/react-presence",
    ],
  },
});
