import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true -> listen di semua interface (default Vite cuma loopback ::1,
    // sehingga port 5183 tidak bisa dibuka dari device lain di tailnet).
    // allowedHosts -> Vite menolak Host header tak dikenal dengan 403;
    // izinkan suffix tailnet sendiri agar bisa diakses lewat MagicDNS/IP Tailscale.
    host: true,
    port: 5183,
    strictPort: true,
    allowedHosts: [".tailbbb6a4.ts.net"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4010",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
