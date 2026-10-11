import type { GameServer, GameServerOptions } from "@riftbound/game-server-src";

type CreateGameServer = typeof import("@riftbound/game-server-src").createGameServer;

export interface FixtureCatalogCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly subtitle?: string;
  readonly fullName: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: "standard" | "alternate" | "unknown";
  readonly imageUrl: string | null;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly ability: string;
}

export interface PublicCatalogCard extends FixtureCatalogCard {
  readonly allowedZones: readonly string[];
  readonly maxCopies: number;
  readonly banned: boolean;
}

export interface CardCatalogFixture {
  readonly schemaVersion: 1;
  readonly dataVersion: string;
  readonly digest: string;
  readonly groups?: readonly unknown[];
  readonly cards: readonly FixtureCatalogCard[];
}

export interface PublicCardCatalog {
  readonly schemaVersion: 1;
  readonly dataVersion: string;
  readonly digest: string;
  readonly policy: unknown;
  readonly groups?: readonly unknown[];
  readonly cards: readonly PublicCatalogCard[];
}

export interface StartedCatalogServer {
  readonly server: GameServer;
  readonly baseUrl: string;
}

export const catalogFixture: CardCatalogFixture = {
  schemaVersion: 1,
  dataVersion: "integration-fixture-2026-10-11",
  digest: "sha256:" + "a".repeat(64),
  cards: [
    {
      id: "integration.flame-warden.standard",
      canonicalCardId: "integration.flame-warden",
      name: "Flame Warden",
      fullName: "Flame Warden",
      cardType: "Unit",
      domains: ["Ember"],
      tags: ["guard", "integration"],
      setCode: "unl",
      cardNumber: "001",
      variant: "standard",
      imageUrl: null,
      energy: 2,
      power: 3,
      might: null,
      ability: "Integration guard fixture."
    },
    {
      id: "integration.flame-warden.alternate",
      canonicalCardId: "integration.flame-warden",
      name: "Flame Warden",
      subtitle: "Ember Guard",
      fullName: "Flame Warden",
      cardType: "Unit",
      domains: ["Ember"],
      tags: ["guard", "alternate-art"],
      setCode: "unl",
      cardNumber: "001-A",
      variant: "alternate",
      imageUrl: null,
      energy: 2,
      power: 3,
      might: null,
      ability: "Integration guard fixture."
    },
    {
      id: "integration.tide-oracle",
      canonicalCardId: "integration.tide-oracle",
      name: "Tide Oracle",
      fullName: "Tide Oracle",
      cardType: "Unit",
      domains: ["Tide"],
      tags: ["oracle", "integration"],
      setCode: "unl",
      cardNumber: "002",
      variant: "standard",
      imageUrl: null,
      energy: 1,
      power: 2,
      might: null,
      ability: "Integration oracle fixture."
    }
  ]
};

export async function loadCreateGameServer(): Promise<CreateGameServer> {
  try {
    const module = await import("@riftbound/game-server-src");
    if (typeof module.createGameServer !== "function") {
      throw new Error("createGameServer export is missing");
    }
    return module.createGameServer;
  } catch (error: unknown) {
    throw new Error(
      "The real game-server API could not be loaded. " +
      "Fix its exports and card catalog HTTP integration instead of skipping this suite.",
      { cause: error }
    );
  }
}

export async function startCatalogServer(
  options: Omit<GameServerOptions, "host" | "port">
): Promise<StartedCatalogServer> {
  const createGameServer = await loadCreateGameServer();
  const serverOptions: GameServerOptions = {
    ...options,
    host: "127.0.0.1",
    port: 0
  };
  const server = createGameServer(serverOptions);

  try {
    await server.start();
  } catch (error: unknown) {
    await server.stop().catch(() => undefined);
    throw error;
  }

  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    await server.stop();
    throw new Error("Game server did not expose an ephemeral TCP port");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}
