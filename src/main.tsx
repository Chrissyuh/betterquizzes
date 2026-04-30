import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { BETTERQUIZZER_VERSION } from "./shared/version";

function showFatalWidgetError(error: unknown): void {
  const root = document.getElementById("root");
  const message = error instanceof Error ? error.message : String(error);
  if (!root) return;
  root.innerHTML = `
    <main class="shell narrow">
      <section class="card stack fatal-widget-error">
        <p class="eyebrow">BetterQuizzes ${BETTERQUIZZER_VERSION}</p>
        <h1>Widget error</h1>
        <p>The BetterQuizzes UI hit an error instead of going blank. Copy this message if you need to debug it.</p>
        <pre class="error-box"></pre>
      </section>
    </main>`;
  const pre = root.querySelector("pre");
  if (pre) pre.textContent = message;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("BetterQuizzes widget render error", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="shell narrow">
          <section className="card stack fatal-widget-error">
            <p className="eyebrow">BetterQuizzes {BETTERQUIZZER_VERSION}</p>
            <h1>Widget error</h1>
            <p>The widget hit a render error instead of going blank.</p>
            <pre className="error-box">{this.state.error.message}</pre>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

window.addEventListener("error", (event) => showFatalWidgetError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showFatalWidgetError(event.reason));

const rootElement = document.getElementById("root");
if (!rootElement) {
  showFatalWidgetError(new Error("Missing #root element."));
} else {
  rootElement.dataset.bqMounted = "true";
  createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
