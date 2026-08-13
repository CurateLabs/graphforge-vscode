import type { EntityInspectSelection } from "./protocol";

export interface SerializedEntityMutation {
  cypher: string;
  properties: Record<string, unknown>;
  setKeys: string[];
  removedKeys: string[];
}

function identifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function stringLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function assertPropertyValue(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be a finite JSON number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (Array.isArray(item) || (item !== null && typeof item === "object")) {
        throw new Error(
          `${path}[${index}] must be a JSON scalar; nested arrays and objects are not valid graph properties.`,
        );
      }
      assertPropertyValue(item, `${path}[${index}]`);
    });
    return;
  }
  throw new Error(
    `${path} must be a JSON scalar or an array of scalars; nested objects are not valid graph properties.`,
  );
}

function cypherLiteral(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return stringLiteral(value);
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(cypherLiteral).join(", ")}]`;
  }
  throw new Error("Cannot serialize a non-JSON graph property.");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function endpointPredicate(variable: string, value: string): string {
  const literal = stringLiteral(value);
  return [
    `${variable}.id = ${literal}`,
    `${variable}.uuid = ${literal}`,
    `${variable}.node_uuid = ${literal}`,
    `${variable}.code = ${literal}`,
  ].join(" OR ");
}

function matchClause(selection: EntityInspectSelection): string[] {
  if (selection.kind === "node") {
    const identityField = ["node_uuid", "uuid", "id", "code"].find(
      (key) => String(selection.item.properties[key] ?? "") === selection.item.id,
    );
    return [
      "MATCH (entity)",
      `WHERE ${
        identityField
          ? `entity.${identifier(identityField)} = ${stringLiteral(selection.item.id)}`
          : endpointPredicate("entity", selection.item.id)
      }`,
    ];
  }
  const lines = [
    `MATCH (source)-[entity:${identifier(selection.item.type)}]->(target)`,
    `WHERE (${endpointPredicate("source", selection.item.source)})`,
    `  AND (${endpointPredicate("target", selection.item.target)})`,
  ];
  const identityField = ["edge_uuid", "uuid", "id"].find(
    (key) => String(selection.item.properties?.[key] ?? "") === selection.item.id,
  );
  if (identityField) {
    lines.push(
      `  AND entity.${identifier(identityField)} = ${stringLiteral(selection.item.id)}`,
    );
  }
  return lines;
}

/** Validate, diff, and serialize an inspect edit as standalone openCypher. */
export function serializeEntityMutation(
  selection: EntityInspectSelection,
  editedProperties: Record<string, unknown>,
): SerializedEntityMutation {
  if (
    !editedProperties ||
    typeof editedProperties !== "object" ||
    Array.isArray(editedProperties)
  ) {
    throw new Error("Properties must be a JSON object.");
  }
  for (const [key, value] of Object.entries(editedProperties)) {
    if (!key.trim()) {
      throw new Error("Property names cannot be empty.");
    }
    assertPropertyValue(value, `Properties.${key}`);
  }

  const original = selection.item.properties ?? {};
  const setKeys = Object.keys(editedProperties)
    .filter(
      (key) =>
        !Object.hasOwn(original, key) ||
        canonicalJson(original[key]) !== canonicalJson(editedProperties[key]),
    )
    .sort();
  const removedKeys = Object.keys(original)
    .filter((key) => !Object.hasOwn(editedProperties, key))
    .sort();
  if (setKeys.length === 0 && removedKeys.length === 0) {
    throw new Error("No property changes to save.");
  }

  const lines = matchClause(selection);
  if (setKeys.length > 0) {
    lines.push(
      `SET ${setKeys
        .map(
          (key) =>
            `entity.${identifier(key)} = ${cypherLiteral(editedProperties[key])}`,
        )
        .join(",\n    ")}`,
    );
  }
  if (removedKeys.length > 0) {
    lines.push(
      `REMOVE ${removedKeys
        .map((key) => `entity.${identifier(key)}`)
        .join(", ")}`,
    );
  }
  lines.push("RETURN count(entity) AS updated");

  return {
    cypher: `${lines.join("\n")};\n`,
    properties: JSON.parse(JSON.stringify(editedProperties)) as Record<
      string,
      unknown
    >,
    setKeys,
    removedKeys,
  };
}

export function withEditedProperties(
  selection: EntityInspectSelection,
  properties: Record<string, unknown>,
): EntityInspectSelection {
  return selection.kind === "node"
    ? { kind: "node", item: { ...selection.item, properties } }
    : { kind: "edge", item: { ...selection.item, properties } };
}
