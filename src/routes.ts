import { Hono } from "hono";
import { createEnsService } from "./service";
import type { EnsPluginConfig } from "./types";

export function createEnsRoutes(config: EnsPluginConfig): Hono {
  const { resolveProfile, fetchProfile, updateProfile } =
    createEnsService(config);

  const app = new Hono();

  app.get("/:id", async (c) => {
    const identifier = c.req.param("id");
    const result = await resolveProfile(identifier);

    if (!result.address) {
      return c.json({ error: "Invalid address or ENS name" }, 400);
    }

    if (result.cachedProfile && result.isFresh) {
      return c.json(result.cachedProfile);
    }

    await updateProfile(result.address, result.ensName);
    return c.json(await fetchProfile(result.address));
  });

  app.post("/:id", async (c) => {
    const identifier = c.req.param("id");
    const result = await resolveProfile(identifier);

    if (!result.address) {
      return c.json({ error: "Invalid address or ENS name" }, 400);
    }

    await updateProfile(result.address, result.ensName);
    return c.json(await fetchProfile(result.address));
  });

  return app;
}
