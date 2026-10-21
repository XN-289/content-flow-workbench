import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 构建产物固定输出到 app/dist，由 scripts/server.mjs 与 /api 同端口托管。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../app/dist",
    // 清空上一轮资源，避免 hash 文件无限累积；bridge 由构建脚本回填。
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2020"
  },
  server: {
    port: 5181,
    proxy: {
      "/api": "http://127.0.0.1:5177"
    }
  }
});
