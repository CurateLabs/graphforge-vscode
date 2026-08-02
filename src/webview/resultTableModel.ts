import type {
  GraphEdge,
  GraphNode,
  GraphPayload,
  QueryResult,
  TableRow,
} from "../session/types";
import type { GraphSelection } from "./resultGraphModel";
import type {
  EntityInspectSelection,
  ResultEntityLink,
} from "./protocol";

export interface GraphElementHighlight {
  nodeIds: string[];
  edgeIds: string[];
}

const IDENTITY_KEY =
  /(^|_)(id|uuid|code)$|^(node|edge|source|target|start|end)(Id|Uuid)?$/i;
const EDGE_IDENTITY_KEY =
  /(^|_)(edge|relationship|rel)(_|$)|^edge(Id|Uuid)?$/i;

function scalarKey(value: unknown): string | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    const key = String(value).trim();
    return key || undefined;
  }
  return undefined;
}

function identityKeys(value: unknown, key?: string): Set<string> {
  const keys = new Set<string>();
  const scalar = scalarKey(value);
  if (scalar) {
    keys.add(scalar);
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      for (const itemKey of identityKeys(item)) {
        keys.add(itemKey);
      }
    }
    return keys;
  }
  if (!value || typeof value !== "object") {
    return keys;
  }
  for (const [property, propertyValue] of Object.entries(value)) {
    if (IDENTITY_KEY.test(property) || key === undefined) {
      for (const propertyKey of identityKeys(propertyValue, property)) {
        keys.add(propertyKey);
      }
    }
  }
  return keys;
}

function nodeAliases(node: GraphNode): Set<string> {
  const aliases = new Set([node.id]);
  for (const [key, value] of Object.entries(node.properties)) {
    if (IDENTITY_KEY.test(key)) {
      const alias = scalarKey(value);
      if (alias) aliases.add(alias);
    }
  }
  return aliases;
}

function edgeAliases(edge: GraphEdge): Set<string> {
  const aliases = new Set([edge.id]);
  for (const [key, value] of Object.entries(edge.properties ?? {})) {
    if (IDENTITY_KEY.test(key)) {
      const alias = scalarKey(value);
      if (alias) aliases.add(alias);
    }
  }
  return aliases;
}

function matchesAny(aliases: Set<string>, keys: Set<string>): boolean {
  for (const key of keys) {
    if (aliases.has(key)) return true;
  }
  return false;
}

interface GraphLookup {
  nodeIdsByAlias: Map<string, string[]>;
  edgeIdsByAlias: Map<string, string[]>;
  edgeIdsByEndpoints: Map<string, string[]>;
}

function append(map: Map<string, string[]>, key: string, id: string): void {
  const values = map.get(key);
  if (values) {
    if (!values.includes(id)) values.push(id);
  } else {
    map.set(key, [id]);
  }
}

function endpointKey(source: string, target: string): string {
  return `${source.length}:${source}${target}`;
}

function buildGraphLookup(payload: GraphPayload): GraphLookup {
  const lookup: GraphLookup = {
    nodeIdsByAlias: new Map(),
    edgeIdsByAlias: new Map(),
    edgeIdsByEndpoints: new Map(),
  };
  for (const node of payload.nodes) {
    for (const alias of nodeAliases(node)) {
      append(lookup.nodeIdsByAlias, alias, node.id);
    }
  }
  for (const edge of payload.edges) {
    for (const alias of edgeAliases(edge)) {
      append(lookup.edgeIdsByAlias, alias, edge.id);
    }
    append(lookup.edgeIdsByEndpoints, endpointKey(edge.source, edge.target), edge.id);
  }
  return lookup;
}

function resolveKeysFromLookup(
  lookup: GraphLookup,
  keys: Set<string>,
): GraphElementHighlight {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const key of keys) {
    lookup.nodeIdsByAlias.get(key)?.forEach((id) => nodeIds.add(id));
    lookup.edgeIdsByAlias.get(key)?.forEach((id) => edgeIds.add(id));
  }
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds] };
}

function rowEndpoints(row: TableRow): { source?: string; target?: string } {
  return {
    source:
      scalarKey(row.source) ??
      scalarKey(row.start_uuid) ??
      scalarKey(row.node1_uuid),
    target:
      scalarKey(row.target) ??
      scalarKey(row.end_uuid) ??
      scalarKey(row.node2_uuid),
  };
}

function resolveKeys(
  payload: GraphPayload,
  keys: Set<string>,
): GraphElementHighlight {
  return resolveKeysFromLookup(buildGraphLookup(payload), keys);
}

function hasHighlight(highlight: GraphElementHighlight): boolean {
  return highlight.nodeIds.length > 0 || highlight.edgeIds.length > 0;
}

/**
 * A cell first resolves as its own graph identity. If it is a metric or other
 * non-identity value, the containing row becomes the fallback selection.
 */
export function resolveResultGraphHighlight(
  result: QueryResult,
  payload: GraphPayload | undefined,
  rowIndex: number,
  column?: string,
): GraphElementHighlight {
  const row = result.rows[rowIndex];
  if (!payload || !row) {
    return { nodeIds: [], edgeIds: [] };
  }

  if (column && Object.hasOwn(row, column)) {
    const direct = resolveKeys(payload, identityKeys(row[column]));
    if (hasHighlight(direct)) return direct;
  }

  const rowHighlight = resolveKeys(payload, identityKeys(row));
  const { source, target } = rowEndpoints(row);
  if (source && target) {
    for (const edge of payload.edges) {
      if (edge.source === source && edge.target === target) {
        rowHighlight.edgeIds.push(edge.id);
        rowHighlight.nodeIds.push(edge.source, edge.target);
      }
    }
  }
  return {
    nodeIds: [...new Set(rowHighlight.nodeIds)],
    edgeIds: [...new Set(rowHighlight.edgeIds)],
  };
}

function linkLabel(column: string, kind: ResultEntityLink["kind"]): string {
  const normalized = column
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
  return normalized || (kind === "node" ? "Node" : "Edge");
}

/** Entity Inspect affordances for one row, including endpoint and relationship links. */
export function resultEntityLinks(
  result: QueryResult,
  payload: GraphPayload | undefined,
  rowIndex: number,
): ResultEntityLink[] {
  return resultEntityLinksWithLookup(result, payload, rowIndex, payload && buildGraphLookup(payload));
}

function resultEntityLinksWithLookup(
  result: QueryResult,
  payload: GraphPayload | undefined,
  rowIndex: number,
  lookup: GraphLookup | undefined,
): ResultEntityLink[] {
  const row = result.rows[rowIndex];
  if (!payload || !row || !lookup) return [];

  const links: ResultEntityLink[] = [];
  const seen = new Set<string>();
  const add = (kind: ResultEntityLink["kind"], id: string, label: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ kind, id, label });
  };

  const columns = [
    ...result.columns,
    ...Object.keys(row).filter((column) => !result.columns.includes(column)),
  ];
  for (const column of columns) {
    const direct = resolveKeysFromLookup(lookup, identityKeys(row[column]));
    if (EDGE_IDENTITY_KEY.test(column)) {
      direct.edgeIds.forEach((id) => add("edge", id, linkLabel(column, "edge")));
    } else {
      direct.nodeIds.forEach((id) => add("node", id, linkLabel(column, "node")));
    }
  }

  const { source, target } = rowEndpoints(row);
  if (source && target) {
    lookup.edgeIdsByEndpoints
      .get(endpointKey(source, target))
      ?.forEach((id) => add("edge", id, "Edge"));
  }
  return links;
}

export function resultEntityLinksByRow(
  result: QueryResult,
  payload: GraphPayload | undefined,
): Record<string, ResultEntityLink[]> {
  const links: Record<string, ResultEntityLink[]> = {};
  const lookup = payload && buildGraphLookup(payload);
  for (let index = 0; index < result.rows.length; index += 1) {
    const rowLinks = resultEntityLinksWithLookup(result, payload, index, lookup);
    if (rowLinks.length > 0) links[String(index)] = rowLinks;
  }
  return links;
}

export function resolveResultEntitySelection(
  payload: GraphPayload | undefined,
  kind: EntityInspectSelection["kind"],
  id: string,
): EntityInspectSelection | undefined {
  if (!payload) return undefined;
  if (kind === "node") {
    const item = payload.nodes.find((node) => node.id === id);
    return item ? { kind, item } : undefined;
  }
  const item = payload.edges.find((edge) => edge.id === id);
  return item ? { kind, item } : undefined;
}

/** Find result rows represented by a graph selection for reverse linking. */
export function resultRowsForGraphSelection(
  result: QueryResult,
  selection: GraphSelection,
): number[] {
  const rows: number[] = [];
  const itemKeys =
    selection.kind === "node"
      ? nodeAliases(selection.item)
      : edgeAliases(selection.item);

  for (const [index, row] of result.rows.entries()) {
    const rowKeys = identityKeys(row);
    let matches = matchesAny(itemKeys, rowKeys);
    if (!matches && selection.kind === "edge") {
      const endpoints = rowEndpoints(row);
      matches =
        endpoints.source === selection.item.source &&
        endpoints.target === selection.item.target;
    }
    if (matches) rows.push(index);
  }
  return rows;
}

/** Webview messages cannot carry bigint values; keep the table JSON-safe. */
export function jsonSafeQueryResult(result: QueryResult): QueryResult {
  return JSON.parse(
    JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ) as QueryResult;
}
