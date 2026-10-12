declare module "@riftbound/game-server-src" {
  import type { Server as HttpServer } from "node:http";

  export type DeckZone =
    | "mainDeck"
    | "runes"
    | "legend"
    | "champion"
    | "battlefields"
    | "sideboard";

  export type DeckCardPolicy =
    | { readonly type: "banned" }
    | { readonly type: "restricted" }
    | DeckLimitedCardPolicy;

  export interface DeckLimitedCardPolicy {
    readonly type: "limited";
    readonly maxCopies: number;
  }

  export interface DeckCopyRule {
    readonly zones: readonly DeckZone[];
    readonly maxCopiesPerCanonical?: number;
    readonly maxCopiesByCanonical?: Readonly<Record<string, number>>;
  }

  export interface DeckSizeRule {
    readonly minimum?: number;
    readonly maximum?: number;
  }

  export interface DeckSizeGroup {
    readonly zones: readonly DeckZone[];
    readonly rule: DeckSizeRule;
  }

  export interface DeckValidationRules {
    readonly defaultMaxCopiesPerCanonical?: number;
    readonly cardPolicies?: Readonly<Record<string, DeckCardPolicy>>;
    readonly copyRules?: readonly DeckCopyRule[];
    readonly sizeRules?: Readonly<Partial<Record<DeckZone, DeckSizeRule>>>;
    readonly sizeGroups?: readonly DeckSizeGroup[];
    readonly uniqueCanonicalZones?: readonly DeckZone[];
    readonly totalCards?: DeckSizeRule;
  }

  export interface GameServerOptions {
    host?: string;
    port?: number;
    roomIdFactory?: () => string;
    catalogPath?: string;
    imagesDirectory?: string;
    catalog?: unknown;
    deckRules?: DeckValidationRules;
    storageDirectory?: string;
  }

  export interface GameRoom {
    readonly roomId: string;
    readonly playerCount: number;
    readonly players: ReadonlyMap<string, unknown>;
  }

  export interface GameServer {
    readonly httpServer: HttpServer;
    readonly rooms: ReadonlyMap<string, GameRoom>;
    start(): Promise<void>;
    stop(): Promise<void>;
  }

  export function createGameServer(options?: GameServerOptions): GameServer;
}
