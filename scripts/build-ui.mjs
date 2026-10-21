// 一键构建新版前端：稳定输出到 app/dist。
// 用法：node scripts/build-ui.mjs
// 构建完成后由 scripts/server.mjs 在 5177 端口与 API 一起托管。

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const webDir = path.join(root, "web");
const appDir = path.join(root, "app");
const distDir = path.join(appDir, "dist");
const captureBridge = path.join(appDir, "capture-bridge.html");

// 直接调用本地 vite 的可执行入口，避免依赖 npx/cmd 启动（部分环境禁止 spawn .cmd）
const viteBin = path.join(webDir, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  console.error("缺少依赖。请先执行：cd web && npm install --legacy-peer-deps");
  process.exit(1);
}
if (!existsSync(captureBridge)) {
  console.error("构建失败：缺少 app/capture-bridge.html");
  process.exit(1);
}

mkdirSync(appDir, { recursive: true });

console.log("构建前端 -> app/dist");
rmSync(distDir, { recursive: true, force: true });
execFileSync(process.execPath, [viteBin, "build"], { cwd: webDir, stdio: "inherit" });

if (!existsSync(path.join(distDir, "index.html"))) {
  console.error("构建失败：未生成 index.html");
  process.exit(1);
}
copyFileSync(captureBridge, path.join(distDir, "capture-bridge.html"));

console.log("完成：app/dist");
console.log("启动：npm start");
