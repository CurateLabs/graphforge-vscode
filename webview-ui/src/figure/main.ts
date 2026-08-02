/**
 * GraphForge Figure webview (#62) — renders Plotly figure JSON posted from
 * the extension host. Scripts/styles come only from the Vite bundle (no CDN).
 */
import Plotly from "plotly.js/dist/plotly.min.js";
import "plotly.js/dist/plotly.css";
import type {
  FigureHostToWebview,
  FigureWebviewToHost,
  PlotlyFigure,
} from "../../../src/webview/figureSchema";
import "./figure.css";

const vscode = acquireVsCodeApi();

function post(message: FigureWebviewToHost): void {
  vscode.postMessage(message);
}

const root = document.getElementById("app");
const banner = document.getElementById("banner");
const plotEl = document.getElementById("plot");

function showBanner(message: string | undefined): void {
  if (!banner) {
    return;
  }
  if (!message) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}

function themeLayout(figure: PlotlyFigure): PlotlyFigure {
  const styles = getComputedStyle(document.body);
  const bg = styles.getPropertyValue("--vscode-editor-background").trim() || "#1e1e1e";
  const fg = styles.getPropertyValue("--vscode-editor-foreground").trim() || "#cccccc";
  const layout = {
    ...(figure.layout ?? {}),
    paper_bgcolor: bg,
    plot_bgcolor: bg,
    font: {
      ...((figure.layout?.font as Record<string, unknown> | undefined) ?? {}),
      color: fg,
    },
  };
  return { ...figure, layout };
}

async function renderFigure(figure: PlotlyFigure): Promise<void> {
  if (!plotEl) {
    throw new Error("Plot container missing");
  }
  showBanner(undefined);
  const themed = themeLayout(figure);
  await Plotly.react(plotEl, themed.data, themed.layout ?? {}, {
    responsive: true,
    displaylogo: false,
  });
}

window.addEventListener("message", (event: MessageEvent<FigureHostToWebview>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") {
    return;
  }
  if (msg.type === "graphforge/figureError") {
    showBanner(msg.message);
    return;
  }
  if (msg.type === "graphforge/figure") {
    void renderFigure(msg.figure).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      showBanner(`Could not render figure: ${message}`);
      post({ type: "graphforge/renderFailed", message });
    });
  }
});

window.addEventListener("resize", () => {
  if (plotEl) {
    void Plotly.Plots.resize(plotEl);
  }
});

if (root) {
  // Present so Plotly's addRelatedStyleRule can no-op under strict CSP when
  // plotly.css is already loaded (see plotly.js CSP notes / ADR-0001).
  if (!document.getElementById("plotly.js-style-global")) {
    const style = document.createElement("style");
    style.id = "plotly.js-style-global";
    document.head.appendChild(style);
  }
}

post({ type: "graphforge/ready" });
