/**
 * GraphForge Settings webview app (#24) — Kilo-style left-nav categories over
 * the existing `graphforge.*` settings. All reads/writes round-trip through
 * the extension host (VS Code configuration API); this app is a friendlier
 * surface, not a second store.
 *
 * Accessibility notes (the Get Started audit flagged custom radio divs as a
 * P0 — this app avoids that class of bug from the start):
 * - Left nav is a vertical `role="tablist"` with arrow-key navigation.
 * - Enum settings render as native radio groups inside fieldset/legend.
 * - Booleans are native checkboxes, strings native text inputs, all with
 *   real <label> elements and aria-describedby descriptions.
 */
import {
  SETTINGS_CATEGORIES,
  type SettingDescriptor,
  type SettingsHostToWebview,
  type SettingsValues,
  type SettingsWebviewToHost,
} from "../../../src/webview/settingsSchema";
import "./settings.css";

const vscode = acquireVsCodeApi();

function post(message: SettingsWebviewToHost): void {
  vscode.postMessage(message);
}

function updateSetting(key: string, value: string | boolean | number): void {
  post({ type: "graphforge/updateSetting", key, value });
}

/* ------------------------------------------------------------------ */
/* Static DOM (built once from the schema; values applied on message)  */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function renderBooleanSetting(setting: SettingDescriptor): HTMLElement {
  const inputId = `setting-${setting.key}`;
  const descId = `${inputId}-desc`;
  const input = el("input", {
    type: "checkbox",
    id: inputId,
    "data-setting": setting.key,
    "aria-describedby": descId,
  });
  input.addEventListener("change", () => updateSetting(setting.key, input.checked));
  return el(
    "div",
    { class: "setting setting-boolean" },
    el(
      "div",
      { class: "setting-check-row" },
      input,
      el("label", { class: "setting-label", for: inputId }, setting.label),
    ),
    el("p", { class: "setting-description", id: descId }, setting.description),
  );
}

function renderEnumSetting(setting: SettingDescriptor): HTMLElement {
  const descId = `setting-${setting.key}-desc`;
  const fieldset = el(
    "fieldset",
    { class: "setting setting-enum", "aria-describedby": descId },
    el("legend", { class: "setting-label" }, setting.label),
    el("p", { class: "setting-description", id: descId }, setting.description),
  );
  for (const option of setting.options ?? []) {
    const optionId = `setting-${setting.key}-${option.value}`;
    const optionDescId = `${optionId}-desc`;
    const input = el("input", {
      type: "radio",
      id: optionId,
      name: `setting-${setting.key}`,
      value: option.value,
      "data-setting": setting.key,
      "aria-describedby": optionDescId,
    });
    input.addEventListener("change", () => {
      if (input.checked) {
        updateSetting(setting.key, option.value);
      }
    });
    fieldset.append(
      el(
        "div",
        { class: "setting-option" },
        input,
        el(
          "div",
          { class: "setting-option-text" },
          el("label", { class: "setting-option-label", for: optionId }, option.label),
          el("p", { class: "setting-description", id: optionDescId }, option.description),
        ),
      ),
    );
  }
  return fieldset;
}

function renderStringSetting(setting: SettingDescriptor): HTMLElement {
  const inputId = `setting-${setting.key}`;
  const descId = `${inputId}-desc`;
  const input = el("input", {
    type: "text",
    id: inputId,
    "data-setting": setting.key,
    "aria-describedby": descId,
    spellcheck: "false",
    ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
  });
  // Commit on change (blur/Enter), not per keystroke — half-typed paths
  // would otherwise thrash runtime re-resolution in the host.
  input.addEventListener("change", () => updateSetting(setting.key, input.value.trim()));
  return el(
    "div",
    { class: "setting setting-string" },
    el("label", { class: "setting-label", for: inputId }, setting.label),
    el("p", { class: "setting-description", id: descId }, setting.description),
    input,
  );
}

function renderNumberSetting(setting: SettingDescriptor): HTMLElement {
  const inputId = `setting-${setting.key}`;
  const descId = `${inputId}-desc`;
  const input = el("input", {
    type: "number",
    id: inputId,
    "data-setting": setting.key,
    "aria-describedby": descId,
    min: "1",
    step: "1",
  });
  input.addEventListener("change", () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      updateSetting(setting.key, Math.trunc(parsed));
    }
  });
  return el(
    "div",
    { class: "setting setting-number" },
    el("label", { class: "setting-label", for: inputId }, setting.label),
    el("p", { class: "setting-description", id: descId }, setting.description),
    input,
  );
}

function renderSetting(setting: SettingDescriptor): HTMLElement {
  switch (setting.type) {
    case "boolean":
      return renderBooleanSetting(setting);
    case "enum":
      return renderEnumSetting(setting);
    case "string":
      return renderStringSetting(setting);
    case "number":
      return renderNumberSetting(setting);
  }
}

interface Rendered {
  tabs: HTMLButtonElement[];
  panels: HTMLElement[];
}

function renderApp(root: HTMLElement): Rendered {
  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];

  const tablist = el("div", {
    class: "nav",
    role: "tablist",
    "aria-orientation": "vertical",
    "aria-label": "Settings categories",
  });
  const content = el("div", { class: "content" });

  SETTINGS_CATEGORIES.forEach((category, index) => {
    const tabId = `tab-${category.id}`;
    const panelId = `panel-${category.id}`;

    const tab = el(
      "button",
      {
        class: "nav-item",
        role: "tab",
        id: tabId,
        "aria-controls": panelId,
        "aria-selected": index === 0 ? "true" : "false",
        tabindex: index === 0 ? "0" : "-1",
      },
      category.label,
    );
    tabs.push(tab);
    tablist.append(tab);

    const panel = el(
      "section",
      {
        class: "panel",
        role: "tabpanel",
        id: panelId,
        "aria-labelledby": tabId,
        tabindex: "0",
      },
      el("h2", { class: "panel-title" }, category.label),
      el("p", { class: "panel-blurb" }, category.blurb),
      ...category.settings.map(renderSetting),
    );
    if (index !== 0) {
      panel.hidden = true;
    }
    panels.push(panel);
    content.append(panel);
  });

  const selectTab = (index: number, focus: boolean): void => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) {
      tabs[index].focus();
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index, true));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      let next: number | undefined;
      if (event.key === "ArrowDown") {
        next = index === last ? 0 : index + 1;
      } else if (event.key === "ArrowUp") {
        next = index === 0 ? last : index - 1;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = last;
      }
      if (next !== undefined) {
        event.preventDefault();
        selectTab(next, true);
      }
    });
  });

  root.append(
    el(
      "header",
      { class: "header" },
      el("h1", {}, "GraphForge Settings"),
      el(
        "p",
        { class: "header-note" },
        "A friendlier view over the same graphforge.* settings — changes apply immediately and stay in sync with the VS Code Settings UI.",
      ),
    ),
    el("div", { class: "layout" }, tablist, content),
  );

  return { tabs, panels };
}

/* ------------------------------------------------------------------ */
/* Value sync (host → controls)                                        */
/* ------------------------------------------------------------------ */

function applyValues(values: SettingsValues): void {
  for (const category of SETTINGS_CATEGORIES) {
    for (const setting of category.settings) {
      const value = values[setting.key] ?? setting.default;
      if (setting.type === "boolean") {
        const input = document.getElementById(`setting-${setting.key}`) as HTMLInputElement | null;
        if (input) {
          input.checked = value === true;
        }
      } else if (setting.type === "enum") {
        for (const option of setting.options ?? []) {
          const input = document.getElementById(
            `setting-${setting.key}-${option.value}`,
          ) as HTMLInputElement | null;
          if (input) {
            input.checked = option.value === value;
          }
        }
      } else {
        const input = document.getElementById(`setting-${setting.key}`) as HTMLInputElement | null;
        // Don't clobber a path the analyst is mid-typing when an unrelated
        // setting changes elsewhere and the host re-broadcasts state.
        if (input && document.activeElement !== input) {
          input.value = String(value);
        }
      }
    }
  }
}

const root = document.getElementById("app");
if (root) {
  renderApp(root);
}

window.addEventListener("message", (event: MessageEvent<SettingsHostToWebview>) => {
  const message = event.data;
  if (message && message.type === "graphforge/settingsState") {
    applyValues(message.values);
  }
});

post({ type: "graphforge/ready" });
