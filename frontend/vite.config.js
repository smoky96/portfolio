import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        allowedHosts: ["localhost", "127.0.0.1", "nginx"],
        proxy: {
            "/api": {
                target: "http://localhost:8000",
                changeOrigin: true
            }
        }
    },
    preview: {
        allowedHosts: ["localhost", "127.0.0.1", "nginx"]
    }
});
