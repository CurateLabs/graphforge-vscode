/** XYG owns persisted intent and validation; the editor resolves project references. */
export {
  isVisualizationIntent as isVisualizationSpec,
  createGraphForgeIntent as createResultGraphSpec,
} from "../../vendor/xyg/packages/xy-node/src/intent.cjs";
export type {
  VisualizationIntent as ProjectVisualizationSpec,
  ChartMark,
} from "../../vendor/xyg/packages/xy-node/src/intent.cjs";
