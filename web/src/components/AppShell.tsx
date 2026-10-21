import React, { useState } from "react";
import { NAV_ITEMS, useStore } from "../state/store";
import { summarizePipelineStages } from "../lib/format";
import { Button, Chip, Segmented, Sheet } from "./primitives";

function LogoMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 12.5L6.5 3L9.5 9L11.5 5.5L14 12.5H2Z" fill="var(--ink-on-action)" />
      </svg>
    </span>
  );
}

export function TopBar({ onQuickCapture }: { onQuickCapture: () => void }) {
  const { state, view, setView, theme, setTheme, busy } = useStore();
  const automationKnown = Boolean(state?.runtime?.automation);
  const automationOn = Boolean(state?.runtime?.automation?.effectiveEnabled);
  const envDisabled = Boolean(state?.runtime?.automation?.envDisabled);
  const lastRun = state?.morningPipelineRuns?.[0];
  const stages = state?.runtime?.morningPipeline?.stages || [];
  const pipelineSummary = summarizePipelineStages(stages);

  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <span className="brand-name">内容工作台</span>
      </div>

      <nav className="nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.key}
            className="nav-item"
            href={item.key === "overview" ? "/" : `/${item.key}`}
            aria-current={view === item.key ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setView(item.key);
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <span className="spacer" />

      {lastRun && (
        <Chip tone={pipelineSummary.tone} dot>
          {pipelineSummary.label}
        </Chip>
      )}

      <Chip tone={!automationKnown ? "neutral" : automationOn ? "success" : "warning"} dot>
        {!automationKnown
          ? "自动化状态未知"
          : envDisabled
            ? "自动化已暂停（环境变量）"
            : automationOn
              ? "自动化运行中"
              : "自动化已暂停"}
      </Chip>

      <Segmented
        ariaLabel="主题模式"
        value={theme}
        onChange={(next) => setTheme(next)}
        options={[
          { value: "auto", label: "自动" },
          { value: "light", label: "浅色" },
          { value: "dark", label: "深色" }
        ]}
      />

      <Button onClick={onQuickCapture} disabled={busy === "capture"}>
        快速粘贴信号
      </Button>
    </header>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useStore();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} data-tone={toast.tone} onClick={() => dismiss(toast.id)}>
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Shell({
  queue,
  canvas,
  inspector,
  mobileAction,
  queueLabel = "队列",
  inspectorLabel = "检查器"
}: {
  queue?: React.ReactNode;
  canvas: React.ReactNode;
  inspector?: React.ReactNode;
  mobileAction?: React.ReactNode;
  queueLabel?: string;
  inspectorLabel?: string;
}) {
  const [mobilePanel, setMobilePanel] = useState<"queue" | "inspector" | null>(null);

  return (
    <div className={`shell${queue ? "" : " no-queue"}`}>
      {queue ? <aside className="zone-queue" aria-label="队列">{queue}</aside> : null}
      <main className="zone-canvas">
        {queue || inspector ? (
          <div className="mobile-context" aria-label="移动端上下文">
            {queue ? (
              <Button small variant="ghost" data-panel="queue" onClick={() => setMobilePanel("queue")}>
                查看{queueLabel}
              </Button>
            ) : null}
            {inspector ? (
              <Button small variant="ghost" data-panel="inspector" onClick={() => setMobilePanel("inspector")}>
                查看{inspectorLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
        {canvas}
      </main>
      {inspector ? <aside className="zone-inspector" aria-label="上下文检查器">{inspector}</aside> : null}
      {mobileAction ? <div className="mobile-bar">{mobileAction}</div> : null}
      <Sheet
        open={mobilePanel !== null}
        title={mobilePanel === "inspector" ? inspectorLabel : queueLabel}
        onClose={() => setMobilePanel(null)}
      >
        {mobilePanel === "inspector" ? inspector : mobilePanel === "queue" ? queue : null}
      </Sheet>
    </div>
  );
}
