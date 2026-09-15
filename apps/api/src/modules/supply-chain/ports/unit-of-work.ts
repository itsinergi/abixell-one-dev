import type { Pool, PoolClient } from "pg";

/**
 * Unit of Work interface for managing atomic multi-statement database transactions
 * across Supply Chain bounded contexts (WMS, Procurement, Master Data).
 */
export interface IUnitOfWork {
  runInTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export class PgUnitOfWork implements IUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async runInTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
