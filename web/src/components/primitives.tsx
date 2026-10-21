import React, { useEffect, useId, useRef } from "react";
import { STAGES, STAGE_LABEL } from "../lib/constants";
import type { Tone } from "../lib/types";

/* ---------------- Button ---------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  small?: boolean;
};

export function Button({ variant = "secondary", small, className = "", ...rest }: ButtonProps) {
  const classes = ["btn", variant === "secondary" ? "" : variant, small ? "small" : "", className].filter(Boolean).join(" ");
  return <button type="button" className={classes} {...rest} />;
}

/* ---------------- StatusChip ---------------- */

export function Chip({
  tone = "neutral",
  children,
  dot,
  outline
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  outline?: boolean;
}) {
  return (
    <span className={`chip ${tone}${outline ? " outline" : ""}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ---------------- Card ---------------- */

export function Card({
  id,
  title,
  hint,
  actions,
  children,
  tight,
  className = ""
}: {
  id?: string;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  tight?: boolean;
  className?: string;
}) {
  return (
    <section id={id} className={`card${tight ? " tight" : ""} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div className="stack" style={{ gap: 2 }}>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {hint ? <span className="card-sub">{hint}</span> : null}
          </div>
          {actions ? <div className="inline">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

/* ---------------- Segmented ---------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Switch ---------------- */

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" data-on={checked}>
        <span className="switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

/* ---------------- QueueRow ---------------- */

export function QueueRow({
  tone = "neutral",
  title,
  meta,
  right,
  selected,
  onClick,
  ariaLabel
}: {
  tone?: Tone;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className="row"
      aria-selected={selected ? true : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      style={onClick ? undefined : { cursor: "default" }}
    >
      <span className="row-dot" data-tone={tone} aria-hidden="true" />
      <span className="row-content">
        <span className="row-title">{title}</span>
        {meta ? <span className="row-meta">{meta}</span> : null}
      </span>
      {right}
    </button>
  );
}

/* ---------------- Pipeline steps ---------------- */

export function StepTrack({ stages }: { stages: any[] }) {
  return (
    <div>
      <div className="steps">
        {stages.map((stage) => (
          <div className="step" key={stage.id} data-tone={stage.tone}>
            <div className="step-bar" />
            <span className="step-label" title={stage.detail}>
              {stage.label}
            </span>
            <span className="step-state">{stage.stateLabel}</span>
          </div>
        ))}
      </div>
      {stages
        .filter((stage) => stage.tone === "danger" || stage.tone === "warning")
        .map((stage) => (
          <p className="step-detail" key={`detail-${stage.id}`}>
            {stage.label}：{stage.detail}
          </p>
        ))}
    </div>
  );
}

/* ---------------- Stage track (8 stages) ---------------- */

export function StageTrack({ current }: { current: string }) {
  const index = STAGES.indexOf(current as (typeof STAGES)[number]);
  return (
    <div className="track" role="list" aria-label="选题阶段">
      {STAGES.map((stage, position) => {
        const state = index < 0 ? "pending" : position < index ? "complete" : position === index ? "current" : "pending";
        const stateLabel = state === "complete" ? "已完成" : state === "current" ? "当前" : "未开始";
        return (
          <React.Fragment key={stage}>
            {position > 0 ? <span className="track-sep" data-complete={position <= index} aria-hidden="true" /> : null}
            <span className="track-node" data-state={state} role="listitem" aria-label={`${STAGE_LABEL[stage]}（${stateLabel}）`}>
              <span className="track-dot" aria-hidden="true" />
              <span className="track-label">{STAGE_LABEL[stage]}</span>
              {state === "current" ? <span className="track-current">当前</span> : null}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---------------- Checklist ---------------- */

export function CheckItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div className="check">
      {done ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="var(--success-soft)" stroke="var(--success)" strokeWidth="1.2" />
          <path d="M5 8.2L7.2 10.3L11 6" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="var(--warning-soft)" stroke="var(--warning)" strokeWidth="1.2" />
          <path d="M8 4.6V8.4" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="10.4" r="0.85" fill="var(--warning)" />
        </svg>
      )}
      <span>{children}</span>
    </div>
  );
}

/* ---------------- Timeline item ---------------- */

export function TimelineItem({
  tone = "neutral",
  title,
  meta,
  right
}: {
  tone?: Tone;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="row row-static">
      <span className="row-dot" data-tone={tone} aria-hidden="true" />
      <span className="row-content">
        <span className="row-title row-title-strong">{title}</span>
        {meta ? <span className="row-meta">{meta}</span> : null}
      </span>
      {right}
    </div>
  );
}

/* ---------------- Sheet ---------------- */

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) || []).filter(
        (element) => element.getClientRects().length > 0
      );

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const initial =
      ref.current?.querySelector<HTMLElement>("[data-sheet-initial-focus]") ||
      ref.current?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])") ||
      getFocusable()[0] ||
      ref.current;
    initial?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        tabIndex={-1}
      >
        <header className="sheet-head">
          <h2 className="card-title" id={titleId}>
            {title}
          </h2>
          <Button variant="ghost" small onClick={onClose} aria-label="关闭">
            关闭
          </Button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-foot">{footer}</footer> : null}
      </aside>
    </>
  );
}

/* ---------------- Field ---------------- */

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/* ---------------- States ---------------- */

export function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <span>{text}</span>
      {action}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="empty" role="alert">
      <strong style={{ color: "var(--danger)" }}>出错了</strong>
      <span>{text}</span>
      <Button onClick={onRetry}>重试</Button>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton" key={index} style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function Keycap({ children }: { children: React.ReactNode }) {
  return <span className="keycap">{children}</span>;
}
