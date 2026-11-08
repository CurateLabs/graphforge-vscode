/** Small publication pointer; the Arrow digest, not readable JSON rows, owns typed data. */
export const RESULT_METADATA_FORMAT = "graphforge.result/v1";
export const RESULT_METADATA_BYTES = 64 * 1024;
export const LEGACY_RESULT_BYTES = 4 * 1024 * 1024;
export function resultMetadataPath(jsonPath: string): string {
  return jsonPath.replace(/\.json$/i, ".resultmeta");
}
