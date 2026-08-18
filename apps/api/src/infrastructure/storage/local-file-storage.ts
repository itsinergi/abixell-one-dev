import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Local-disk implementation of file storage for the Document/File Service
 * (Checkpoint 0E). Phase 0 implementation-environment simplification —
 * doc 06/09 describe object storage with at-rest encryption for a real
 * deployment; no such infra exists in this workspace yet, so files land
 * under `FILE_STORAGE_ROOT` (default `./storage/documents`) namespaced by
 * Tenant. This is swappable later (an S3-backed implementation of the
 * same `save`/`read` shape) without touching `DocumentService` or the
 * `documents` table, which store a storage-agnostic `storagePath`.
 */
export class LocalFileStorage {
  private readonly root: string;

  constructor(root = process.env.FILE_STORAGE_ROOT ?? "./storage/documents") {
    this.root = root;
  }

  /** Saves a file under a per-tenant, content-addressed-ish path and
   * returns the relative storage path + a SHA-256 checksum. */
  async save(tenantId: string, fileName: string, buffer: Buffer): Promise<{ storagePath: string; checksum: string }> {
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const safeName = fileName.replace(/[^\w.\-]/g, "_");
    const relativePath = join(tenantId, `${randomUUID()}-${safeName}`);
    const absolutePath = join(this.root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return { storagePath: relativePath, checksum };
  }

  async read(storagePath: string): Promise<Buffer> {
    return readFile(join(this.root, storagePath));
  }
}
