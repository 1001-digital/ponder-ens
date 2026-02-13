export type EnsProfileData = {
  avatar: string;
  header: string;
  description: string;
  links: {
    url: string;
    email: string;
    twitter: string;
    github: string;
  };
};

export type ProfileResult = {
  address: `0x${string}` | null;
  ensName: string | null;
  cachedProfile: EnsProfile | null;
  isFresh: boolean;
};

export type EnsProfile = {
  address: string;
  ens: string | null;
  data: EnsProfileData | null;
  updatedAt: number;
};

export type EnsPluginConfig = {
  /** Viem public client with ENS support (must reach mainnet ENS registry). */
  client: {
    getEnsName: (args: { address: `0x${string}` }) => Promise<string | null>;
    getEnsAddress: (args: { name: string }) => Promise<`0x${string}` | null>;
    getEnsAvatar: (args: { name: string }) => Promise<string | null>;
    getEnsText: (args: { name: string; key: string }) => Promise<string | null>;
  };
  /** Drizzle DB instance for ENS profile operations. Use createOffchainDb() or provide your own. */
  db: any;
  /** Cache TTL in milliseconds. Defaults to 30 days. */
  cacheTtl?: number;
};
