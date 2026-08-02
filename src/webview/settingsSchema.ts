/**
 * Schema + message protocol for the GraphForge Settings webview (#24).
 *
 * Kept free of `vscode` imports on purpose: this module is the single source
 * of truth shared by the extension host (`src/webview/settingsPanel.ts`) and
 * the Vite-built webview app (`webview-ui/src/settings/`), and is unit-tested
 * under plain mocha against `package.json#contributes.configuration`.
 *
 * Categories follow issue #24's scope (Runtime / Experience / Advanced —
 * "Project" is omitted until a project-scoped setting exists; a settings
 * category with no controls would be a stub UI). Copy is analyst-facing per
 * docs/DESIGN.md Voice: no infra jargon, always name the next action.
 */

export type SettingValue = string | boolean | number;

export interface SettingEnumOption {
  value: string;
  label: string;
  description: string;
}

export interface SettingDescriptor {
  /** Key under the `graphforge.` section, e.g. `"runtime"`. */
  key: string;
  label: string;
  /** One or two analyst-facing sentences. */
  description: string;
  type: "boolean" | "string" | "enum" | "number";
  default: SettingValue;
  /** Present iff `type === "enum"`. */
  options?: readonly SettingEnumOption[];
  /** Placeholder for empty string inputs (what "leave empty" means). */
  placeholder?: string;
}

export interface SettingsCategory {
  id: string;
  label: string;
  /** One line under the category heading. */
  blurb: string;
  settings: readonly SettingDescriptor[];
}

export const SETTINGS_SECTION = "graphforge";

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "runtime",
    label: "Runtime",
    blurb: "Which engine backs Cypher queries and analyst verbs.",
    settings: [
      {
        key: "runtime",
        label: "Engine runtime",
        description:
          "GraphForge can run on the Node binding (fast, in-process) or the Python bridge. Auto picks for you — Node by default, Python in a Python-first workspace.",
        type: "enum",
        default: "auto",
        options: [
          {
            value: "auto",
            label: "Auto (recommended)",
            description:
              "Prefers Node; a Python-first workspace (pyproject.toml, uv.lock…) prefers Python. Falls back to whichever runtime is available.",
          },
          {
            value: "node",
            label: "Node only",
            description: "Always use @curatelabs/graphforge. Never falls back to Python.",
          },
          {
            value: "python",
            label: "Python only",
            description: "Always use the Python graphforge bridge. Never falls back to Node.",
          },
        ],
      },
      {
        key: "engineVersion",
        label: "Engine version",
        description:
          "Which graphforge version the Setup wizards install (npm @curatelabs/graphforge, or PyPI graphforge for the Python runtime). Use \"latest\" or pin a version like \"0.5.1\". The version picker in Setup Native/Python Binding writes here.",
        type: "string",
        default: "latest",
        placeholder: "latest",
      },
    ],
  },
  {
    id: "experience",
    label: "Experience",
    blurb: "How much GraphForge confirms with you vs. acts on its own.",
    settings: [
      {
        key: "experienceMode",
        label: "Experience mode",
        description:
          "Guided confirms before changes and keeps the checklist visible. Autonomous auto-opens detected projects and skips routine confirmations — it still fails closed on destructive operations.",
        type: "enum",
        default: "guided",
        options: [
          {
            value: "guided",
            label: "Guided",
            description:
              "Confirms before Initialize; quieter auto-run; Result Graph stays closed until opened.",
          },
          {
            value: "autonomous",
            label: "Autonomous",
            description:
              "Auto-opens detected projects and the Result Graph after queries; skips routine confirmations.",
          },
        ],
      },
      {
        key: "openResultGraphOnQuery",
        label: "Open Result Graph after queries",
        description:
          "Show the Result Graph panel automatically after a successful Cypher query or analyst verb.",
        type: "boolean",
        default: true,
      },
      {
        key: "resultGraph.renderer",
        label: "Result Graph renderer",
        description:
          "Choose the template used for new Result Graph artifacts. Saved artifacts keep their recorded renderer.",
        type: "enum",
        default: "g6",
        options: [
          {
            value: "g6",
            label: "AntV G6 (recommended)",
            description:
              "Canvas rendering with an explicit worker ForceAtlas2 layout, pan, zoom, fit, and inspection.",
          },
          {
            value: "cytoscape",
            label: "Cytoscape",
            description:
              "Canvas rendering with force layout, pan, zoom, fit, and node or edge inspection.",
          },
          {
            value: "sigma",
            label: "Sigma",
            description:
              "WebGL rendering with ForceAtlas2 layout, suited to larger and denser result graphs.",
          },
        ],
      },
      {
        key: "chart.renderer",
        label: "Chart renderer",
        description:
          "Choose the template used for new chart artifacts. Saved artifacts keep their recorded renderer.",
        type: "enum",
        default: "g2",
        options: [
          {
            value: "g2",
            label: "AntV G2 (recommended)",
            description:
              "Declarative charts generated from explicit project-artifact field bindings.",
          },
          {
            value: "plotly",
            label: "Plotly",
            description:
              "Retains the existing Plotly figure renderer and Python/JavaScript JSON interchange.",
          },
        ],
      },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    blurb: "Manual runtime paths, limits, and explicitly dangerous module permissions.",
    settings: [
      {
        key: "nativeModulePath",
        label: "Node binding path",
        description:
          "Absolute path to a built @curatelabs/graphforge package (the directory containing index.js). Leave empty to resolve from node_modules or a sibling checkout.",
        type: "string",
        default: "",
        placeholder: "Auto-detect (node_modules or sibling checkout)",
      },
      {
        key: "pythonInterpreterPath",
        label: "Python interpreter path",
        description:
          "Absolute path to a Python interpreter with graphforge installed. Leave empty to auto-detect (Python extension selection, workspace .venv, then python3 on PATH).",
        type: "string",
        default: "",
        placeholder: "Auto-detect (Python extension, .venv, PATH)",
      },
      {
        key: "figureLimitsEnabled",
        label: "Enforce Figure size limits",
        description:
          "When on, reject Plotly figures that exceed max traces, points, or JSON bytes. Off by default so agents are not capped unless you opt in.",
        type: "boolean",
        default: false,
      },
      {
        key: "figureMaxTraces",
        label: "Figure max traces",
        description: "Maximum number of Plotly traces when Figure size limits are enabled.",
        type: "number",
        default: 50,
      },
      {
        key: "figureMaxPoints",
        label: "Figure max points",
        description:
          "Approximate maximum x/y points across traces when Figure size limits are enabled.",
        type: "number",
        default: 100000,
      },
      {
        key: "figureMaxBytes",
        label: "Figure max JSON bytes",
        description: "Maximum serialized figure JSON size when Figure size limits are enabled.",
        type: "number",
        default: 10000000,
      },
      {
        key: "modules.dangerouslyAllowWorkspaceJavaScript",
        label: "Dangerously allow workspace JavaScript modules",
        description:
          "Allows an explicitly confirmed side-loaded module to run JavaScript with GraphForge extension permissions. User-level only, off by default, and still requires Workspace Trust. Enable only after reviewing the module code.",
        type: "boolean",
        default: false,
      },
    ],
  },
];

/** Every descriptor across all categories, in display order. */
export function allSettingDescriptors(): SettingDescriptor[] {
  return SETTINGS_CATEGORIES.flatMap((category) => [...category.settings]);
}

/** Current values keyed by short setting key (e.g. `"runtime"`). */
export type SettingsValues = Record<string, SettingValue>;

export type SettingsHostToWebview = {
  type: "graphforge/settingsState";
  values: SettingsValues;
};

export type SettingsWebviewToHost =
  | { type: "graphforge/ready" }
  | { type: "graphforge/updateSetting"; key: string; value: SettingValue };
