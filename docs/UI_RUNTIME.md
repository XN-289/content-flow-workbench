# 前端运行与构建说明

更新日期：2026-10-22。

## 单端口成品模式

构建一次新版前端，然后直接启动主服务：

```powershell
cd D:\personal-content-workbench
npm run build:ui
npm start
```

打开 **http://127.0.0.1:5177/**。

`scripts/server.mjs` 现在同时提供：

- `app/dist/**` 下的 React 构建产物；
- `/api/**` 下的全部工作台接口；
- SPA 页面回落；
- 对缺失 `/assets/**` 资源返回 404，而不是误返回 `index.html`。

默认端口是 `5177`。需要临时改端口时使用 `$env:PORT=另一个端口; npm start`。

`npm start` 不会隐式重建前端。前端源码或样式改动后，先运行 `npm run build:ui`，再重启服务。旧 `app/index.html`、`app/app.js`、`app/styles.css` 已删除；`app/capture-bridge.html` 仍保留，只用于小红书受限页面的本地桥接。

## 开发模式

需要 Vite 热更新时，保留一个进程作为后端，再启动 Vite：

```powershell
# 终端 1：后端与 API
cd D:\personal-content-workbench
npm start

# 终端 2：Vite 热更新界面
cd D:\personal-content-workbench\web
npm run dev
```

开发界面打开 **http://127.0.0.1:5181/**。Vite 的 `/api` 已代理到 `http://127.0.0.1:5177`。

这是唯一的双进程开发方式；成品运行不再需要 `scripts/ui.mjs`、`scripts/ui-server.mjs`、`UI_PORT` 或 `API_PORT`。

## 构建与产物

```powershell
cd D:\personal-content-workbench
npm run build:ui
```

等价于运行 `node scripts/build-ui.mjs`。Vite 的稳定输出目录是 `app/dist`，入口文件固定为 `app/dist/index.html`。

构建采用 `emptyOutDir: true`，先清空 `app/dist` 的旧资源，再由 Vite 生成当前文件并回填 `app/capture-bridge.html`。因此构建目录不会累积历史 hash 文件，`app/` 下的其他历史目录也不受影响。

## 服务行为

请求分派顺序如下：

1. `/api` 与 `/api/**` 优先进入后端 API；
2. 其余请求映射到 `app/dist`；
3. 已存在的文件按扩展名返回正确 MIME；
4. 不存在且不像静态文件的路径回落到 `app/dist/index.html`，支持前端深链；
5. 缺失的 `/assets/**` 或带扩展名资源返回 404；
6. 越出 `app/dist` 的路径返回 403。

前端尚未构建时，页面请求返回 503，并提示运行 `npm run build:ui`。

## 验证

```powershell
cd D:\personal-content-workbench
node --check scripts/build-ui.mjs
node --check scripts/server.mjs
npm run build:ui
npm run test:chain
```

启动 `npm start` 后可验证：

```powershell
Invoke-WebRequest http://127.0.0.1:5177/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/workflow -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/api/state -UseBasicParsing
```

最后一条必须返回工作台状态的 JSON；前两条必须返回 `app/dist/index.html` 的 React 入口。
