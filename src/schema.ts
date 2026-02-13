import { pgSchema, text, integer, json } from "drizzle-orm/pg-core";
import type { EnsProfileData } from "./types";

export const offchainSchema = pgSchema("offchain");

export const ensProfile = offchainSchema.table("ens_profile", {
  address: text("address").primaryKey(),
  ens: text("ens"),
  data: json("data").$type<EnsProfileData>(),
  updatedAt: integer("updated_at").notNull(),
});
