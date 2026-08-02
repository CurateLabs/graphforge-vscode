import type {
  EntityInspectSelection,
  HostToWebview,
  WebviewToHost,
} from "../../../src/webview/protocol";
import { nodeLabel } from "../../../src/webview/resultGraphModel";
import "./entityInspect.css";

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");
let currentSelection: EntityInspectSelection | undefined;
let editing = false;
let saving = false;
let statusMessage = "";
let statusTone: "saved" | "error" | "" = "";
let draftPropertiesText = "";

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendBadge(root: HTMLElement, text: string, tone = ""): void {
  root.append(element("span", `badge${tone ? ` ${tone}` : ""}`, text));
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function compactValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const count = Object.keys(value).length;
    return `${count} field${count === 1 ? "" : "s"}`;
  }
  return String(value);
}

function appendPropertyValue(root: HTMLElement, value: unknown): void {
  if (value === null || value === undefined) {
    root.append(element("span", "property-value missing", value === null ? "null" : "—"));
    return;
  }
  if (typeof value !== "object") {
    root.append(
      element("span", `property-value value-${typeof value}`, String(value)),
    );
    return;
  }

  const details = element("details", "structured-value");
  details.append(element("summary", undefined, compactValue(value)));
  details.append(element("pre", undefined, JSON.stringify(value, null, 2)));
  root.append(details);
}

function propertiesOf(selection: EntityInspectSelection): Record<string, unknown> {
  return selection.item.properties ?? {};
}

function renderProperties(selection: EntityInspectSelection): HTMLElement {
  const section = element("section", "properties-section");
  const heading = element("div", "section-heading");
  heading.append(element("h2", undefined, "Properties"));
  const entries = Object.entries(propertiesOf(selection)).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  heading.append(
    element(
      "span",
      "count",
      `${entries.length} ${entries.length === 1 ? "property" : "properties"}`,
    ),
  );
  section.append(heading);

  if (entries.length === 0) {
    section.append(element("p", "no-properties", "This entity has no properties."));
    return section;
  }

  const list = element("dl", "property-list");
  for (const [key, value] of entries) {
    const row = element("div", "property-row");
    const term = element("dt");
    term.append(element("span", "property-name", key));
    term.append(element("span", "property-type", valueKind(value)));
    const description = element("dd");
    appendPropertyValue(description, value);
    row.append(term, description);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderNodeIdentity(selection: Extract<EntityInspectSelection, { kind: "node" }>): HTMLElement {
  const identity = element("section", "identity-card");
  const badges = element("div", "badges");
  for (const label of selection.item.labels) {
    appendBadge(badges, label);
  }
  if (selection.item.ontologyType) {
    appendBadge(badges, selection.item.ontologyType, "ontology");
  }
  if (selection.item.epistemicStatus) {
    appendBadge(badges, selection.item.epistemicStatus, "status");
  }
  if (badges.childElementCount === 0) {
    appendBadge(badges, "Unlabelled");
  }
  identity.append(badges);
  return identity;
}

function renderEdgeIdentity(selection: Extract<EntityInspectSelection, { kind: "edge" }>): HTMLElement {
  const identity = element("section", "identity-card edge-identity");
  const route = element("div", "edge-route");
  const source = element("div", "endpoint");
  source.append(element("span", "endpoint-label", "Source"));
  source.append(element("code", undefined, selection.item.source));
  const relation = element("div", "relation");
  relation.append(element("span", "relation-line"));
  relation.append(element("strong", undefined, selection.item.type));
  relation.append(element("span", "relation-arrow", "→"));
  const target = element("div", "endpoint target");
  target.append(element("span", "endpoint-label", "Target"));
  target.append(element("code", undefined, selection.item.target));
  route.append(source, relation, target);
  identity.append(route);
  if (selection.item.epistemicStatus) {
    const badges = element("div", "badges edge-badges");
    appendBadge(badges, selection.item.epistemicStatus, "status");
    identity.append(badges);
  }
  return identity;
}

function renderPropertyEditor(selection: EntityInspectSelection): HTMLElement {
  const section = element("section", "properties-section edit-section");
  const heading = element("div", "section-heading");
  heading.append(element("h2", undefined, "Edit properties"));
  heading.append(element("span", "count", "JSON object"));
  section.append(heading);
  section.append(
    element(
      "p",
      "edit-help",
      "Change values, add keys, or remove keys. Values may be JSON scalars or arrays of scalars. IDs, endpoints, relationship type, and labels stay read-only.",
    ),
  );

  const textarea = element("textarea", "property-editor");
  textarea.id = "property-editor";
  textarea.spellcheck = false;
  textarea.value =
    draftPropertiesText || JSON.stringify(propertiesOf(selection), null, 2);
  textarea.setAttribute("aria-label", "Entity properties JSON");
  textarea.addEventListener("input", () => {
    draftPropertiesText = textarea.value;
  });
  section.append(textarea);

  const validation = element("p", "validation", "");
  validation.id = "validation";
  validation.setAttribute("role", "alert");
  section.append(validation);

  const actions = element("div", "edit-actions");
  const save = element("button", "primary", saving ? "Saving…" : "Save");
  save.type = "button";
  save.disabled = saving;
  save.addEventListener("click", () => {
    try {
      draftPropertiesText = textarea.value;
      const parsed: unknown = JSON.parse(textarea.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Properties must be a JSON object.");
      }
      validation.textContent = "";
      saving = true;
      save.disabled = true;
      save.textContent = "Saving…";
      post({
        type: "graphforge/saveEntityEdit",
        kind: selection.kind,
        id: selection.item.id,
        properties: parsed as Record<string, unknown>,
      });
    } catch (error) {
      validation.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
  const cancel = element("button", undefined, "Cancel");
  cancel.type = "button";
  cancel.disabled = saving;
  cancel.addEventListener("click", () => {
    editing = false;
    draftPropertiesText = "";
    statusMessage = "";
    statusTone = "";
    render(selection);
  });
  actions.append(save, cancel);
  section.append(actions);
  return section;
}

function render(selection: EntityInspectSelection): void {
  if (!app) return;
  const fragment = document.createDocumentFragment();
  const header = element("header");
  const titleRow = element("div", "title-row");
  const titleCopy = element("div", "title-copy");
  const kindLabel = selection.kind === "node" ? "Node" : "Edge";
  titleCopy.append(element("p", "eyebrow", kindLabel));
  titleCopy.append(
    element(
      "h1",
      undefined,
      selection.kind === "node" ? nodeLabel(selection.item) : selection.item.type,
    ),
  );
  const edit = element("button", "edit-toggle", editing ? "Editing" : "Edit");
  edit.type = "button";
  edit.disabled = editing || saving;
  edit.setAttribute("aria-pressed", String(editing));
  edit.addEventListener("click", () => {
    editing = true;
    draftPropertiesText = JSON.stringify(propertiesOf(selection), null, 2);
    statusMessage = "";
    statusTone = "";
    render(selection);
  });
  titleRow.append(titleCopy, edit);
  header.append(titleRow);
  const idLine = element("p", "entity-id");
  idLine.append(element("span", undefined, "ID"));
  idLine.append(element("code", undefined, selection.item.id));
  header.append(idLine);
  fragment.append(header);
  const status = element(
    "p",
    `edit-status${statusTone ? ` ${statusTone}` : ""}`,
    statusMessage,
  );
  status.id = "edit-status";
  status.hidden = !statusMessage;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  fragment.append(status);

  fragment.append(
    selection.kind === "node"
      ? renderNodeIdentity(selection)
      : renderEdgeIdentity(selection),
  );
  fragment.append(
    editing ? renderPropertyEditor(selection) : renderProperties(selection),
  );

  if (!editing) {
    const raw = element("details", "raw-json");
    raw.append(element("summary", undefined, "JSON"));
    raw.append(element("pre", undefined, JSON.stringify(selection.item, null, 2)));
    fragment.append(raw);
  }
  fragment.append(
    element(
      "footer",
      undefined,
      "Shift-click a graph or Results-table entity to open another inspect tab for comparison.",
    ),
  );
  app.replaceChildren(fragment);
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (message?.type === "graphforge/entityInspect") {
    currentSelection = message.selection;
    editing = false;
    saving = false;
    draftPropertiesText = "";
    statusMessage = "";
    statusTone = "";
    render(message.selection);
  } else if (message?.type === "graphforge/entityEditState") {
    saving = message.state === "saving";
    statusMessage = message.message;
    statusTone =
      message.state === "error"
        ? "error"
        : message.state === "saved"
          ? "saved"
          : "";
    if (message.state === "saved") {
      editing = false;
      draftPropertiesText = "";
    }
    if (currentSelection) render(currentSelection);
  }
});

post({ type: "graphforge/ready" });
