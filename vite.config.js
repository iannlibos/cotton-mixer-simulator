import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        outDir: "dist",
        sourcemap: false,
    },
});
