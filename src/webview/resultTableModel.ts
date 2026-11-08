import { RESULT_PAGE_SIZE, queryResultPage, resultRow, type ResultPage } from "../session/resultRows";
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
  ResultMessageContext,
} from "./protocol";

export interface GraphElementHighlight {
  nodeIds: string[];
  edgeIds: string[];
}

export const RESULT_INSPECT_BYTES = 256 * 1024;
export const RESULT_INSPECT_NOTICE = "Inspect links are unavailable for this page. Open the saved JSON or Markdown document to inspect its entities.";
function inspectLimit(): Error { return new Error(`RESULT_INSPECT_LIMIT: ${RESULT_INSPECT_NOTICE}`); }

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
  nodeIdsByAlias: Map<string, Set<string>>;
  edgeIdsByAlias: Map<string, Set<string>>;
  edgeIdsByEndpoints: Map<string, Set<string>>;
}

function append(map: Map<string, Set<string>>, key: string, id: string): void {
  let values = map.get(key);
  if (!values) map.set(key, values = new Set());
  values.add(id);
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
  maxMatches = Infinity,
): GraphElementHighlight {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const key of keys) {
    const add = (set: Set<string>, id: string) => {
      if (!set.has(id) && nodeIds.size + edgeIds.size >= maxMatches) throw inspectLimit();
      set.add(id);
    };
    lookup.nodeIdsByAlias.get(key)?.forEach((id) => add(nodeIds, id));
    lookup.edgeIdsByAlias.get(key)?.forEach((id) => add(edgeIds, id));
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
  const row = resultRow(result, rowIndex);
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

/** Canonical relationship identity is independent of the user's Cypher alias. */
function canonicalEdgeIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) { current.forEach(visit); return; }
    const item = current as Record<string, unknown>;
    if (typeof item.edge_uuid === "string" && typeof item.src_uuid === "string" && typeof item.dst_uuid === "string") {
      ids.add(item.edge_uuid);
    } else Object.values(item).forEach(visit);
  };
  visit(value);
  return ids;
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
  maxLinks = Infinity,
): ResultEntityLink[] {
  const row = resultRow(result, rowIndex);
  if (!payload || !row || !lookup) return [];

  const links: ResultEntityLink[] = [];
  const seen = new Set<string>();
  const add = (kind: ResultEntityLink["kind"], id: string, label: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    if (links.length >= maxLinks) throw inspectLimit();
    seen.add(key);
    links.push({ kind, id, label });
  };

  const columns = [
    ...result.columns,
    ...Object.keys(row).filter((column) => !result.columns.includes(column)),
  ];
  for (const column of columns) {
    const value = row[column];
    const direct = resolveKeysFromLookup(lookup, identityKeys(value), maxLinks);
    if (value && typeof value === "object") {
      for (const edgeId of canonicalEdgeIds(value)) {
        lookup.edgeIdsByAlias.get(edgeId)?.forEach(id => add("edge", id, linkLabel(column, "edge")));
      }
    }
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
  rowOffset = 0,
  bounded = false,
): Record<string, ResultEntityLink[]> {
  if (bounded && payload && (payload.nodes.length + payload.edges.length > 4096 ||
      Buffer.byteLength(JSON.stringify(payload)) > RESULT_INSPECT_BYTES)) throw inspectLimit();
  const links: Record<string, ResultEntityLink[]> = {};
  let count = 0;
  let bytes = 2;
  const lookup = payload && buildGraphLookup(payload);
  for (let index = 0; index < result.rows.length; index += 1) {
    const rowLinks = resultEntityLinksWithLookup(result, payload, index, lookup, bounded ? 32 : Infinity);
    if (rowLinks.length > 0) {
      count += rowLinks.length;
      const key = String(rowOffset + index);
      if (bounded) {
        bytes += Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(rowLinks)) + 2;
        if (count > 4000 || bytes > RESULT_INSPECT_BYTES) throw inspectLimit();
      }
      links[key] = rowLinks;
    }
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

function graphSelectionMatchesRow(selection: GraphSelection): (row: TableRow) => boolean {
  const keys = selection.kind === "node" ? nodeAliases(selection.item) : edgeAliases(selection.item);
  return (row: TableRow): boolean => {
    if (matchesAny(keys, identityKeys(row))) return true;
    if (selection.kind !== "edge") return false;
    const endpoints = rowEndpoints(row);
    return endpoints.source === selection.item.source && endpoints.target === selection.item.target;
  };
}

/** Find result rows represented by a graph selection for reverse linking. */
export function resultRowsForGraphSelection(
  result: QueryResult,
  selection: GraphSelection,
  nativeRows?: readonly number[],
): number[] {
  if (nativeRows !== undefined)
    return [...new Set(nativeRows.filter(row => Number.isSafeInteger(row) && row >= 0 && row < result.rowCount))];
  const matches = graphSelectionMatchesRow(selection);
  const rows: number[] = [];
  for (const [index, row] of result.rows.entries()) {
    if (matches(row)) rows.push(index);
  }
  return rows;
}

/** Plain base-graph picks have no native layer membership. Read source rows on
 * demand in yielding batches; retain only matching indices, never a full row copy.
 * Undefined means a newer selection or project replaced this scan.
 */
export async function resultRowsForGraphSelectionBatched(
  result: QueryResult,
  selection: GraphSelection,
  isCurrent: () => boolean,
): Promise<number[] | undefined> {
  const matches = graphSelectionMatchesRow(selection);
  const rows: number[] = [];
  for (let start = 0; start < result.rowCount; start += RESULT_PAGE_SIZE) {
    if (!isCurrent()) return undefined;
    for (let index = start; index < Math.min(start + RESULT_PAGE_SIZE, result.rowCount); index++) {
      const row = resultRow(result, index);
      if (row && matches(row)) rows.push(index);
    }
    if (start + RESULT_PAGE_SIZE < result.rowCount) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return isCurrent() ? rows : undefined;
}

/** Compatibility helper: wire callers receive one bounded, JSON-safe page. */
export function jsonSafeQueryResult(result: QueryResult): ResultPage {
  return queryResultPage(result);
}

export function resultPageContainsRow(page: ResultPage, index: number): boolean {
  return Number.isSafeInteger(index) && index >= page.offset && index < page.offset + page.rows.length;
}

/** Preserve global source indices without sending off-page membership. */
export function resultPageSelection(page: ResultPage, selected: ReadonlySet<number>): number[] {
  const visible: number[] = [];
  for (let index = page.offset; index < page.offset + page.rows.length; index++) {
    if (selected.has(index)) visible.push(index);
  }
  return visible;
}

export function resultMessageMatches(message: unknown, current: ResultMessageContext): boolean {
  if (!message || typeof message !== "object") return false;
  const incoming = message as Partial<ResultMessageContext>;
  return typeof incoming.resultId === "string" && incoming.resultId === current.resultId &&
    Number.isSafeInteger(incoming.revision) && incoming.revision === current.revision &&
    Number.isSafeInteger(incoming.pageVersion) && incoming.pageVersion === current.pageVersion;
}
