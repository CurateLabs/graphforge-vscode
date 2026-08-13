import {
  ForceAtlas2Layout,
  type ForceAtlas2LayoutOptions,
  type GraphData,
} from "@antv/layout";

export interface ResultGraphLayoutWorkerNode {
  id: string;
  x: number;
  y: number;
}

export interface ResultGraphLayoutWorkerEdge {
  id: string;
  source: string;
  target: string;
}

export interface ResultGraphLayoutWorkerRequest {
  nodes: ResultGraphLayoutWorkerNode[];
  edges: ResultGraphLayoutWorkerEdge[];
  width: number;
  height: number;
  options: Pick<
    ForceAtlas2LayoutOptions,
    | "maxIteration"
    | "barnesHut"
    | "prune"
    | "preventOverlap"
    | "dissuadeHubs"
    | "nodeSize"
    | "nodeSpacing"
    | "kr"
    | "kg"
    | "ks"
    | "ksmax"
    | "tao"
    | "mode"
  >;
}

export type ResultGraphLayoutWorkerResponse =
  | {
      ok: true;
      positions: { id: string; x: number; y: number }[];
    }
  | {
      ok: false;
      code: "GF_G6_LAYOUT_FAILED";
      message: string;
    };

interface LayoutWorkerScope {
  onmessage: ((event: MessageEvent<ResultGraphLayoutWorkerRequest>) => void) | null;
  postMessage(message: ResultGraphLayoutWorkerResponse): void;
}

const workerScope = globalThis as unknown as LayoutWorkerScope;

workerScope.onmessage = (event) => {
  void runLayout(event.data);
};

async function runLayout(request: ResultGraphLayoutWorkerRequest): Promise<void> {
  const layout = new ForceAtlas2Layout();
  try {
    if (!(request.width > 0) || !(request.height > 0)) {
      throw new Error("The graph viewport must have a positive width and height.");
    }

    const data: GraphData = {
      nodes: request.nodes,
      edges: request.edges,
    };
    await layout.execute(data, {
      ...request.options,
      center: [request.width / 2, request.height / 2],
      width: request.width,
      height: request.height,
      dimensions: 2,
      enableWorker: false,
    });

    const positions: { id: string; x: number; y: number }[] = [];
    layout.forEachNode((node) => {
      positions.push({ id: String(node.id), x: node.x, y: node.y });
    });
    workerScope.postMessage({ ok: true, positions });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      code: "GF_G6_LAYOUT_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    layout.destroy();
  }
}
