import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const devKeyPath = path.resolve(__dirname, ".cert/pico-gamer-main.local-key.pem");
const devCertPath = path.resolve(__dirname, ".cert/pico-gamer-main.local.pem");
const https =
  process.env.VITE_NO_HTTPS
    ? undefined
    : fs.existsSync(devKeyPath) && fs.existsSync(devCertPath)
      ? {
          key: fs.readFileSync(devKeyPath),
          cert: fs.readFileSync(devCertPath),
        }
      : undefined;

export default defineConfig({
  root: ".",
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    https,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
  },
  optimizeDeps: {
    exclude: ["./src/wasm/pico-vm.mjs"],
  },
  assetsInclude: ["**/*.wasm"],
});
