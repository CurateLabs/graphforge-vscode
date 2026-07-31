import * as crypto from "node:crypto";

/**
 * Generate a UUIDv7 (RFC 9562): 48-bit big-endian Unix-ms timestamp followed by
 * version/variant bits and random fill. The knowledge ledger's identity UUIDs
 * (assertion/evidence/confidence/status-event) are rejected by the engine unless
 * they carry version 7, so the workbench must mint them client-side.
 */
export function uuidv7(): string {
  const unixTsMs = BigInt(Date.now());
  const rand = crypto.randomBytes(10);
  const bytes = Buffer.alloc(16);

  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);

  bytes[6] = 0x70 | (rand[0] & 0x0f); // version 7
  bytes[7] = rand[1];
  bytes[8] = 0x80 | (rand[2] & 0x3f); // variant 10
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Idempotency token for a single engine write call; any UUID version is accepted. */
export function randomOperationId(): string {
  return crypto.randomUUID();
}
