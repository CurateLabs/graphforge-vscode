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

export type SettingValue = string | boolean;

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
  type: "boolean" | "string" | "enum";
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
            description: "Always use @graphforge/node. Never falls back to Python.",
          },
          {
            value: "python",
            label: "Python only",
            description: "Always use the Python graphforge bridge. Never falls back to Node.",
          },
        ],
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
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    blurb: "Manual paths — leave these empty unless auto-detection can't find your runtime.",
    settings: [
      {
        key: "nativeModulePath",
        label: "Node binding path",
        description:
          "Absolute path to a built @graphforge/node package (the directory containing index.js). Leave empty to resolve from node_modules or a sibling checkout.",
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
