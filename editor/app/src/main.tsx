import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./editor.css";

// ── 全局错误捕获：将 JS 错误显示在页面上 ──
window.onerror = (msg, src, line, col, err) => {
  showError(`[onerror] ${msg}\n  at ${src}:${line}:${col}\n${err?.stack || ""}`);
};
window.onunhandledrejection = (e: PromiseRejectionEvent) => {
  showError(`[unhandledrejection] ${e.reason?.message || e.reason}\n${e.reason?.stack || ""}`);
};

function showError(text: string) {
  const el = document.getElementById("error-display");
  if (el) {
    el.style.display = "block";
    el.textContent += text + "\n\n";
  }
  console.error(text);
}

// ── React Error Boundary ──
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    showError(
      `[React Error Boundary]\n${error.message}\n${error.stack}\n\nComponent Stack:${info.componentStack}`
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 40,
            color: "#ff4444",
            background: "#1a0000",
            fontFamily: "monospace",
            fontSize: 14,
            whiteSpace: "pre-wrap",
            height: "100vh",
            overflow: "auto",
          }}
        >
          <h2 style={{ color: "#ff6666" }}>React Error</h2>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 插入错误显示区域（全局 JS 错误） ──
const errorDiv = document.createElement("div");
errorDiv.id = "error-display";
errorDiv.style.cssText =
  "display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;" +
  "background:#1a0000;color:#ff4444;font-family:monospace;font-size:13px;" +
  "padding:20px;overflow:auto;white-space:pre-wrap;";
document.body.prepend(errorDiv);

// ── 启动 React ──
console.log("[editor] main.tsx: starting React render...");

const rootEl = document.getElementById("root");
if (!rootEl) {
  showError("FATAL: #root element not found in DOM");
} else {
  try {
    const root = ReactDOM.createRoot(rootEl);
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
    console.log("[editor] main.tsx: React render called successfully");
  } catch (err: unknown) {
    const e = err as Error;
    showError(`[main.tsx] Failed to render: ${e.message}\n${e.stack}`);
  }
}
