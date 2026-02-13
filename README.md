# @1001-digital/ponder-ens

Reusable ENS profile resolution and caching for [Ponder](https://ponder.sh) indexers. Provides a drizzle-managed offchain table, on-demand ENS lookups via viem, 30-day cache TTL, and ready-to-mount Hono API routes.

## Install

```bash
pnpm add @1001-digital/ponder-ens
```

Peer dependencies (your ponder app should already have these):

```bash
pnpm add drizzle-orm hono viem
```

For migrations you also need drizzle-kit and pg:

```bash
pnpm add -D drizzle-kit
pnpm add pg
```

## Setup

### 1. Offchain schema

Create an `offchain.schema.ts` at your indexer root. Re-export the `ensProfile` table (and add any other offchain tables your app needs):

```typescript
// offchain.schema.ts
export { ensProfile } from "@1001-digital/ponder-ens";
```

### 2. Drizzle config

Create a `drizzle.config.ts` for the offchain schema:

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./offchain.schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ["offchain"],
});
```

### 3. Database service

Create a service that provides a drizzle instance targeting the `offchain` schema:

```typescript
// src/services/database.ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as offchainSchema from "../../offchain.schema";

export type OffchainDb = NodePgDatabase<typeof offchainSchema>;

let offchainDb: OffchainDb | null = null;
let offchainPool: pg.Pool | null = null;

export function getOffchainDb(): OffchainDb {
  if (!offchainDb) {
    offchainPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      options: "-c search_path=offchain",
    });
    offchainDb = drizzle(offchainPool, { schema: offchainSchema });
  }
  return offchainDb;
}
```

### 4. Run migrations

Generate and apply the migration for the `ens_profile` table:

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

### 5. Mount routes

In your ponder API file, mount the ENS routes:

```typescript
// src/api/index.ts
import { db, publicClients } from "ponder:api";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import schema from "ponder:schema";
import { createEnsRoutes } from "@1001-digital/ponder-ens";
import { getOffchainDb } from "../services/database";

const app = new Hono();

app.route(
  "/profiles",
  createEnsRoutes({
    client: publicClients["ethereum"],
    db,
    writeDb: getOffchainDb,
  }),
);

app.use("/sql/*", client({ db, schema }));
app.use("/", graphql({ db, schema }));

export default app;
```

This gives you:
- `GET /profiles/:id` — returns cached profile, refreshes if stale (>30 days)
- `POST /profiles/:id` — force refresh, always fetches from ENS

The `:id` parameter accepts either an Ethereum address or an ENS name.

## Using the service directly

If you need profile resolution outside of the API routes (e.g. in event handlers or CLI scripts), use `createEnsService`:

```typescript
import { createEnsService } from "@1001-digital/ponder-ens";

const ens = createEnsService({
  client: publicClients["ethereum"],
  db,
  writeDb: getOffchainDb,
});

// Resolve an identifier (address or ENS name)
const result = await ens.resolveProfile("vitalik.eth");
// { address: "0xd8da...", ensName: "vitalik.eth", cachedProfile: ..., isFresh: true }

// Fetch a cached profile
const profile = await ens.fetchProfile("0xd8da...");

// Force update a profile
await ens.updateProfile("0xd8da..." as `0x${string}`, "vitalik.eth");
```

## Cross-schema relations (optional)

To make ENS profiles queryable via ponder's GraphQL API alongside your onchain tables, create a combined schema with relations:

```typescript
// combined.schema.ts
import { relations } from "drizzle-orm";
import * as ponderSchema from "./ponder.schema";
import * as offchainSchema from "./offchain.schema";

export const ensProfileRelations = relations(
  offchainSchema.ensProfile,
  ({ one }) => ({
    account: one(ponderSchema.account, {
      fields: [offchainSchema.ensProfile.address],
      references: [ponderSchema.account.address],
    }),
  }),
);

export const schema = {
  ...ponderSchema,
  ...offchainSchema,
  ensProfileRelations,
};
```

Then pass the combined schema to ponder's graphql/client middleware instead.

## Configuration

`createEnsRoutes` and `createEnsService` accept the same config:

| Option | Type | Description |
|--------|------|-------------|
| `client` | viem `PublicClient` | Client with ENS support (must reach mainnet ENS registry) |
| `db` | drizzle instance | For reading profiles (e.g. `db` from `ponder:api`) |
| `writeDb` | drizzle instance or `() => instance` | For writing profiles (offchain schema). Accepts a factory function for lazy init. |
| `cacheTtl` | `number` (ms) | Cache freshness window. Defaults to 30 days. |

## Profile data

Each cached profile stores:

```typescript
{
  address: string;        // Lowercase ethereum address (primary key)
  ens: string | null;     // ENS name
  data: {
    avatar: string;       // ENS avatar URL
    header: string;       // ENS header text record
    description: string;  // ENS description
    links: {
      url: string;        // Website (url text record)
      email: string;      // Email (email text record)
      twitter: string;    // Twitter (com.twitter text record)
      github: string;     // GitHub (com.github text record)
    };
  };
  updatedAt: number;      // Unix timestamp (seconds)
}
```

## Ponder config note

Your `ponder.config.ts` needs an Ethereum mainnet chain entry for ENS resolution to work (ponder provides `publicClients` based on configured chains):

```typescript
export default createConfig({
  chains: {
    ethereum: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
    // ... your other chains
  },
  // ...
});
```
