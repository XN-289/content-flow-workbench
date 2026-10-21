import React, { useState } from "react";
import { api } from "./lib/api";
import { StoreProvider, useStore } from "./state/store";
import { Shell, Toasts, TopBar } from "./components/AppShell";
import { Button, Field, Sheet } from "./components/primitives";
import { OverviewView } from "./features/overview";
import { FlowView } from "./features/flow";
import { WorkflowView } from "./features/workflow";
import { SystemView } from "./features/system";

function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mutate, setView, notify } = useStore();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) {
      setError("请粘贴至少一条信号内容");
      return;
    }
    try {
      const result = await api.capture(text.trim());
      setError(null);
      setText("");
      onClose();
      await mutate("capture", () => Promise.resolve(), "已解析");
      notify(`发现 ${result?.run?.found ?? 0} 条，新增 ${result?.run?.created ?? 0} 条，重复 ${result?.run?.duplicates ?? 0} 条`, "success");
      setView("flow");
    } catch (err: any) {
      setError(err.message || "解析失败");
    }
  };

  return (
    <Sheet
      open={open}
      title="快速粘贴信号"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit}>
            解析并入库
          </Button>
        </>
      }
    >
      <Field label="粘贴内容" hint="支持一行一条，解析后会进入 Inbox 待分诊" error={error || undefined}>
        <textarea
          className="textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="把值得拆解的笔记正文或链接粘到这里"
        />
      </Field>
    </Sheet>
  );
}

function Router({ onQuickCapture }: { onQuickCapture: () => void }) {
  const { view, setView, state, loading, error, refresh } = useStore();

  if (loading) {
    return (
      <div className="app">
        <TopBar onQuickCapture={onQuickCapture} />
        <Shell canvas={<div className="card">正在加载工作台状态…</div>} />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="app">
        <TopBar onQuickCapture={onQuickCapture} />
        <Shell
          canvas={
            <div className="card" role="alert">
              <h2 className="card-title">无法连接本地服务</h2>
              <p className="muted" style={{ fontSize: 13 }}>
                {error || "未知错误"}
              </p>
              <div className="stack" style={{ gap: 6 }}>
                <span className="section-label">先检查这三件事</span>
                <p className="subtle" style={{ fontSize: 12, lineHeight: "20px" }}>
                  1. 本地服务是否在运行：在项目目录执行 <span className="mono">npm start</span>，界面和 API 会一起监听 5177。
                  <br />
                  2. 如果前端刚更新过：先执行 <span className="mono">npm run build:ui</span>，再重启 <span className="mono">npm start</span>。
                  <br />
                  3. 端口是否被占用：<span className="mono">netstat -ano | findstr 5177</span>。
                </p>
              </div>
              <div className="inline">
                <Button variant="primary" onClick={refresh}>
                  重试
                </Button>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar onQuickCapture={onQuickCapture} />
      {view === "overview" ? <OverviewView onOpenSignalFlow={() => setView("flow")} /> : null}
      {view === "flow" ? <FlowView /> : null}
      {view === "workflow" ? <WorkflowView /> : null}
      {view === "system" ? <SystemView /> : null}
    </div>
  );
}

function Workbench() {
  const [captureOpen, setCaptureOpen] = useState(false);
  return (
    <StoreProvider>
      <Router onQuickCapture={() => setCaptureOpen(true)} />
      <QuickCapture open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <Toasts />
    </StoreProvider>
  );
}

export default function App() {
  return <Workbench />;
}
