import { eq, or, ne, and } from "drizzle-orm";
import { isAddress } from "viem";
import { normalize } from "viem/ens";
import { ensProfile } from "./schema";
import type { EnsPluginConfig, EnsProfile, ProfileResult } from "./types";

const DEFAULT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createEnsService(config: EnsPluginConfig) {
  const { client, db } = config;
  const cacheTtl = config.cacheTtl ?? DEFAULT_CACHE_TTL;

  function getWriteDb() {
    return typeof config.writeDb === "function"
      ? config.writeDb()
      : config.writeDb;
  }

  function isFresh(timestamp: number | null): boolean {
    if (!timestamp) return false;
    return Date.now() - timestamp * 1000 < cacheTtl;
  }

  async function fetchProfile(
    identifier: string,
  ): Promise<EnsProfile | null> {
    const normalizedIdentifier = isAddress(identifier)
      ? (identifier.toLowerCase() as `0x${string}`)
      : identifier;

    const result = await db
      .select()
      .from(ensProfile)
      .where(
        or(
          isAddress(identifier)
            ? eq(
                ensProfile.address,
                normalizedIdentifier as `0x${string}`,
              )
            : undefined,
          eq(ensProfile.ens, identifier.toLowerCase()),
        ),
      )
      .limit(1);

    return (result[0] as EnsProfile | undefined) ?? null;
  }

  async function resolveProfile(
    identifier: string,
  ): Promise<ProfileResult> {
    if (!identifier) {
      return {
        address: null,
        ensName: null,
        cachedProfile: null,
        isFresh: false,
      };
    }

    if (isAddress(identifier)) {
      const address = identifier.toLowerCase() as `0x${string}`;
      const cachedProfile = await fetchProfile(address);

      if (cachedProfile) {
        return {
          address,
          ensName: cachedProfile.ens,
          cachedProfile,
          isFresh: isFresh(cachedProfile.updatedAt),
        };
      }

      const ensName =
        (await client.getEnsName({ address })) || null;
      return { address, ensName, cachedProfile: null, isFresh: false };
    }

    try {
      const normalizedEns = identifier.toLowerCase();
      const cachedProfile = await fetchProfile(normalizedEns);

      if (cachedProfile) {
        return {
          address: cachedProfile.address as `0x${string}`,
          ensName: normalizedEns,
          cachedProfile,
          isFresh: isFresh(cachedProfile.updatedAt),
        };
      }

      const address = await client.getEnsAddress({
        name: normalize(normalizedEns),
      });

      if (!address) {
        throw new Error(
          `No address found for ENS name ${normalizedEns}`,
        );
      }

      const normalizedAddress =
        address.toLowerCase() as `0x${string}`;
      return {
        address: normalizedAddress,
        ensName: normalizedEns,
        cachedProfile: null,
        isFresh: false,
      };
    } catch {
      return {
        address: null,
        ensName: null,
        cachedProfile: null,
        isFresh: false,
      };
    }
  }

  async function updateProfile(
    address: `0x${string}`,
    providedEns: string | null = null,
  ): Promise<void> {
    const normalizedAddress =
      address.toLowerCase() as `0x${string}`;

    let ens =
      providedEns ||
      (await client.getEnsName({ address: normalizedAddress })) ||
      null;
    if (ens) {
      ens = ens.toLowerCase();
    }

    const data = {
      avatar: "",
      header: "",
      description: "",
      links: {
        url: "",
        email: "",
        twitter: "",
        github: "",
      },
    };

    if (ens) {
      const normalizedEns = normalize(ens);
      const [avatar, header, description, url, email, twitter, github] =
        await Promise.all([
          client.getEnsAvatar({ name: normalizedEns }),
          client.getEnsText({ name: normalizedEns, key: "header" }),
          client.getEnsText({
            name: normalizedEns,
            key: "description",
          }),
          client.getEnsText({ name: normalizedEns, key: "url" }),
          client.getEnsText({ name: normalizedEns, key: "email" }),
          client.getEnsText({
            name: normalizedEns,
            key: "com.twitter",
          }),
          client.getEnsText({
            name: normalizedEns,
            key: "com.github",
          }),
        ]);

      if (avatar) data.avatar = avatar;
      if (header) data.header = header;
      if (description) data.description = description;
      if (url) data.links.url = url;
      if (email) data.links.email = email;
      if (twitter) data.links.twitter = twitter;
      if (github) data.links.github = github;
    }

    const insertData = {
      ens,
      data,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    const writeDb = getWriteDb();

    // Clear ENS from any other address (handles ENS transfers)
    if (ens) {
      await writeDb
        .update(ensProfile)
        .set({ ens: null })
        .where(
          and(
            eq(ensProfile.ens, ens),
            ne(ensProfile.address, normalizedAddress),
          ),
        );
    }

    await writeDb
      .insert(ensProfile)
      .values({
        address: normalizedAddress,
        ...insertData,
      })
      .onConflictDoUpdate({
        target: ensProfile.address,
        set: insertData,
      });
  }

  return {
    resolveProfile,
    fetchProfile,
    updateProfile,
    isFresh,
  };
}
