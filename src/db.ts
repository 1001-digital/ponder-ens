const INIT_SQL = `
  CREATE SCHEMA IF NOT EXISTS offchain;
  CREATE TABLE IF NOT EXISTS offchain.ens_profile (
    address TEXT PRIMARY KEY,
    ens TEXT,
    data JSON,
    updated_at INTEGER NOT NULL
  );
`;

export async function createOffchainDb(options?: {
  databaseUrl?: string;
  dataDir?: string;
}): Promise<{ db: any }> {
  const databaseUrl =
    options?.databaseUrl ??
    process.env.DATABASE_PRIVATE_URL ??
    process.env.DATABASE_URL;

  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query(INIT_SQL);
    return { db: drizzle(pool) };
  }

  const dataDir = options?.dataDir ?? ".ponder/ens";
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dataDir);
  await client.exec(INIT_SQL);
  return { db: drizzle(client) };
}
