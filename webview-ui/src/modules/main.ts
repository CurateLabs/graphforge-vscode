import type {
  ModulesHostToWebview,
  ModulesWebviewToHost,
  ModuleViewModel,
} from "../../../src/modules/moduleProtocol";
import type { ModuleCapability } from "../../../src/modules/moduleManifest";
import "./modules.css";

const vscode = acquireVsCodeApi();
const root = document.querySelector<HTMLElement>("#app");
let modules: ModuleViewModel[] = [];
let filter: ModuleCapability | "all" = "all";

function post(message: ModulesWebviewToHost): void {
  vscode.postMessage(message);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

const CAPABILITY_LABEL: Record<ModuleCapability, string> = {
  query: "Query",
  visualize: "Visualize",
  import: "Import",
  integration: "Connect",
};

const SOURCE_LABEL: Record<ModuleViewModel["source"], string> = {
  "first-party": "Default module",
  graphforge: "GraphForge catalog",
  sideload: "Side-loaded",
};

function button(label: string, className: string, action: () => void): HTMLButtonElement {
  const result = el("button", { type: "button", class: className }, label);
  result.addEventListener("click", action);
  return result;
}

function moduleCard(module: ModuleViewModel): HTMLElement {
  const statusLabel =
    module.status === "active"
      ? "On"
      : module.status === "disabled"
        ? "Off"
        : module.status === "available"
          ? "Available"
          : module.status === "error"
            ? "Needs attention"
            : "Provider unavailable";
  const controls = el("div", { class: "module-controls" });
  if (!module.installed) {
    controls.append(
      button("Install", "button button-primary", () =>
        post({ type: "graphforge/install", id: module.id }),
      ),
    );
  } else {
    const toggle = el("input", {
      type: "checkbox",
      role: "switch",
      "aria-label": `${module.enabled ? "Disable" : "Enable"} ${module.name}`,
      ...(module.enabled ? { checked: "" } : {}),
    });
    toggle.checked = module.enabled;
    toggle.addEventListener("change", () =>
      post({
        type: "graphforge/toggleModule",
        id: module.id,
        enabled: toggle.checked,
      }),
    );
    controls.append(el("label", { class: "switch" }, toggle, el("span")));
    for (const action of module.actions) {
      controls.append(
        button(action.title, "button", () =>
          post({
            type: "graphforge/runModuleAction",
            id: module.id,
            command: action.command,
          }),
        ),
      );
    }
    if (module.removable) {
      controls.append(
        button("Remove", "button button-quiet", () =>
          post({ type: "graphforge/removeModule", id: module.id }),
        ),
      );
    }
    if (module.homepage) {
      controls.append(
        button("Learn more", "button button-quiet", () =>
          post({ type: "graphforge/openHomepage", id: module.id }),
        ),
      );
    }
  }

  const capabilities = el("div", { class: "capability-list" });
  for (const capability of module.capabilities) {
    capabilities.append(
      el(
        "span",
        { class: `capability capability-${capability}` },
        el("i", { "aria-hidden": "true" }),
        CAPABILITY_LABEL[capability],
      ),
    );
  }

  return el(
    "article",
    {
      class: `module-card status-${module.status}`,
      "data-module-id": module.id,
    },
    el(
      "div",
      { class: "module-route", "aria-hidden": "true" },
      ...module.capabilities.map((capability) =>
        el("span", { class: `route-dot capability-${capability}` }),
      ),
    ),
    el(
      "div",
      { class: "module-body" },
      el(
        "div",
        { class: "module-heading" },
        el(
          "div",
          {},
          el("h2", {}, module.name),
          el(
            "p",
            { class: "module-meta" },
            `${module.publisher} · ${SOURCE_LABEL[module.source]} · v${module.version}`,
          ),
        ),
        el("span", { class: "status-chip" }, statusLabel),
      ),
      el("p", { class: "module-description" }, module.description),
      capabilities,
      ...(module.error
        ? [el("p", { class: "module-error", role: "alert" }, module.error)]
        : []),
      controls,
    ),
  );
}

function render(): void {
  if (!root) return;
  root.replaceChildren();
  const active = modules.filter((module) => module.status === "active").length;
  const visible = modules.filter(
    (module) => filter === "all" || module.capabilities.includes(filter),
  );
  const filters = el("div", { class: "filters", "aria-label": "Filter modules" });
  const choices: Array<{ id: typeof filter; label: string }> = [
    { id: "all", label: "All" },
    { id: "query", label: "Query" },
    { id: "visualize", label: "Visualize" },
    { id: "import", label: "Import" },
    { id: "integration", label: "Connect" },
  ];
  for (const choice of choices) {
    const item = button(choice.label, "filter", () => {
      filter = choice.id;
      render();
    });
    item.setAttribute("aria-pressed", String(filter === choice.id));
    filters.append(item);
  }

  root.append(
    el(
      "header",
      { class: "header" },
      el(
        "div",
        { class: "header-copy" },
        el("p", { class: "eyebrow" }, "GraphForge workbench"),
        el("h1", {}, "Module bay"),
        el(
          "p",
          { class: "header-note" },
          "Choose which capabilities connect to your GraphForge workflow. Default, catalog, and side-loaded modules share one control surface.",
        ),
      ),
      el(
        "div",
        { class: "signal-count", "aria-label": `${active} active modules` },
        el("strong", {}, String(active).padStart(2, "0")),
        el("span", {}, "active"),
      ),
    ),
    el(
      "div",
      { class: "toolbar" },
      filters,
      button("Install from file…", "button button-primary", () =>
        post({ type: "graphforge/installFromFile" }),
      ),
    ),
    el(
      "main",
      { class: "module-grid" },
      ...(visible.length
        ? visible.map(moduleCard)
        : [
            el(
              "div",
              { class: "empty" },
              el("h2", {}, "No modules on this route"),
              el("p", {}, "Choose another capability or install a module manifest."),
            ),
          ]),
    ),
    el(
      "footer",
      { class: "footer" },
      "Side-loaded modules are declarative by default. Workspace scripts require a user-level dangerous opt-in, Workspace Trust, and explicit confirmation.",
    ),
  );
}

window.addEventListener("message", (event: MessageEvent<ModulesHostToWebview>) => {
  if (event.data?.type !== "graphforge/modulesState") return;
  modules = event.data.modules;
  render();
});

render();
post({ type: "graphforge/ready" });
