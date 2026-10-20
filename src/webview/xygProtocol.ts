/**
 * Host ↔ webview contract for XYG visualizations (#80), following XYG's
 * GraphForge integration note §4 (`xyg.render` / `xyg.pick` / `xyg.select` /
 * `xyg.error`). Identities are UUID strings; result values never travel here
 * except as XYG's own paint buffers or escaped table HTML, and none are logged.
 */
import type { XygHost, XygIdentity } from "../session/xygAdapter";

export interface XygMessageContext {
  instanceId: string;
  renderGeneration: number;
}

/** Wire form of the shared compose input (WASM host): Arrow IPC as bytes. */
export interface XygWasmComposeInput {
  base?: { tables: Uint8Array[]; generation?: string };
  layers: {
    result: Uint8Array;
    intent: string;
    resultId: string;
    generation?: string;
  }[];
  select?: string[];
}

/** Value-free status shown in the panel and returned to agents. */
export interface XygPanelStatus {
  phase: "prepare" | "paint" | "ready" | "failed";
  title: string;
  host: XygHost;
  intent: string;
  kind?: string;
  nodes?: number;
  edges?: number;
  rows?: number;
  decisions?: string[];
  durationMs?: number;
}

export type XygHostToWebview =
  | (XygMessageContext & {
      type: "xyg.render";
      mode: "native";
      status: XygPanelStatus;
      spec: unknown;
      buffer: Uint8Array;
    })
  | (XygMessageContext & {
      type: "xyg.render";
      mode: "table";
      status: XygPanelStatus;
      html: string;
    })
  | (XygMessageContext & {
      type: "xyg.render";
      mode: "wasm";
      status: XygPanelStatus;
      input: XygWasmComposeInput;
      resultId: string;
    })
  | (XygMessageContext & { type: "xyg.status"; status: XygPanelStatus })
  /** WASM host only: the webview owns the composition, so it maps rows → UUIDs. */
  | (XygMessageContext & { type: "xyg.selectRows"; rows: number[] })
  | (XygMessageContext & {
      type: "xyg.error";
      code: string;
      message: string;
      nextAction: string;
      layer: number | null;
      field: string | null;
    });

export type XygWebviewToHost =
  | { type: "xyg.ready"; width: number; height: number; theme: "light" | "dark" }
  | { type: "xyg.resize"; width: number; height: number }
  | (XygMessageContext & { type: "xyg.pick"; trace: number; index: number })
  | (XygMessageContext & { type: "xyg.pickIdentity"; identity: XygIdentity })
  | (XygMessageContext & { type: "xyg.rendered"; durationMs: number })
  | (XygMessageContext & {
      type: "xyg.failed";
      code: string;
      message: string;
      layer: number | null;
      field: string | null;
    });
