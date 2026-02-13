# @1001-digital/ponder-ens

Reusable ENS profile resolution and caching for [Ponder](https://ponder.sh) indexers. Provides on-demand ENS lookups via viem, 30-day cache TTL, and ready-to-mount Hono API routes.

Works with both **PostgreSQL** and **PGlite** (Ponder's default embedded database) — no Postgres required for development.

## Why offchain?

Ponder rebuilds its onchain tables from scratch on every reindex. If you were to resolve ENS names inside your event handlers, every restart would re-fetch every profile from the ENS registry — hammering your RPC endpoint and slowing down reindexing dramatically.

This package sidesteps that entirely by storing ENS profiles in a **separate offchain table** that persists across reindexes. Profiles are resolved lazily on first request and cached with a 30-day TTL. No ENS calls happen during indexing.

Your frontend can query the `/ens/:id` endpoint to resolve ENS names for addresses (or addresses for ENS names). Responses are served from cache when fresh, so many concurrent requests for the same profile result in a single RPC lookup — not one per client.

## Install

```bash
pnpm add @1001-digital/ponder-ens
```

Peer dependencies (your ponder app should already have these):

```bash
pnpm add drizzle-orm hono viem
```

## Quick start

### 1. Add Ethereum mainnet to your ponder config

ENS resolution requires a mainnet RPC endpoint:

```typescript
// ponder.config.ts
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

### 2. Mount the routes

```typescript
// src/api/index.ts
import { db, publicClients } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { createEnsRoutes, createOffchainDb } from "@1001-digital/ponder-ens";

const { db: ensDb } = await createOffchainDb();

const app = new Hono();

app.route(
  "/ens",
  createEnsRoutes({
    client: publicClients["ethereum"],
    db: ensDb,
  }),
);

app.use("/sql/*", client({ db, schema }));
app.use("/", graphql({ db, schema }));

export default app;
```

That's it. You now have:
- `GET /profiles/:id` — returns cached profile, refreshes if stale (>30 days)
- `POST /profiles/:id` — force refresh, always fetches from ENS

The `:id` parameter accepts either an Ethereum address or an ENS name.

## How `createOffchainDb` works

`createOffchainDb()` auto-detects your database setup:

- **With `DATABASE_URL`** (or `DATABASE_PRIVATE_URL`): connects to PostgreSQL, creates the `offchain` schema and `ens_profile` table if they don't exist.
- **Without `DATABASE_URL`**: uses PGlite (Postgres-in-WASM), stores data in `.ponder/ens/` by default.

Both paths are fully Postgres-compatible — the same schema and queries work in either mode.

```typescript
// Auto-detect (recommended)
const { db } = await createOffchainDb();

// Explicit Postgres
const { db } = await createOffchainDb({ databaseUrl: "postgresql://..." });

// Explicit PGlite with custom directory
const { db } = await createOffchainDb({ dataDir: ".data/ens" });
```

## Using the service directly

For profile resolution outside of API routes (e.g. in scripts), use `createEnsService`:

```typescript
import { createEnsService, createOffchainDb } from "@1001-digital/ponder-ens";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });
const { db } = await createOffchainDb();

const ens = createEnsService({ client, db });

const result = await ens.resolveProfile("vitalik.eth");
// { address: "0xd8da...", ensName: "vitalik.eth", cachedProfile: ..., isFresh: true }

const profile = await ens.fetchProfile("0xd8da...");

await ens.updateProfile("0xd8da..." as `0x${string}`, "vitalik.eth");
```

## Bring your own database

If you manage your own offchain database (e.g. with drizzle-kit migrations), skip `createOffchainDb` and pass your drizzle instance directly:

```typescript
import { createEnsRoutes } from "@1001-digital/ponder-ens";
import { getOffchainDb } from "./services/database";

app.route(
  "/ens",
  createEnsRoutes({
    client: publicClients["ethereum"],
    db: getOffchainDb(),
  }),
);
```

The package exports the schema for your drizzle config:

```typescript
// offchain.schema.ts
export { ensProfile } from "@1001-digital/ponder-ens";
```

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./offchain.schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ["offchain"],
});
```

Then generate and run migrations:

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

## Cross-schema relations (optional)

To make ENS profiles queryable via Ponder's GraphQL API alongside your onchain tables:

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

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `client` | viem `PublicClient` | Client with ENS support (must reach mainnet ENS registry) |
| `db` | drizzle instance | For reading and writing profiles. Use `createOffchainDb()` or bring your own. |
| `cacheTtl` | `number` (ms) | Cache freshness window. Defaults to 30 days. |

## Profile data

Each cached profile stores:

```typescript
{
  address: string;        // Lowercase Ethereum address (primary key)
  ens: string | null;     // ENS name
  data: {
    avatar: string;       // ENS avatar URL
    header: string;       // ENS header text record
    description: string;  // ENS description
    links: {
      url: string;        // url text record
      email: string;      // email text record
      twitter: string;    // com.twitter text record
      github: string;     // com.github text record
    };
  };
  updatedAt: number;      // Unix timestamp (seconds)
}
```
