import { isConstructedRegionContext, type ConstructedRegionContext } from '@riftbound/protocol';
import { catalogForConstructedRegion, validateRegionalCatalogDeck, verifyConstructedRegion } from './constructed-regional-context.js';
import path from "node:path";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  createInitialGame,
  createRoomSnapshot,
  projectGame,
  submitCommand,
  type GameState
} from "@riftbound/engine-core";
import {
  DUEL_RULESET_ID,
  FOUNDATION_RULESET_ID,
  OWNER_DECK_CONFIRMATION_SCHEMA,
  OWNER_DECK_ZONES,
  RULESET_ID,
  type DuelCommandMessage,
  type DuelCommandMessageV3Actions1,
  type Journal,
  isJournal,
  isDuelCommandMessageV3Actions1,
  isServerMessage,
  type ClientSession,
  type Command,
  type ErrorCode,
  type GameProjection,
  type OwnerDeckConfirmationMessage,
  type OwnerDeckEcho,
  type PlayerCommand,
  type PlayerId,
  type RoomDeckSubmission,
  type RoomChatMessage,
  type RoomChatServerMessage,
  type RoomEvent,
  type RoomPlayer,
  type RoomSnapshot,
  type RoomView,
  type ServerToClientMessage,
  type ServerTransport
} from "@riftbound/protocol";
import type { V2Command, V2CommandReceipt, V2Projection } from "../../../packages/protocol/dist/v2/index.js";
import {
  RoomChatError,
  RoomChatLedger,
  validateRoomChatMessages
} from "./room-chat.js";
import {
  normalizeDeckRequest,
  validateCatalogDeck,
  type CardCatalogRuntime
} from "./card-catalog.js";
import { createFoundationGame } from "./foundation-game.js";
import { CurrentDuelRuntime, type CurrentDuelRuntimeOptions } from "./duel/runtime/current.js";
import type { DurableRuntimeResult } from "./duel/runtime/durable/recording.js";
import type { exportDuelSessionArchive } from "./duel/session-archive.js";
import type { DuelCommandArchiveP4 } from "./duel/command-journal-p4.js";
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY,
  type DuelAuthoritativeRuntimeP4Ack } from "./duel/authoritative-runtime-p4.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "./engine-runtime/index.js";
import type { RuntimeJournal } from "./engine-runtime/journal.js";
import type { Domain } from "../../../packages/engine-core/dist/effects/contract.js";
import type { CardProgram } from "../../../packages/card-dsl/dist/ir/index.js";
import { cardProgramsById } from "../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { ProgramPrintedCatalogCard } from "../../../packages/engine-core/dist/programs/index.js";

export type DuelRoomProfile = "v1" | "p4";
export type DuelRuntimeMode = "legacy-p4" | "engine-v2";
export type DuelOptionalRoomRuntimeProfile = typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY;

export interface RoomConnection {
  readonly playerId: PlayerId;
  readonly resumeToken: string;
  readonly connectionId: string;
  readonly send: ServerTransport;
}

export interface RoomSeatArchive {
  readonly id: PlayerId;
  readonly name: string;
  readonly resumeToken: string;
  ready: boolean;
  deck: RoomDeckSubmission | null;
}
type Seat = RoomSeatArchive;

interface PersistedEngineMulliganReceipt {
  readonly playerId: PlayerId;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly receipt: V2CommandReceipt;
}

/** Private protocol-v2 setup state. It is never copied into a room or match projection. */
interface EngineMulliganSetup {
  readonly firstPlayer: "A" | "B";
  readonly battlefieldChoice: readonly [number, number];
  /** Canonical card ids are the createMatch input; null means the seat has not chosen yet. */
  readonly choices: readonly [readonly string[] | null, readonly string[] | null];
}

export interface ProcessedCommand {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly payloadHash: string;
  readonly appliedVersion: number;
  readonly eventSeq: number;
}

export interface ProcessedRoomRequest {
  readonly playerId: PlayerId;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
}

/**
 * Private retry evidence for a semantic P4 rejection. It is deliberately
 * separate from journal-v1: rejected commands never advance game state and
 * remain absent from accepted/pending replay records.
 */
export interface PersistedDuelCommandAttempt {
  readonly playerId: PlayerId;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly ack: DuelAuthoritativeRuntimeP4Ack;
}

/** Server-private state. Never send this archive through client transports. */
export interface RoomArchive {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly rulesetId: string;
  readonly seats: readonly RoomSeatArchive[];
  readonly state: GameState | null;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
  readonly roomEventLog: readonly RoomEvent[];
  readonly processedCommands: readonly ProcessedCommand[];
  readonly processedRoomRequests?: readonly ProcessedRoomRequest[];
  /** Optional sticky rejection ledger; absent in archives written before it existed. */
  readonly duelCommandAttempts?: readonly PersistedDuelCommandAttempt[];
  /** Optional private chat history. Omitted for rooms with no chat messages. */
  readonly roomChat?: { readonly messages: readonly RoomChatMessage[] };
  /** Current private journal. No legacy profile or serialized capability is persisted. */
  readonly journal?: Journal | null;
  /** Protocol v2 engine-runtime journal. It is mutually exclusive with journal. */
  readonly engineRuntimeJournal?: RuntimeJournal | null;
  /** Optional protocol-v2 mulligan ceremony still awaiting one or both seats. */
  readonly engineMulligan?: EngineMulliganSetup | null;
  /** Idempotency evidence for accepted setup mulligans, retained after setup completes. */
  readonly engineMulliganReceipts?: readonly PersistedEngineMulliganReceipt[];
  /** Runtime owner selected at room creation. Missing means the legacy API default. */
  readonly runtimeMode?: DuelRuntimeMode;
  /** @deprecated Historical replay only; current rooms reject this shape. */
  readonly duelSession?: ReturnType<typeof exportDuelSessionArchive> | null;
  /** @deprecated Historical archive fields; current execution never reads them. */
  readonly duelProfile?: "p4";
  readonly duelJournal?: DuelCommandArchiveP4 | null;
  /** @deprecated Historical selection metadata; rejected during current recovery. */
  readonly duelRuntimeProfile?: DuelOptionalRoomRuntimeProfile;
  readonly constructedRegion?: ConstructedRegionContext;
}

type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;

/**
 * Server-owned room orchestration. Engine state remains authoritative and
 * starts immediately for the synthetic demo or after ready decks for the
 * foundation ruleset.
 */
export class GameRoom {
  readonly players = new Map<PlayerId, RoomConnection>();
  readonly processedCommands = new Map<string, ProcessedCommand>();
  private readonly processedRoomRequests = new Map<string, ProcessedRoomRequest>();
  private readonly duelCommandAttempts = new Map<string, PersistedDuelCommandAttempt>();

  private readonly seats = new Map<PlayerId, Seat>();
  private state: GameState | null = null;
  private duelRuntime: CurrentDuelRuntime | null = null;
  private engineRuntime: EngineRuntime | null = null;
  private engineMulligan: EngineMulliganSetup | null = null;
  /**
   * Public event remaps are append-only. Templates own the recursively
   * remapped payload while the event list still stamps each projection's
   * current stateVersion.
   */
  private readonly publicEngineEventCaches = new Map<string | null, {
    readonly runtime: EngineRuntime;
    readonly matchId: string;
    readonly viewerPlayerId: string | null;
    readonly eventSeq: number;
    readonly stateVersion: number;
    readonly templates: readonly V2Projection["events"][number][];
    readonly events: readonly V2Projection["events"][number][];
  }>();
  private readonly engineMulliganReceipts = new Map<string, PersistedEngineMulliganReceipt>();
  private storageDirectory?: string;
  private roomVersion = 1;
  private roomEventSeq = 0;
  private readonly roomEventLog: RoomEvent[] = [];
  private readonly roomChat = new RoomChatLedger();

  constructor(
    readonly roomId: string,
    readonly rulesetId: string = RULESET_ID,
    private readonly catalog?: CardCatalogRuntime,
    private readonly duelRandomIndex: (exclusiveUpperBound: number) => number = randomInt,
    /** @deprecated Accepted for source compatibility; never selects an executor. */
    duelProfile: DuelRoomProfile = "v1",
    readonly constructedRegion?: ConstructedRegionContext,
    /** @deprecated Accepted for source compatibility; never selects an executor. */
    duelRuntimeProfile?: DuelOptionalRoomRuntimeProfile,
    readonly runtimeMode: DuelRuntimeMode = "engine-v2"
  ) {
    if (rulesetId !== RULESET_ID && rulesetId !== FOUNDATION_RULESET_ID &&
        rulesetId !== DUEL_RULESET_ID) {
      throw new RoomError(
        `Unsupported ruleset ${rulesetId}`,
        "command-rejected"
      );
    }
    if (duelProfile !== "v1" && duelProfile !== "p4") throw new TypeError("Invalid duel room profile");
    if (runtimeMode !== "legacy-p4" && runtimeMode !== "engine-v2") throw new TypeError("Invalid duel runtime mode");
    if (duelRuntimeProfile !== undefined && ![
      DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
      DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY
    ].includes(duelRuntimeProfile)) throw new TypeError("Invalid deprecated runtime profile");
    if (constructedRegion) {
      if (rulesetId !== DUEL_RULESET_ID || !catalog)
        throw new TypeError("地区设置需要完整 Duel 房间");
      this.constructedRegion = verifyConstructedRegion(constructedRegion);
    }
    this.appendRoomEvent({ type: "room-created", playerId: "player-1" });
  }

  get isFull(): boolean {
    return this.seats.size >= 2;
  }

  private get hasGame(): boolean { return Boolean(this.state || this.duelRuntime || this.engineRuntime || this.engineMulligan); }
  private get duelMatch() { return this.duelRuntime?.project(null).match ?? null; }
  private get engineProjection() {
    return this.engineMulligan ? this.engineRuntime?.projectFor("A") ?? null : this.engineRuntime?.projectFor(null) ?? null;
  }

  private validateDeckForRoom(deck: RoomDeckSubmission) {
    if (!this.catalog) throw new TypeError("card catalog required");
    return this.constructedRegion ? validateRegionalCatalogDeck(this.catalog,deck,this.constructedRegion) : validateCatalogDeck(this.catalog,deck);
  }

  private runtimeOptions(seats: readonly Seat[] = [...this.seats.values()]): CurrentDuelRuntimeOptions {
    if (!this.catalog || seats.length !== 2 || seats.some(seat => !seat.ready || !seat.deck))
      throw new RoomError("对局缺少已确认的双方牌组", "invalid-deck");
    const rosterSeat = (seat: Seat) => ({ playerId: seat.id, displayName: seat.name, deck: seat.deck! });
    const catalog = this.constructedRegion ? catalogForConstructedRegion(this.catalog,this.constructedRegion) : this.catalog;
    return { catalog, matchId: `duel:${this.roomId}`, randomIndex: this.duelRandomIndex,
      ...(this.constructedRegion ? {constructedRegion:this.constructedRegion} : {}),
      roster: [rosterSeat(seats[0]!), rosterSeat(seats[1]!)] };
  }

  private engineRuntimeOptions(
    seats: readonly Seat[] = [...this.seats.values()],
    journalBattlefieldChoice?: readonly [number | null, number | null] | null,
    mulligans?: readonly [readonly string[], readonly string[]],
    firstPlayer?: 0 | 1
  ) {
    if (!this.catalog || seats.length !== 2 || seats.some(seat => !seat.ready || !seat.deck)) {
      throw new RoomError("对局缺少已确认的双方牌组", "invalid-deck");
    }
    const catalog = this.constructedRegion ? catalogForConstructedRegion(this.catalog, this.constructedRegion) : this.catalog;
    const runtimeSeats = seats.map((seat, index) => ({ playerId: index === 0 ? "A" : "B", name: seat.name }));
    const decks = seats.map(seat => this.engineDeck(seat, catalog)) as [EngineRuntimeDeck, EngineRuntimeDeck];
    const battlefieldChoice = journalBattlefieldChoice === null
      ? undefined
      : journalBattlefieldChoice ?? [this.duelRandomIndex(3), this.duelRandomIndex(3)] as const;
    const selectedBattlefields = battlefieldChoice === undefined ? [] : decks.flatMap((deck, index) => {
      const choice = battlefieldChoice[index];
      // The setup lifecycle owns this same validation. Check here first so a bad
      // server RNG cannot produce a program collection from a different field.
      if (choice === undefined || choice === null) return [];
      if (!Number.isInteger(choice) || choice < 0 || choice > 2) {
        throw new RoomError("Battlefield selection must be 0, 1 or 2", "command-rejected");
      }
      return [deck.battlefields[choice]!];
    });
    const deckPrograms = [...new Set(decks.flatMap(deck => [
      ...deck.mainDeck, deck.championLegend, deck.chosenChampion, ...selectedBattlefields,
    ].map(card => card.cardId).filter((id): id is string => typeof id === "string")))]
      .flatMap(cardId => {
        const program = cardProgramsById.get(cardId);
        // The generated registry's inferred literal union is wider than the
        // public IR declaration. EngineRuntime's ProgramRegistry validates each
        // entry with validateCardProgram before execution and still rejects
        // judge-required/no-ability programs; this cast grants no capability.
        return program === undefined ? [] : [program as unknown as CardProgram];
      });
    const printedCatalog = new Map<string, ProgramPrintedCatalogCard>();
    const conflictingCanonicalIds = new Set<string>();
    for (const card of catalog.publicCatalog.cards) {
      const projection: ProgramPrintedCatalogCard = {
        id: card.id,
        canonicalCardId: card.canonicalCardId,
        cardType: card.cardType,
        domains: [...card.domains],
        energy: card.energy,
        power: card.power,
      };
      const signature = JSON.stringify([
        projection.cardType,
        projection.domains,
        projection.energy,
        projection.power,
      ]);
      const existing = printedCatalog.get(projection.canonicalCardId);
      if (existing === undefined) {
        printedCatalog.set(projection.canonicalCardId, projection);
        continue;
      }
      const existingSignature = JSON.stringify([
        existing.cardType,
        existing.domains,
        existing.energy,
        existing.power,
      ]);
      // A canonical identity may have cosmetic reprints, but divergent trusted
      // printed costs cannot be resolved by printing order. Keep that identity
      // absent so effect Play remains fail-closed.
      if (existingSignature !== signature) {
        printedCatalog.delete(projection.canonicalCardId);
        conflictingCanonicalIds.add(projection.canonicalCardId);
      }
    }
    for (const canonicalCardId of conflictingCanonicalIds) printedCatalog.delete(canonicalCardId);
    return {
      matchId: `duel:${this.roomId}`,
      roomId: this.roomId,
      seats: runtimeSeats as [{ playerId: string; name: string }, { playerId: string; name: string }],
      decks,
      seed: this.roomId,
      catalogDigest: catalog.publicCatalog.digest,
      ...(mulligans === undefined ? {} : { mulligans }),
      ...(firstPlayer === undefined ? {} : { firstPlayer }),
      ...(battlefieldChoice === undefined ? {} : {
        battlefieldChoice: [
          battlefieldChoice[0] ?? undefined,
          battlefieldChoice[1] ?? undefined,
        ] as const,
      }),
      ...(deckPrograms.length > 0 ? { programs: deckPrograms } : {}),
      ...(printedCatalog.size > 0 ? { printedCatalog: [...printedCatalog.values()] } : {}),
    } as const;
  }

  /**
   * Create only the trusted setup projection for the mulligan ceremony. The
   * final authoritative runtime is created again with both complete choices;
   * this instance is never exposed as a command owner or persisted as a journal.
   */
  private mulliganProbe(playerId: "A" | "B"): V2Projection {
    if (!this.seats.size || this.seats.size !== 2) {
      throw new RoomError("Room needs two players", "command-rejected");
    }
    if (!this.catalog) throw new RoomError("The card catalog is unavailable", "command-rejected");
    if (!this.engineMulligan) {
      const trustedSeats = [...this.seats.values()];
      if (trustedSeats.some(seat => !seat.ready || !seat.deck || !this.players.has(seat.id))) {
        throw new RoomError("Every player must submit a deck and be ready", "invalid-deck");
      }
      // The automatic first player consumes the same deterministic setup RNG
      // as the final runtime. Pinning these facts keeps the approved four-card
      // hands stable when the setup is rebuilt after both choices arrive.
      const automaticProbe = createEngineRuntime(this.engineRuntimeOptions()).start();
      const publicView = automaticProbe.projectFor(null);
      if (publicView.activePlayerId !== "A" && publicView.activePlayerId !== "B") {
        throw new Error("Engine runtime returned an invalid first player");
      }
      const battlefieldChoice = automaticProbe.journal().header.setup?.battlefieldChoice;
      if (battlefieldChoice === undefined ||
          battlefieldChoice.some(value => value === null || value === undefined)) {
        throw new Error("Engine runtime omitted deterministic battlefield choices");
      }
      this.engineMulligan = {
        firstPlayer: publicView.activePlayerId,
        battlefieldChoice: [battlefieldChoice[0]!, battlefieldChoice[1]!],
        choices: [null, null],
      };
    }
    const setup = this.engineMulligan;
    // Keep the trusted preview runtime in the existing private `engineRuntime`
    // slot for staff diagnostics and setup tests, but never expose its command
    // surface: submitEngineV2's setup queue below intercepts every client
    // command and projection publication prefers setupMulliganProjection.
    this.publicEngineEventCaches.clear();
    this.engineRuntime = createEngineRuntime(this.engineRuntimeOptions(
      [...this.seats.values()],
      setup.battlefieldChoice,
      [[], []],
      setup.firstPlayer === "A" ? 0 : 1
    )).start();
    return this.engineRuntime.projectFor(playerId);
  }

  private setupMulliganProjection(playerId: PlayerId): V2Projection {
    const setup = this.engineMulligan;
    if (!setup) throw new Error("Mulligan setup has not started");
    const enginePlayerId = this.enginePlayerId(playerId);
    const view = this.mulliganProbe(enginePlayerId);
    const ownHand = view.zones.find(zone =>
      zone.zone === "hand" && zone.ownerPlayerId === enginePlayerId)?.objects ?? [];
    // The probe has already started the first turn, so its active seat holds a
    // fifth card. CR 116/117 exposes exactly the four-card opening hand for the
    // mulligan window; the turn-start draw becomes visible only after setup ends.
    const opening = ownHand.slice(0, 4);
    const openingKeys = new Set(opening.map(object => `${object.objectId}:${String(object.zoneEntryId)}`));
    const turnDrawIds = new Set(view.objects.filter(object => object.ownerPlayerId === enginePlayerId &&
      object.zone === "hand" && !openingKeys.has(`${object.objectId}:${String(object.zoneEntryId)}`))
      .map(object => object.objectId));
    const objects = view.objects.filter(object => !turnDrawIds.has(object.objectId));
    const zones = view.zones.map(zone => {
      if (zone.ownerPlayerId === enginePlayerId && zone.zone === "hand") {
        return { ...zone, count: opening.length, objects: opening };
      }
      if (turnDrawIds.size === 0 || zone.objects === undefined) return zone;
      const kept = zone.objects.filter(object => !turnDrawIds.has(object.objectId));
      return kept.length === zone.objects.length ? zone : { ...zone, count: kept.length, objects: kept };
    });
    const firstIndex = setup.firstPlayer === "A" ? 0 : 1;
    const dueIndex = setup.choices[firstIndex] === null ? firstIndex : firstIndex === 0 ? 1 : 0;
    const duePlayer = dueIndex === 0 ? "A" : "B";
    // The V2 choice shape has no repeatable-until-keep answer. CR 117 therefore
    // exposes the max-two object selection and the UI sends it through the
    // existing mulligan command; empty is a valid keep-all selection.
    const pendingChoice = enginePlayerId === duePlayer ? {
      status: "pending" as const,
      choiceId: `mulligan:${this.roomId}:${duePlayer}`,
      ownerPlayerId: duePlayer,
      stateVersion: 0,
      kind: "select-objects" as const,
      options: opening.flatMap(object => object.cardId === undefined ? [] : [{
        id: object.objectId,
        label: object.name ?? object.cardId,
        value: object.objectId,
        objectRef: { objectId: object.objectId, zoneEntryId: object.zoneEntryId ?? 0 },
      }]),
      min: 0,
      max: 2,
    } : { status: "none" as const };
    return {
      ...view,
      viewerPlayerId: enginePlayerId,
      stateVersion: 0,
      eventSeq: 0,
      phase: "setup",
      turnNumber: 1,
      activePlayerId: setup.firstPlayer,
      players: view.players.map(player => player.playerId === enginePlayerId
        ? { ...player, handCount: opening.length }
        : player),
      zones,
      objects,
      chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
      priority: { playerId: null, focusPlayerId: null, window: "choice" },
      actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
      pendingChoice,
      winnerPlayerId: null,
      events: [],
    };
  }

  private submitMulliganSetup(
    playerId: PlayerId,
    command: Extract<V2Command, { readonly type: "mulligan" }>,
    transport: (message: unknown) => void
  ): void {
    const setup = this.engineMulligan;
    if (!setup) throw new Error("Mulligan setup has not started");
    const enginePlayerId = this.enginePlayerId(playerId);
    const payloadHash = hashEngineMulliganCommand(command);
    const prior = this.engineMulliganReceipts.get(requestKey(playerId, command.commandId));
    if (prior) {
      const receipt = prior.payloadHash === payloadHash
        ? { ...prior.receipt, duplicate: true }
        : { ...prior.receipt, accepted: false, duplicate: false,
            rejection: "commandId was already used for a different command" };
      transport(receipt);
      this.broadcastProjections();
      return;
    }

    const reject = (message: string): void => {
      transport({
        type: "command-receipt", protocolVersion: "2.0.0", commandId: command.commandId,
        stateVersion: 0, eventSeq: 0, accepted: false, duplicate: false, rejection: message,
      } satisfies V2CommandReceipt);
      this.broadcastProjections();
    };
    if (command.stateVersion !== 0) {
      reject(`stateVersion mismatch: expected 0, received ${command.stateVersion}`);
      return;
    }
    const firstIndex = setup.firstPlayer === "A" ? 0 : 1;
    const dueIndex = setup.choices[firstIndex] === null ? firstIndex : firstIndex === 0 ? 1 : 0;
    const actorIndex = enginePlayerId === "A" ? 0 : 1;
    if (actorIndex !== dueIndex) {
      reject("Mulligan must be completed in turn order");
      return;
    }

    const selected = (command.selectedObjectIds ?? command.selectedUIDs)?.map(objectId =>
      objectId.startsWith("turn-draw:") ? objectId.slice("turn-draw:".length) : objectId);
    if (!Array.isArray(selected) || selected.length > 2 || new Set(selected).size !== selected.length) {
      reject("A player mulligans at most two distinct cards (CR 117.1)");
      return;
    }
    const view = this.publicEngineProjection(this.setupMulliganProjection(playerId));
    const hand = view.zones.find(zone =>
      zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
    const handByObjectId = new Map(hand.map(object => [object.objectId, object]));
    const canonicalIds: string[] = [];
    for (const objectId of selected) {
      const object = handByObjectId.get(objectId);
      if (!object || object.cardId === undefined) {
        reject("Mulligan cards must be in that player's opening hand");
        return;
      }
      canonicalIds.push(object.cardId);
    }
    if (new Set(canonicalIds).size !== canonicalIds.length) {
      reject("Mulligan cards must be distinct");
      return;
    }

    const choices: [readonly string[] | null, readonly string[] | null] = [setup.choices[0], setup.choices[1]];
    choices[actorIndex] = canonicalIds;
    this.engineMulligan = { ...setup, choices };
    const receipt: V2CommandReceipt = {
      type: "command-receipt", protocolVersion: "2.0.0", commandId: command.commandId,
      stateVersion: 0, eventSeq: 0, accepted: true, duplicate: false, rejection: null,
    };
    this.engineMulliganReceipts.set(requestKey(playerId, command.commandId), {
      playerId, commandId: command.commandId, payloadHash, receipt: structuredClone(receipt),
    });
    // No public RoomEvent is invented for setup choices, but the private room
    // archive still needs an observable revision so a durable transaction saves.
    this.roomVersion += 1;
    transport(receipt);
    if (choices[0] !== null && choices[1] !== null) this.finishMulliganSetup();
    this.broadcastProjections();
  }

  private finishMulliganSetup(): void {
    const setup = this.engineMulligan;
    if (!setup || setup.choices[0] === null || setup.choices[1] === null) return;
    this.publicEngineEventCaches.clear();
    this.engineRuntime = createEngineRuntime(this.engineRuntimeOptions(
      [...this.seats.values()], setup.battlefieldChoice,
      [setup.choices[0], setup.choices[1]], setup.firstPlayer === "A" ? 0 : 1
    )).start();
    this.engineMulligan = null;
    this.appendRoomEvent({ type: "game-started" });
    // Crossing setup can update several locked top cards without presenting a
    // gameplay action. Advance the room clock so the completed projection is
    // never mistaken for the pregame cursor by a connected V2 client.
    this.roomVersion += 1;
    this.broadcastRoom();
  }

  private engineDeck(seat: Seat, catalog: CardCatalogRuntime): EngineRuntimeDeck {
    const deck = seat.deck!;
    const cards = new Map(catalog.publicCatalog.cards.map(card => [card.id, card]));
    const domains = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
    const toCard = (cardId: string, id: string) => {
      const card = cards.get(cardId);
      if (!card) throw new RoomError(`Unknown card ${cardId}`, "invalid-deck");
      // "Colorless" is a catalog deck-building marker, not a Game Domain. Basic
      // Rune identity remains strict: unlike other card types, it must resolve
      // to exactly one of the six rule Domains.
      const catalogDomains = card.domains.filter((domain): domain is Domain => domains.has(domain));
      if (card.cardType.toLowerCase() === "rune" && catalogDomains.length !== 1) {
        throw new RoomError(`Rune ${cardId} requires exactly one trusted Domain`, "invalid-deck");
      }
      return {
        id,
        cardId: card.canonicalCardId,
        name: card.name,
        types: [card.cardType.toLowerCase()],
        tags: [...card.tags],
        energy: card.energy,
        might: card.might,
        power: card.power === null ? null : catalogDomains,
        domains: catalogDomains,
      };
    };
    const expand = (zone: keyof RoomDeckSubmission, required = false) => {
      const entries = deck[zone] ?? [];
      const result = entries.flatMap(entry => Array.from({ length: entry.quantity }, (_, index) =>
        toCard(entry.cardId, `${seat.id}:${zone}:${index}:${entry.cardId}`)));
      if (required && result.length === 0) throw new RoomError(`Deck zone ${zone} is empty`, "invalid-deck");
      return result;
    };
    const legend = expand("legend", true);
    const champion = expand("champion", true);
    const battlefields = expand("battlefields", true);
    if (legend.length !== 1 || champion.length !== 1 || battlefields.length !== 3) {
      throw new RoomError("Engine v2 requires one legend, one champion and three battlefields", "invalid-deck");
    }
    return {
      mainDeck: expand("mainDeck", true),
      runeDeck: expand("runes", true),
      championLegend: legend[0]!,
      chosenChampion: champion[0]!,
      battlefields: battlefields as [typeof battlefields[0], typeof battlefields[0], typeof battlefields[0]],
    };
  }

  private enginePlayerId(playerId: PlayerId): "A" | "B" {
    if (playerId === "player-1") return "A";
    if (playerId === "player-2") return "B";
    throw new RoomError("Invalid player session", "invalid-token");
  }

  private publicEngineProjection(projection: V2Projection): V2Projection {
    return this.publicEngineProjectionWithEvents(projection, this.publicEngineEvents(projection));
  }

  private publicEngineProjectionWithEvents(
    projection: V2Projection,
    events: readonly V2Projection["events"][number][],
  ): V2Projection {
    const mapPlayer = (id: string | null): string | null => this.publicEnginePlayerId(id);
    return {
      ...projection,
      viewerPlayerId: mapPlayer(projection.viewerPlayerId),
      activePlayerId: mapPlayer(projection.activePlayerId)!,
      winnerPlayerId: mapPlayer(projection.winnerPlayerId),
      players: projection.players.map(player => ({ ...player, playerId: mapPlayer(player.playerId)! })),
      zones: projection.zones.map(zone => ({ ...zone, ownerPlayerId: mapPlayer(zone.ownerPlayerId)!, ...(zone.objects ? { objects: zone.objects.map(object => ({ ...object, ownerPlayerId: mapPlayer(object.ownerPlayerId)!, ...(object.controllerPlayerId ? { controllerPlayerId: mapPlayer(object.controllerPlayerId)! } : {}), ...(object.location?.kind === "base" ? { location: { ...object.location, playerId: mapPlayer(object.location.playerId)! } } : {}) })) } : {}) })),
      objects: projection.objects.map(object => ({ ...object, ownerPlayerId: mapPlayer(object.ownerPlayerId)!, ...(object.controllerPlayerId ? { controllerPlayerId: mapPlayer(object.controllerPlayerId)! } : {}), ...(object.location?.kind === "base" ? { location: { ...object.location, playerId: mapPlayer(object.location.playerId)! } } : {}) })),
      chain: { ...projection.chain, priorityPlayerId: mapPlayer(projection.chain.priorityPlayerId), focusPlayerId: mapPlayer(projection.chain.focusPlayerId), items: projection.chain.items.map(item => ({ ...item, controllerPlayerId: mapPlayer(item.controllerPlayerId)! })) },
      priority: { ...projection.priority, playerId: mapPlayer(projection.priority.playerId), focusPlayerId: mapPlayer(projection.priority.focusPlayerId) },
      scoring: { ...projection.scoring, players: projection.scoring.players.map(player => ({ ...player, playerId: mapPlayer(player.playerId)! })) },
      battlefields: projection.battlefields.map(battlefield => ({
        ...battlefield,
        controllerPlayerId: mapPlayer(battlefield.controllerPlayerId),
        contestedByPlayerId: mapPlayer(battlefield.contestedByPlayerId),
      })),
      combat: projection.combat.status === "active" ? {
        ...projection.combat,
        ...(projection.combat.attackerPlayerId === undefined ? {} : {
          attackerPlayerId: mapPlayer(projection.combat.attackerPlayerId)!,
        }),
        ...(projection.combat.defenderPlayerId === undefined ? {} : {
          defenderPlayerId: mapPlayer(projection.combat.defenderPlayerId)!,
        }),
        ...(projection.combat.damage === undefined ? {} : {
          damage: {
            ...projection.combat.damage,
            expectedPlayerId: mapPlayer(projection.combat.damage.expectedPlayerId)!,
          },
        }),
      } : projection.combat,
      actionOptions: {
        ...projection.actionOptions,
        moves: projection.actionOptions.moves.map(option => ({
          ...option,
          destination: this.publicEngineLocation(option.destination),
        })),
        plays: projection.actionOptions.plays.map(option => ({
          ...option,
          destination: this.publicEngineLocation(option.destination),
        })),
      },
      pendingChoice: projection.pendingChoice.status === "pending" ? { ...projection.pendingChoice, ownerPlayerId: mapPlayer(projection.pendingChoice.ownerPlayerId)! } : projection.pendingChoice,
      events,
    };
  }

  private publicEngineEvents(projection: V2Projection): readonly V2Projection["events"][number][] {
    const runtime = this.engineRuntime;
    const cached = this.publicEngineEventCaches.get(projection.viewerPlayerId) ?? null;
    if (runtime !== null && cached !== null && cached.runtime === runtime && cached.matchId === projection.matchId &&
        cached.viewerPlayerId === projection.viewerPlayerId &&
        cached.eventSeq === projection.eventSeq && cached.stateVersion === projection.stateVersion) {
      return cached.events;
    }
    const mapEventValue = (value: unknown): unknown => {
      if (value === "A" || value === "B") return this.publicEnginePlayerId(value);
      if (Array.isArray(value)) return value.map(mapEventValue);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, mapEventValue(nested)]));
      }
      return value;
    };
    const reusablePrefix = runtime !== null && cached !== null && cached.runtime === runtime &&
      cached.matchId === projection.matchId &&
      cached.viewerPlayerId === projection.viewerPlayerId &&
      projection.events.length >= cached.templates.length &&
      (cached.templates.length === 0 ||
        projection.events[cached.templates.length - 1]?.eventSeq === cached.templates.at(-1)?.eventSeq)
      ? cached.templates.length
      : 0;
    const templates = Object.freeze([
      ...(cached?.templates.slice(0, reusablePrefix) ?? []),
      ...projection.events.slice(reusablePrefix).map(event =>
        Object.freeze(mapEventValue(event) as V2Projection["events"][number])),
    ] as V2Projection["events"][number][]);
    const events = Object.freeze(templates.map(event => event.stateVersion === projection.stateVersion
      ? event
      : Object.freeze({ ...event, stateVersion: projection.stateVersion }))) as
        readonly V2Projection["events"][number][];
    if (runtime === null) this.publicEngineEventCaches.clear();
    else this.publicEngineEventCaches.set(projection.viewerPlayerId, {
      runtime,
      matchId: projection.matchId,
      viewerPlayerId: projection.viewerPlayerId,
      eventSeq: projection.eventSeq,
      stateVersion: projection.stateVersion,
      templates,
      events,
    });
    return events;
  }

  private publicEnginePlayerId(id: string | null): string | null {
    if (id === null) return null;
    if (id === "A") return "player-1";
    if (id === "B") return "player-2";
    return id;
  }

  private publicEngineLocation(location: V2Projection["actionOptions"]["moves"][number]["destination"]):
    V2Projection["actionOptions"]["moves"][number]["destination"] {
    return location.kind === "base"
      ? { ...location, playerId: this.publicEnginePlayerId(location.playerId)! }
      : location;
  }

  private engineCommandPlayerId(id: string): string {
    if (id === "player-1") return "A";
    if (id === "player-2") return "B";
    // Preserve unknown ids so the authoritative engine performs ownership and
    // target validation with the same rejection semantics as before.
    return id;
  }

  private engineCommand<T extends V2Command>(command: T): T {
    const mapPlayer = (id: string): string => this.engineCommandPlayerId(id);
    const mapLocation = (location: Extract<V2Command, { readonly type: "play" }>["destination"]):
      Extract<V2Command, { readonly type: "play" }>["destination"] =>
      location?.kind === "base" ? { ...location, playerId: mapPlayer(location.playerId) } : location;
    const mapMoveDestination = <D extends Extract<V2Command, { readonly type: "move" }>["to"]>(to: D): D =>
      "playerId" in to && to.playerId !== undefined
        ? { ...to, playerId: mapPlayer(to.playerId) }
        : to;
    switch (command.type) {
      case "play":
      case "activate": {
        const targets = command.targets?.map(target =>
          target.kind === "player" ? { ...target, playerId: mapPlayer(target.playerId) } : target);
        const picks = command.picks?.map(pick =>
          pick.kind === "player" ? { ...pick, playerId: mapPlayer(pick.playerId) } : pick);
        return {
          ...command,
          ...(command.type === "play" && command.destination !== undefined
            ? { destination: mapLocation(command.destination) }
            : {}),
          ...(targets === undefined ? {} : { targets }),
          ...(picks === undefined ? {} : { picks }),
        } as T;
      }
      case "move":
        return { ...command, to: mapMoveDestination(command.to) } as T;
      default:
        return command;
    }
  }

  exportArchive(): RoomArchive {
    return structuredClone({
      schemaVersion: 1,
      roomId: this.roomId,
      rulesetId: this.rulesetId,
      ...(this.constructedRegion ? {constructedRegion:this.constructedRegion} : {}),
      seats: [...this.seats.values()],
      state: this.state,
      ...(this.rulesetId === DUEL_RULESET_ID && this.runtimeMode === "legacy-p4"
        ? { journal: this.duelRuntime?.exportJournal() ?? null }
        : {}),
      ...(this.rulesetId === DUEL_RULESET_ID && this.runtimeMode === "engine-v2"
        ? { runtimeMode: this.runtimeMode,
            engineRuntimeJournal: this.engineMulligan ? null : this.engineRuntime?.journal() ?? null,
            engineMulligan: this.engineMulligan,
            ...(this.engineMulliganReceipts.size > 0
              ? { engineMulliganReceipts: [...this.engineMulliganReceipts.values()] }
              : {}) }
        : {}),
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      roomEventLog: this.roomEventLog,
      processedCommands: [...this.processedCommands.values()],
      processedRoomRequests: [...this.processedRoomRequests.values()],
      ...(this.runtimeMode === "legacy-p4" && this.duelCommandAttempts.size > 0
        ? { duelCommandAttempts: [...this.duelCommandAttempts.values()] }
        : {}),
      ...(this.roomChat.currentSeq > 0
        ? { roomChat: { messages: this.roomChat.messages } }
        : {})
    });
  }

  static restore(archive: unknown, catalog?: CardCatalogRuntime): GameRoom {
    if (!isRecord(archive)) {
      throw new Error("Invalid server room archive");
    }
    const roomArchive = archive as unknown as RoomArchive;
    validateRoomChatArchive(roomArchive);
    if (roomArchive.constructedRegion !== undefined && (!isConstructedRegionContext(roomArchive.constructedRegion) ||
        roomArchive.rulesetId !== DUEL_RULESET_ID))
      throw new TypeError("Invalid regional room archive");
    if (roomArchive.constructedRegion) verifyConstructedRegion(roomArchive.constructedRegion);
    if (roomArchive.duelSession !== undefined || roomArchive.duelJournal !== undefined ||
        roomArchive.duelProfile !== undefined || roomArchive.duelRuntimeProfile !== undefined) {
      throw new TypeError("Historical room archives require the frozen legacy replayer; no automatic upgrade");
    }
    const expectedSeatIds: readonly PlayerId[] = roomArchive.seats?.length === 2
      ? ["player-1", "player-2"]
      : roomArchive.seats?.length === 1
        ? ["player-1"]
        : [];
    if (roomArchive.schemaVersion !== 1 ||
        typeof roomArchive.roomId !== "string" || !roomArchive.roomId ||
        typeof roomArchive.rulesetId !== "string" || !roomArchive.rulesetId ||
        !Array.isArray(roomArchive.seats) || roomArchive.seats.length > 2 ||
        roomArchive.seats.some((seat, index) => seat?.id !== expectedSeatIds[index]) ||
        roomArchive.seats.some(seat =>
          typeof seat?.id !== "string" ||
          !expectedSeatIds.includes(seat.id) ||
          typeof seat?.resumeToken !== "string" || !seat.resumeToken ||
          typeof seat?.name !== "string" || !seat.name ||
          typeof seat?.ready !== "boolean" ||
          (seat.deck !== null && !normalizeDeckRequest({ deck: seat.deck }))) ||
        !Number.isSafeInteger(roomArchive.roomVersion) ||
        roomArchive.roomVersion < 1 ||
        !Number.isSafeInteger(roomArchive.roomEventSeq) ||
        roomArchive.roomEventSeq < 0 ||
        !Array.isArray(roomArchive.roomEventLog) ||
        roomArchive.roomEventLog.length !== roomArchive.roomEventSeq ||
        roomArchive.roomEventLog.some((event, index) =>
          event?.seq !== index + 1 || event?.roomId !== roomArchive.roomId) ||
        !Array.isArray(roomArchive.processedCommands) ||
        (roomArchive.processedRoomRequests !== undefined &&
          !Array.isArray(roomArchive.processedRoomRequests))) {
      throw new Error("Invalid server room archive");
    }
    if (!roomArchive.processedCommands.every(command =>
      isRecord(command) &&
      typeof command.commandId === "string" && command.commandId.length > 0 &&
      typeof command.playerId === "string" && expectedSeatIds.includes(command.playerId) &&
      typeof command.payloadHash === "string" && command.payloadHash.length > 0 &&
      typeof command.appliedVersion === "number" &&
      Number.isSafeInteger(command.appliedVersion) && command.appliedVersion >= 0 &&
      typeof command.eventSeq === "number" &&
      Number.isSafeInteger(command.eventSeq) && command.eventSeq >= 0
    ) || new Set(roomArchive.processedCommands.map(command =>
      (command as { commandId?: unknown })?.commandId
    )).size !== roomArchive.processedCommands.length) {
      throw new Error("Room archive contains an invalid processed command");
    }
    const processedRoomRequests = roomArchive.processedRoomRequests ?? [];
    if (!processedRoomRequests.every(request =>
      isRecord(request) &&
      typeof request.requestId === "string" && request.requestId.length > 0 &&
      typeof request.playerId === "string" &&
      expectedSeatIds.includes(request.playerId) &&
      typeof request.payloadHash === "string" && request.payloadHash.length > 0 &&
      typeof request.roomVersion === "number" &&
      Number.isSafeInteger(request.roomVersion) && request.roomVersion >= 1 &&
      typeof request.roomEventSeq === "number" &&
      Number.isSafeInteger(request.roomEventSeq) && request.roomEventSeq >= 0
    ) || new Set(processedRoomRequests.map(request =>
      requestKey(
        (request as ProcessedRoomRequest).playerId,
        (request as ProcessedRoomRequest).requestId
      )
    )).size !== processedRoomRequests.length) {
      throw new Error("Room archive contains an invalid processed room request");
    }
    const duelCommandAttempts = roomArchive.duelCommandAttempts ?? [];
    if (!duelCommandAttempts.every(attempt =>
      isRecord(attempt) &&
      typeof attempt.playerId === "string" && expectedSeatIds.includes(attempt.playerId) &&
      typeof attempt.commandId === "string" && attempt.commandId.length > 0 &&
      typeof attempt.payloadHash === "string" && /^[a-f0-9]{64}$/.test(attempt.payloadHash) &&
      isRecord(attempt.ack) && attempt.ack.type === "error" &&
      typeof attempt.ack.message === "string" && attempt.ack.message.length > 0
    ) || new Set(duelCommandAttempts.map(attempt =>
      requestKey(
        (attempt as PersistedDuelCommandAttempt).playerId,
        (attempt as PersistedDuelCommandAttempt).commandId
      )
    )).size !== duelCommandAttempts.length) {
      throw new Error("Room archive contains an invalid duel command attempt");
    }
    if (roomArchive.rulesetId === DUEL_RULESET_ID) {
      const runtimeMode = roomArchive.runtimeMode ?? "legacy-p4";
      if (runtimeMode !== "legacy-p4" && runtimeMode !== "engine-v2") throw new TypeError("Invalid duel runtime mode");
      const duel = roomArchive.journal;
      const engineJournal = roomArchive.engineRuntimeJournal;
      const everySeatReady = roomArchive.seats.length === 2 &&
        roomArchive.seats.every(seat => seat.ready && seat.deck !== null);
      const gameStartedEvents = roomArchive.roomEventLog.filter(event => event.type === "game-started").length;
      if (runtimeMode === "legacy-p4" && engineJournal !== undefined ||
          runtimeMode === "engine-v2" && roomArchive.journal !== undefined ||
          runtimeMode === "engine-v2" && roomArchive.duelCommandAttempts !== undefined ||
          runtimeMode === "legacy-p4" && roomArchive.seats.length < 1 ||
          roomArchive.state !== null || !catalog ||
          roomArchive.roomEventLog[0]?.type !== "room-created" ||
          roomArchive.roomEventLog.filter(event => event.type === "player-joined").length !==
            roomArchive.seats.length ||
          roomArchive.roomEventLog.some(event => event.type === "player-ready" &&
            !expectedSeatIds.includes(event.playerId)) ||
          (runtimeMode === "legacy-p4" && (duel === undefined || (duel !== null && !isJournal(duel)))) ||
          (runtimeMode === "engine-v2" && engineJournal === undefined) ||
          roomArchive.processedCommands.length !== 0 ||
          gameStartedEvents !==
            ((runtimeMode === "legacy-p4" ? duel : engineJournal) === null ? 0 : 1) ||
          (roomArchive.engineMulligan != null && (
            runtimeMode !== "engine-v2" || roomArchive.seats.length !== 2 ||
            engineJournal !== null ||
            roomArchive.seats.some(seat => !seat.ready || seat.deck === null) ||
            (roomArchive.engineMulligan.firstPlayer !== "A" && roomArchive.engineMulligan.firstPlayer !== "B") ||
            !Array.isArray(roomArchive.engineMulligan.battlefieldChoice) ||
            roomArchive.engineMulligan.battlefieldChoice.length !== 2 ||
            roomArchive.engineMulligan.battlefieldChoice.some(value => !Number.isInteger(value) || value < 0 || value > 2) ||
            !isRestorableMulliganChoices(
              roomArchive.engineMulligan.choices,
              roomArchive.engineMulligan.firstPlayer
            ))) ||
          // A null engine journal has two valid phases: a pregame waiting room
          // with at most two seats, or the mulligan handoff guarded above.
          // Once both seats are ready the production room enters that handoff,
          // so ready seats without mulligan data are a damaged archive. A
          // non-null journal is a started match and requires the full two-seat
          // roster that its runtime will authenticate again during restore.
          (runtimeMode === "engine-v2" && engineJournal === null && roomArchive.engineMulligan == null &&
            everySeatReady) ||
          (runtimeMode === "engine-v2" && engineJournal !== null &&
            (roomArchive.engineMulligan != null || !everySeatReady)) ||
          roomArchive.seats.some(seat => seat.ready && seat.deck === null) ||
          roomArchive.seats.some(seat => seat.deck !== null && (
            !normalizeDeckRequest({ deck: seat.deck }) ||
            !(roomArchive.constructedRegion ? validateRegionalCatalogDeck(catalog,seat.deck,roomArchive.constructedRegion) : validateCatalogDeck(catalog,seat.deck)).valid))) {
        throw new Error("Invalid duel room archive and trusted seats");
      }
    } else if (roomArchive.journal !== undefined || roomArchive.engineRuntimeJournal !== undefined ||
        roomArchive.runtimeMode !== undefined || roomArchive.duelCommandAttempts !== undefined) {
      throw new Error("Non-duel archive contains duel session");
    }
    if (roomArchive.state !== null) {
      if (typeof roomArchive.state !== "object" ||
          Array.isArray(roomArchive.state)) {
        throw new Error("Invalid server room archive");
      }
      const state = roomArchive.state as GameState;
      if (!isRecord(state.rules) ||
          state.rules.rulesetId !== roomArchive.rulesetId ||
          !Array.isArray(state.players) || state.players.length !== 2 ||
          state.players.some(player =>
            !isRecord(player) ||
            !expectedSeatIds.includes(player.id as PlayerId))) {
        throw new Error("Room archive state does not match its seats or rules");
      }
    }
    const room = new GameRoom(roomArchive.roomId, roomArchive.rulesetId, catalog, undefined,
      undefined, roomArchive.constructedRegion, undefined, roomArchive.runtimeMode ?? "legacy-p4");
    room.restoreArchive(roomArchive);
    return room;
  }

  /** Roll back a failed durable transaction while retaining socket bindings. */
  restoreArchive(archive: RoomArchive): void {
    if (archive.roomId !== this.roomId || archive.rulesetId !== this.rulesetId ||
        JSON.stringify(archive.constructedRegion) !== JSON.stringify(this.constructedRegion)) {
      throw new Error("Cannot restore a different room");
    }
    validateRoomChatArchive(archive);
    const copy = structuredClone(archive);
    validateRoomChatArchive(copy);
    if (copy.roomChat) {
      const seatsById = new Map(copy.seats.map(seat => [seat.id, seat.name]));
      for (const message of copy.roomChat.messages) {
        if (!seatsById.has(message.playerId) || seatsById.get(message.playerId) !== message.playerName) {
          throw new Error("Room chat archive contains an unknown seat or forged player name");
        }
      }
    }
    if (copy.duelSession !== undefined || copy.duelJournal !== undefined ||
        copy.duelProfile !== undefined || copy.duelRuntimeProfile !== undefined) {
      throw new TypeError("Invalid private duel archive: historical metadata cannot select the current executor");
    }
    const duel = copy.journal;
    const engineJournal = copy.engineRuntimeJournal;
    if (this.rulesetId === DUEL_RULESET_ID && this.runtimeMode === "legacy-p4" &&
        (!this.catalog || copy.state !== null ||
          duel === undefined || (duel !== null && !isJournal(duel)) ||
          copy.processedCommands.length !== 0 ||
          copy.seats.some(seat => seat.deck !== null && (
            !normalizeDeckRequest({ deck: seat.deck }) ||
            !this.validateDeckForRoom(seat.deck).valid)) ||
          (duel && (copy.seats.length !== 2 ||
            copy.seats.some(seat => !seat.ready || !seat.deck))))) {
      throw new Error("Invalid private duel archive");
    }
    if (this.rulesetId === DUEL_RULESET_ID && this.runtimeMode === "engine-v2" &&
        (copy.journal !== undefined || engineJournal === undefined)) {
      throw new Error("Invalid engine runtime archive");
    }
    if (this.rulesetId !== DUEL_RULESET_ID && (copy.journal !== undefined || copy.engineRuntimeJournal !== undefined)) {
      throw new Error("Unexpected duel session in legacy archive");
    }
    // An acknowledged CAS head is authoritative even if the room metadata save failed.
    // Reopening the server loads that protected head; it must never be rolled back here.
    const validatedRuntime = this.runtimeMode === "legacy-p4" && duel
      ? CurrentDuelRuntime.restore(this.runtimeOptions(copy.seats), duel) : null;
    const restoredBattlefieldChoice = engineJournal?.header.setup?.battlefieldChoice ?? null;
    const restoredMulligans = engineJournal?.header.setup?.mulligans ?? null;
    const validatedEngineRuntime = this.runtimeMode === "engine-v2" && engineJournal
      ? createEngineRuntime(this.engineRuntimeOptions(copy.seats, restoredBattlefieldChoice,
        restoredMulligans ?? undefined)).restore(engineJournal) : null;
    const restoredRuntime = this.duelRuntime?.isDurable ? this.duelRuntime : validatedRuntime;
    this.seats.clear();
    for (const seat of copy.seats) this.seats.set(seat.id, seat);
    this.state = copy.state;
    this.duelRuntime = restoredRuntime;
    this.publicEngineEventCaches.clear();
    this.engineRuntime = validatedEngineRuntime;
    this.engineMulligan = copy.engineMulligan ?? null;
    if (this.engineMulligan) this.mulliganProbe("A");
    this.roomVersion = copy.roomVersion;
    this.roomEventSeq = copy.roomEventSeq;
    this.roomEventLog.splice(0, this.roomEventLog.length, ...copy.roomEventLog);
    this.processedCommands.clear();
    for (const command of copy.processedCommands) {
      this.processedCommands.set(command.commandId, command);
    }
    const processedRoomRequests = copy.processedRoomRequests ?? [];
    this.processedRoomRequests.clear();
    for (const request of processedRoomRequests) {
      this.processedRoomRequests.set(requestKey(request.playerId, request.requestId), request);
    }
    this.duelCommandAttempts.clear();
    for (const attempt of copy.duelCommandAttempts ?? []) {
      this.duelCommandAttempts.set(requestKey(attempt.playerId, attempt.commandId), attempt);
    }
    this.engineMulliganReceipts.clear();
    for (const receipt of copy.engineMulliganReceipts ?? []) {
      this.engineMulliganReceipts.set(requestKey(receipt.playerId, receipt.commandId), receipt);
    }
    this.roomChat.restore(copy.roomChat?.messages ?? []);
  }

  get playerCount(): number {
    return this.seats.size;
  }

  get connectedPlayerCount(): number {
    return this.players.size;
  }

  get currentRoomVersion(): number {
    return this.roomVersion;
  }

  get currentRoomEventSeq(): number {
    return this.roomEventSeq;
  }

  get currentChatSeq(): number {
    return this.roomChat.currentSeq;
  }

  chatMessages(): readonly RoomChatMessage[] {
    return this.roomChat.messages.map(message => ({ ...message }));
  }

  roomEvents(): readonly RoomEvent[] {
    return [...this.roomEventLog];
  }

  get status(): RoomView["status"] {
    const duel = this.duelMatch;
    const engine = this.engineProjection;
    if (this.state?.phase === "ended" ||
        (duel?.stage === "playing" && duel.frame.phase === "ended") ||
        engine?.phase === "ended") return "ended";
    if (this.hasGame) return "playing";
    return "waiting";
  }

  join(
    playerName: string,
    transport: ServerTransport,
    connectionId: string = randomUUID()
  ): RoomConnection {
    if (this.seats.size >= 2) {
      throw new RoomError("Room already has two players", "room-full");
    }

    const playerId: PlayerId = this.seats.size === 0 ? "player-1" : "player-2";
    const resumeToken = randomBytes(24).toString("base64url");
    const connection: RoomConnection = {
      playerId,
      resumeToken,
      connectionId,
      send: transport
    };

    this.seats.set(playerId, {
      id: playerId,
      name: playerName,
      resumeToken,
      ready: false,
      deck: null
    });
    this.players.set(playerId, connection);
    this.appendRoomEvent({ type: "player-joined", playerId });
    return connection;
  }

  start(): void {
    if (this.seats.size !== 2) {
      throw new RoomError("Room needs two players", "command-rejected");
    }
    if (this.hasGame) {
      throw new RoomError("Game already started", "command-rejected");
    }

    if (this.rulesetId === DUEL_RULESET_ID && this.runtimeMode === "engine-v2") {
      if (!this.catalog) throw new RoomError("The card catalog is unavailable", "command-rejected");
      const trustedSeats = [...this.seats.values()];
      if (trustedSeats.some(seat => !seat.ready || !seat.deck || !this.players.has(seat.id))) {
        throw new RoomError("Every player must submit a deck and be ready", "invalid-deck");
      }
      this.engineMulligan = null;
      this.mulliganProbe("A");
    } else if (this.rulesetId === DUEL_RULESET_ID) {
      if (!this.catalog) {
        throw new RoomError("The card catalog is unavailable", "command-rejected");
      }
      const trustedSeats = [...this.seats.values()];
      if (trustedSeats.some(seat => !seat.ready || !seat.deck || !this.players.has(seat.id))) {
        throw new RoomError("Every player must submit a deck and be ready", "invalid-deck");
      }
      this.duelRuntime = CurrentDuelRuntime.create(this.runtimeOptions());
    } else if (this.rulesetId === FOUNDATION_RULESET_ID) {
      if (this.seats.size !== 2) {
        throw new RoomError("Room needs two players", "command-rejected");
      }
      if (!this.catalog) {
        throw new RoomError("The card catalog is unavailable", "command-rejected");
      }
      const seats = [...this.seats.values()].map(seat => {
        if (!seat.deck) {
          throw new RoomError("Every player must submit a deck", "invalid-deck");
        }
        if (!seat.ready) {
          throw new RoomError("Every player must be ready", "command-rejected");
        }
        if (!this.players.has(seat.id)) {
          throw new RoomError("Every player must be connected", "command-rejected");
        }
        return {
          id: seat.id,
          name: seat.name,
          deck: seat.deck
        };
      });
      this.state = createFoundationGame(
        seats,
        this.catalog.publicCatalog.cards
      );
    } else {
      const players = [...this.seats.values()].map(seat => ({
        id: seat.id,
        name: seat.name
      }));
      this.state = createInitialGame({
        players
      });
    }
    if (this.engineMulligan === null) this.appendRoomEvent({ type: "game-started" });
  }

  authenticate(token: string): Seat | null {
    for (const seat of this.seats.values()) {
      if (timingSafeEqual(token, seat.resumeToken)) return seat;
    }
    return null;
  }

  reconnect(
    resumeToken: string,
    transport: ServerTransport,
    connectionId: string
  ): RoomConnection | null {
    const seat = this.authenticate(resumeToken);
    if (!seat) return null;

    const connection: RoomConnection = {
      playerId: seat.id,
      resumeToken: seat.resumeToken,
      connectionId,
      send: transport
    };
    this.players.set(seat.id, connection);
    this.appendRoomEvent({ type: "player-reconnected", playerId: seat.id });
    return connection;
  }

  /**
   * Remove a connection only if it is still the active one. This prevents a
   * delayed close event from an old socket evicting a newly resumed socket.
   */
  disconnect(playerId: PlayerId, connectionId: string): boolean {
    const current = this.players.get(playerId);
    if (!current || current.connectionId !== connectionId) return false;

    this.players.delete(playerId);
    this.appendRoomEvent({ type: "player-disconnected", playerId });
    return true;
  }

  isCurrentConnection(playerId: PlayerId, connectionId: string): boolean {
    return this.players.get(playerId)?.connectionId === connectionId;
  }

  projectionFor(playerId: PlayerId): GameProjection | null {
    return this.state ? projectGame(this.state, playerId) : null;
  }

  sendProjection(playerId: PlayerId, transport: ServerTransport): void {
    // Resume of a waiting room has no match/projection; still send a private echo.
    // Do not prepend it to an active projection's existing message sequence.
    if (!this.hasGame) this.sendOwnerDeckConfirmation(playerId);
    if (this.duelRuntime) {
      transport({ type: "duel-projection", roomId: this.roomId,
        projection: this.duelRuntime.project(playerId) });
      return;
    }
    if (this.engineMulligan) {
      transport({
        type: "projection",
        protocolVersion: "2.0.0",
        projection: this.publicEngineProjection(this.setupMulliganProjection(playerId)),
      } as unknown as ServerToClientMessage);
      return;
    }
    if (this.engineRuntime) {
      const message = {
        type: "projection",
        protocolVersion: "2.0.0",
        projection: this.publicEngineProjection(this.engineRuntime.projectFor(this.enginePlayerId(playerId))),
      } as unknown as ServerToClientMessage;
      transport(message);
      return;
    }
    const projection = this.projectionFor(playerId);
    if (projection) {
      transport({ type: "projection", roomId: this.roomId, projection });
    }
  }

  broadcastProjections(): void {
    if (!this.hasGame) return;
    for (const [playerId, connection] of this.players) {
      this.sendProjection(playerId, connection.send);
    }
  }

  roomView(): RoomView {
    return {
      roomId: this.roomId,
      status: this.status,
      rulesetId: this.rulesetId,
      version: this.duelMatch?.stateVersion ?? this.engineProjection?.stateVersion ?? this.state?.version ?? 0,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      ...(this.constructedRegion ? {constructedRegion:this.constructedRegion} : {}),
      players: this.roomPlayers()
    };
  }

  broadcastRoom(): void {
    const room = this.roomView();
    for (const connection of this.players.values()) {
      // Preserve the last-room-packet contract for active match consumers;
      // the lobby needs its public room clock before the owner echo.
      if (room.status !== "waiting") this.sendOwnerDeckConfirmation(connection.playerId);
      connection.send({ type: "room", room });
      if (room.status === "waiting") this.sendOwnerDeckConfirmation(connection.playerId);
    }
  }

  private sendOwnerDeckConfirmation(playerId: PlayerId): void {
    if ((this.rulesetId !== FOUNDATION_RULESET_ID && this.rulesetId !== DUEL_RULESET_ID) ||
        !this.catalog) return;
    const connection = this.players.get(playerId);
    const seat = this.seats.get(playerId);
    if (!connection || !seat || connection.resumeToken !== seat.resumeToken) return;

    // Validation accepts multiple entries for the same printing. Preserve all
    // copies while converting the private inventory into unique per-zone counts;
    // neither source order nor locale-specific sorting participates in identity.
    const deck = seat.deck && this.validateDeckForRoom(seat.deck).valid
      ? this.ownerDeckEcho(seat.deck)
      : null;
    const message: OwnerDeckConfirmationMessage = {
      type: "owner-deck-confirmation",
      schema: OWNER_DECK_CONFIRMATION_SCHEMA,
      roomId: this.roomId,
      playerId: seat.id,
      rulesetId: this.rulesetId as typeof FOUNDATION_RULESET_ID | typeof DUEL_RULESET_ID,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      catalog: {
        dataVersion: this.catalog.publicCatalog.dataVersion,
        digest: this.catalog.publicCatalog.digest
      },
      deck
    };
    connection.send(message);
  }

  private ownerDeckEcho(deck: RoomDeckSubmission): OwnerDeckEcho {
    const result: Partial<Record<(typeof OWNER_DECK_ZONES)[number], {
      cardId: string; quantity: number
    }[]>> = {};
    for (const zone of OWNER_DECK_ZONES) {
      const entries = deck[zone];
      if (!entries) continue;
      const totals = new Map<string, number>();
      for (const { cardId, quantity } of entries) {
        const sum = (totals.get(cardId) ?? 0) + quantity;
        if (!Number.isSafeInteger(sum)) throw new Error("Invalid validated deck count");
        totals.set(cardId, sum);
      }
      result[zone] = [...totals].map(([cardId, quantity]) => ({ cardId, quantity }));
    }
    return result;
  }

  sendEvents(
    session: ClientSession,
    connectionId: string,
    afterEventSeq: number
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.duelMatch || this.engineProjection) {
      this.validateGameEventCursor(session, connectionId, afterEventSeq);
      // The Duel event log is not public: a current projection resynchronizes
      // state but does not pretend to replay the missing historical events.
      this.sendProjection(playerId, this.players.get(playerId)!.send);
      return;
    }
    if (!this.state) {
      if (afterEventSeq === 0 && this.isEngineV2WaitingRoom()) return;
      throw new RoomError(
        "Game events are not available before the game starts",
        "command-rejected"
      );
    }
    if (afterEventSeq > this.state.eventSeq) {
      throw new RoomError(
        "Event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }

    this.players.get(playerId)?.send({
      type: "events",
      roomId: this.roomId,
      afterEventSeq,
      nextEventSeq: this.state.eventSeq,
      version: this.state.version,
      events: projectGame(this.state, playerId).events.filter(
        event => event.seq > afterEventSeq
      )
    });
  }

  sendRoomEvents(
    session: ClientSession,
    connectionId: string,
    afterRoomEventSeq: number
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (afterRoomEventSeq > this.roomEventSeq) {
      throw new RoomError(
        "Room event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }

    this.players.get(playerId)?.send({
      type: "room-events",
      roomId: this.roomId,
      afterRoomEventSeq,
      nextRoomEventSeq: this.roomEventSeq,
      roomVersion: this.roomVersion,
      events: this.roomEventLog.filter(event => event.seq > afterRoomEventSeq)
    });
  }

  validateGameEventCursor(
    session: ClientSession,
    connectionId: string,
    afterEventSeq: number
  ): void {
    this.requireCurrentSession(session, connectionId);
    if (this.duelMatch || this.engineProjection) {
      if (afterEventSeq > (this.duelMatch?.eventSeq ?? this.engineProjection?.eventSeq ?? 0)) {
        throw new RoomError("Event cursor is ahead of the authoritative clock", "command-rejected");
      }
      return;
    }
    if (!this.state) {
      if (afterEventSeq === 0 && this.isEngineV2WaitingRoom()) return;
      throw new RoomError(
        "Game events are not available before the game starts",
        "command-rejected"
      );
    }
    if (afterEventSeq > this.state.eventSeq) {
      throw new RoomError(
        "Event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }
  }

  validateRoomEventCursor(afterRoomEventSeq: number): void {
    if (afterRoomEventSeq > this.roomEventSeq) {
      throw new RoomError(
        "Room event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }
  }

  validateResumeCursors(
    resumeToken: string,
    afterEventSeq?: number,
    afterRoomEventSeq?: number
  ): void {
    const seat = this.authenticate(resumeToken);
    if (!seat) {
      throw new RoomError("Invalid resume token", "invalid-token");
    }

    if (afterEventSeq !== undefined) {
      if (!Number.isSafeInteger(afterEventSeq) || afterEventSeq < 0) {
        throw new RoomError(
          "Event cursor must be a safe non-negative integer",
          "command-rejected"
        );
      }
      if (this.hasGame &&
          afterEventSeq > (this.duelMatch?.eventSeq ?? this.engineProjection?.eventSeq ?? this.state!.eventSeq)) {
        throw new RoomError(
          "Event cursor is ahead of the authoritative log",
          "command-rejected"
        );
      }
      if (!this.hasGame && !(afterEventSeq === 0 && this.isEngineV2WaitingRoom())) {
        throw new RoomError(
          "Game events are not available before the game starts",
          "command-rejected"
        );
      }
    }

    if (afterRoomEventSeq !== undefined) {
      if (!Number.isSafeInteger(afterRoomEventSeq) || afterRoomEventSeq < 0) {
        throw new RoomError(
          "Room event cursor must be a safe non-negative integer",
          "command-rejected"
        );
      }
      if (afterRoomEventSeq > this.roomEventSeq) {
        throw new RoomError(
          "Room event cursor is ahead of the authoritative log",
          "command-rejected"
        );
      }
    }
  }

  private isEngineV2WaitingRoom(): boolean {
    return this.rulesetId === DUEL_RULESET_ID && this.runtimeMode === "engine-v2";
  }

  submitDeck(
    session: ClientSession,
    connectionId: string,
    expectedRoomVersion: number,
    deck: RoomDeckSubmission,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    const payloadHash = hashRoomRequest("submit-deck", playerId, deck);
    const previous = this.findProcessedRoomRequest(playerId, requestId);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new RoomError(
          "Room request id was already used with a different payload",
          "idempotency-conflict"
        );
      }

      transport({
        type: "request-result",
        requestId,
        ok: true,
        roomVersion: previous.roomVersion,
        roomEventSeq: previous.roomEventSeq,
        duplicate: true
      });
      return;
    }
    if (this.hasGame) {
      throw new RoomError("The game has already started", "command-rejected");
    }
    if ((this.rulesetId === FOUNDATION_RULESET_ID || this.rulesetId === DUEL_RULESET_ID) && !this.catalog) {
      throw new RoomError(
        "The card catalog is unavailable",
        "command-rejected"
      );
    }

    const normalized = normalizeDeckRequest({ deck });
    if (!normalized) {
      throw new RoomError("The deck payload is invalid", "invalid-deck");
    }

    if (this.catalog) {
      const validation = this.validateDeckForRoom(normalized);
      if (!validation.valid) {
        throw new RoomError(
          validation.issues[0]?.message ?? "The deck is invalid",
          "invalid-deck"
        );
      }
    }

    this.requireRoomVersion(expectedRoomVersion);
    const seat = this.requireSeat(playerId);
    seat.deck = normalized;
    if (seat.ready) {
      seat.ready = false;
      this.appendRoomEvent({ type: "player-ready", playerId, ready: false });
    }
    this.appendRoomEvent({ type: "deck-submitted", playerId });

    if (this.canStart()) {
      this.start();
    }

    this.recordProcessedRoomRequest(playerId, requestId, payloadHash);
    transport({
      type: "request-result",
      requestId,
      ok: true,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      duplicate: false
    });
    this.broadcastRoom();
    if (this.hasGame) this.broadcastProjections();
  }

  setReady(
    session: ClientSession,
    connectionId: string,
    expectedRoomVersion: number,
    ready: boolean,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    const payloadHash = hashRoomRequest("set-ready", playerId, ready);
    const previous = this.findProcessedRoomRequest(playerId, requestId);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new RoomError(
          "Room request id was already used with a different payload",
          "idempotency-conflict"
        );
      }

      transport({
        type: "request-result",
        requestId,
        ok: true,
        roomVersion: previous.roomVersion,
        roomEventSeq: previous.roomEventSeq,
        duplicate: true
      });
      return;
    }
    if (this.hasGame) {
      throw new RoomError("The game has already started", "command-rejected");
    }

    const seat = this.requireSeat(playerId);
    if (ready && !seat.deck) {
      throw new RoomError(
        "Submit a valid deck before becoming ready",
        "invalid-deck"
      );
    }

    this.requireRoomVersion(expectedRoomVersion);
    seat.ready = ready;
    this.appendRoomEvent({ type: "player-ready", playerId, ready });

    if (this.canStart()) {
      this.start();
    }

    this.recordProcessedRoomRequest(playerId, requestId, payloadHash);
    transport({
      type: "request-result",
      requestId,
      ok: true,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      duplicate: false
    });
    this.broadcastRoom();
    if (this.hasGame) this.broadcastProjections();
  }

  snapshot(viewerPlayerId: PlayerId | null = null): RoomSnapshot | null {
    if (!this.state) return null;

    const snapshot = createRoomSnapshot(this.state, this.roomId, viewerPlayerId);
    return {
      ...snapshot,
      ...(this.constructedRegion ? {constructedRegion:this.constructedRegion} : {}),
      players: this.roomPlayers(),
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      roomEvents: [...this.roomEventLog]
    };
  }

  submit(
    session: ClientSession,
    connectionId: string,
    command: PlayerCommand,
    commandId: string,
    expectedVersion: number,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.rulesetId === DUEL_RULESET_ID) {
      throw new RoomError("Legacy commands are not available in a duel", "command-rejected");
    }
    if (!this.state) {
      throw new RoomError("Game has not started", "command-rejected");
    }

    const payloadHash = hashCommand(this.roomId, playerId, command);
    const previous = this.processedCommands.get(commandId);
    if (previous) {
      if (previous.playerId !== playerId || previous.payloadHash !== payloadHash) {
        throw new RoomError(
          "Command id was already used with a different payload",
          "idempotency-conflict"
        );
      }

      transport({
        type: "request-result",
        requestId,
        ok: true,
        commandId,
        appliedVersion: previous.appliedVersion,
        eventSeq: previous.eventSeq,
        roomVersion: this.roomVersion,
        roomEventSeq: this.roomEventSeq,
        duplicate: true
      });
      this.sendProjection(playerId, transport);
      return;
    }

    if (expectedVersion !== this.state.version) {
      throw new RoomError(
        `Expected version ${expectedVersion}, but authoritative version is ${this.state.version}`,
        "stale-version"
      );
    }

    const actorCommand = commandWithActor(command, playerId);
    const result = submitCommand(this.state, actorCommand);
    if (result.error) {
      throw new RoomError(result.error.message, result.error.code);
    }

    this.state = result.state;
    const appliedVersion = result.state.version;
    const eventSeq = result.state.eventSeq;
    this.processedCommands.set(commandId, {
      commandId,
      playerId,
      payloadHash,
      appliedVersion,
      eventSeq
    });

    transport({
      type: "request-result",
      requestId,
      ok: true,
      commandId,
      appliedVersion,
      eventSeq,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      duplicate: false
    });
    this.broadcastProjections();
    if (this.state.phase === "ended") this.broadcastRoom();
  }

  /** Append an authenticated chat message and broadcast only to current members. */
  sendChat(
    session: ClientSession,
    connectionId: string,
    messageId: string,
    text: string,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    const seat = this.requireSeat(playerId);
    let mutation: ReturnType<RoomChatLedger["append"]>;
    try {
      mutation = this.roomChat.append(playerId, seat.name, messageId, text);
    } catch (error) {
      if (error instanceof RoomChatError) {
        const code = error.reason === "capacity-exceeded"
          ? "capacity-exceeded"
          : error.reason === "idempotency-conflict"
            ? "idempotency-conflict"
            : "command-rejected";
        throw new RoomError(error.message, code);
      }
      throw error;
    }

    transport({
      type: "room-chat-accepted",
      roomId: this.roomId,
      requestId,
      messageId,
      seq: mutation.message.seq,
      duplicate: mutation.duplicate
    });
    if (mutation.duplicate) return;

    const packet: RoomChatServerMessage = {
      type: "room-chat",
      roomId: this.roomId,
      afterChatSeq: mutation.message.seq - 1,
      nextChatSeq: mutation.message.seq,
      messages: [mutation.message]
    };
    this.broadcastChat(packet);
  }

  syncChat(
    session: ClientSession,
    connectionId: string,
    afterChatSeq: number,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    try {
      const messages = this.roomChat.after(afterChatSeq);
      transport({ type: "request-result", requestId, ok: true });
      transport({
        type: "room-chat",
        roomId: this.roomId,
        afterChatSeq,
        nextChatSeq: this.roomChat.currentSeq,
        messages
      });
    } catch (error) {
      if (error instanceof RoomChatError) {
        throw new RoomError(
          "Chat cursor is ahead of the authoritative history",
          "command-rejected"
        );
      }
      throw error;
    }
    // Keep the local variable explicit: authentication above is the only
    // authority used for this read, never a player id supplied by the wire.
    void playerId;
  }

  private broadcastChat(packet: RoomChatServerMessage): void {
    for (const [playerId, connection] of this.players) {
      const seat = this.seats.get(playerId);
      if (!seat || seat.resumeToken !== connection.resumeToken ||
          !this.isCurrentConnection(playerId, connection.connectionId)) continue;
      connection.send(packet);
    }
  }

  /** Execute only a strictly parsed public command for the authenticated current socket. */
  submitDuel(
    session: ClientSession,
    connectionId: string,
    message: DuelCommandMessage | DuelCommandMessageV3Actions1,
    transport: ServerTransport
  ): void | Promise<void> {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.rulesetId !== DUEL_RULESET_ID || this.runtimeMode !== "legacy-p4") {
      throw new RoomError("Duel commands require a duel room", "command-rejected");
    }
    if (!this.duelRuntime) throw new RoomError("Game has not started", "command-rejected");
    if (!isDuelCommandMessageV3Actions1(message))
      throw new RoomError("该房间需要 P4 对局动作协议", "command-rejected");
    const publish = (result: DurableRuntimeResult): void => {
      const ack = result.ack;
      if (ack.requestId !== message.requestId || (ack.commandId !== undefined && ack.commandId !== message.commandId))
        throw new Error("Runtime receipt does not match its request");
      const outbound: unknown = ack.type === "request-result" && ack.ok === true
        ? { type: "request-result", requestId: ack.requestId, commandId: ack.commandId, ok: true,
            appliedVersion: ack.appliedVersion, eventSeq: ack.eventSeq, duplicate: ack.duplicate === true,
            roomVersion: this.roomVersion, roomEventSeq: this.roomEventSeq }
        : { type: "error", requestId: ack.requestId, code: "command-rejected", message: ack.message };
      if (!isServerMessage(outbound)) throw new Error("Runtime returned an invalid public receipt");
      transport(outbound);
      this.broadcastProjections();
      if (this.status === "ended") this.broadcastRoom();
    };
    const attemptKey = requestKey(playerId, message.commandId);
    const payloadHash = hashDuelCommandAttempt(message);
    const expectedStateVersion = this.duelRuntime.stateVersion;
    const prior = this.duelCommandAttempts.get(attemptKey);
    if (prior) {
      const ack: DuelAuthoritativeRuntimeP4Ack = prior.payloadHash === payloadHash
        ? { ...prior.ack, requestId: message.requestId }
        : { type: "error", requestId: message.requestId, commandId: message.commandId,
            code: "command-rejected", message: "命令标识与此前请求冲突" };
      publish({ ack, projection: this.duelRuntime.project(playerId) });
      return;
    }
    const remember = (result: DurableRuntimeResult): void => {
      if (result.ack.type === "error" && message.expectedVersion === expectedStateVersion) {
        this.duelCommandAttempts.set(attemptKey, {
          playerId,
          commandId: message.commandId,
          payloadHash,
          ack: structuredClone(result.ack),
        });
      }
      publish(result);
    };
    const result = this.duelRuntime.dispatch(playerId, message);
    if (result instanceof Promise) return result.then(remember);
    remember(result);
  }

  /** Submit a protocol-v2 command to the new engine runtime owner. */
  submitEngineV2(
    session: ClientSession,
    connectionId: string,
    command: V2Command,
    transport: (message: unknown) => void
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.rulesetId !== DUEL_RULESET_ID || this.runtimeMode !== "engine-v2") {
      throw new RoomError("Protocol v2 commands require an engine-v2 Duel room", "command-rejected");
    }
    if (this.engineMulligan) {
      if (command.type === "mulligan") {
        this.submitMulliganSetup(playerId, command, transport);
        return;
      }
      // CR 117 completes before CR 118 begins. No ordinary game command may
      // implicitly keep both hands or advance either seat's mulligan window.
      // The client must answer the projected choice explicitly, including an
      // empty selection when the player keeps all four cards.
      throw new RoomError("Waiting for both players to finish their Mulligan", "command-rejected");
    }
    if (!this.engineRuntime) {
      throw new RoomError("Game has not started", "command-rejected");
    }
    const result = this.engineRuntime.submit(this.enginePlayerId(playerId), this.engineCommand(command));
    const receipt: V2CommandReceipt = {
      type: "command-receipt",
      protocolVersion: "2.0.0",
      commandId: result.receipt.commandId,
      stateVersion: result.receipt.stateVersion,
      eventSeq: result.receipt.eventSeq,
      accepted: result.receipt.status === "accepted" || result.receipt.status === "duplicate" || result.receipt.status === "pending",
      duplicate: result.receipt.status === "duplicate",
      rejection: result.receipt.status === "rejected" ? result.receipt.error ?? "Command rejected" : null,
    };
    transport(receipt);
    this.broadcastProjections();
    if (this.status === "ended") this.broadcastRoom();
  }

  /** Attach the batch C adapter before accepting commands or resuming a stored room. */
  async enableDurability(directory?: string): Promise<void> {
    if (directory !== undefined) this.storageDirectory = directory;
    if (this.storageDirectory) await this.duelRuntime?.enableDurability(path.join(this.storageDirectory, "duel-journals"));
  }

  async close(): Promise<void> { await this.duelRuntime?.close(); }

  get runtimeClock(): { stateVersion: number; eventSeq: number } {
    return { stateVersion: this.duelRuntime?.stateVersion ?? this.engineProjection?.stateVersion ?? this.state?.version ?? 0,
      eventSeq: this.duelRuntime?.eventSeq ?? this.engineProjection?.eventSeq ?? this.state?.eventSeq ?? 0 };
  }

  get currentJournalRevision(): number {
    return this.duelRuntime?.exportJournal().integrity.revision ?? this.engineRuntime?.journal().integrity.revision ?? 0;
  }

  private canStart(): boolean {
    return (this.rulesetId === FOUNDATION_RULESET_ID || this.rulesetId === DUEL_RULESET_ID) &&
      this.seats.size === 2 &&
      [...this.seats.values()].every(seat =>
        seat.ready &&
        seat.deck !== null &&
        this.players.has(seat.id)
      );
  }

  private appendRoomEvent(
    event: DistributiveOmit<RoomEvent, "roomId" | "seq">
  ): void {
    this.roomEventSeq += 1;
    this.roomVersion += 1;
    this.roomEventLog.push({
      ...event,
      seq: this.roomEventSeq,
      roomId: this.roomId
    });
  }

  private requireSeat(playerId: PlayerId): Seat {
    const seat = this.seats.get(playerId);
    if (!seat) {
      throw new RoomError("Invalid player session", "invalid-token");
    }
    return seat;
  }

  private requireRoomVersion(expectedRoomVersion: number): void {
    if (expectedRoomVersion !== this.roomVersion) {
      throw new RoomError(
        `Expected room version ${expectedRoomVersion}, but authoritative room version is ${this.roomVersion}`,
        "stale-version"
      );
    }
  }

  private findProcessedRoomRequest(
    playerId: PlayerId,
    requestId: string
  ): ProcessedRoomRequest | undefined {
    return this.processedRoomRequests.get(requestKey(playerId, requestId));
  }

  private recordProcessedRoomRequest(
    playerId: PlayerId,
    requestId: string,
    payloadHash: string
  ): void {
    this.processedRoomRequests.set(requestKey(playerId, requestId), {
      playerId,
      requestId,
      payloadHash,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq
    });
  }

  private requireCurrentSession(
    session: ClientSession,
    connectionId: string
  ): PlayerId {
    const playerId = this.requireSession(session);
    if (!this.isCurrentConnection(playerId, connectionId)) {
      throw new RoomError(
        "The session was replaced by a newer connection",
        "session-replaced"
      );
    }
    return playerId;
  }

  private requireSession(session: ClientSession): PlayerId {
    if (session.roomId !== this.roomId) {
      throw new RoomError("Session belongs to another room", "invalid-token");
    }

    const seat = this.seats.get(session.playerId);
    if (!seat || !timingSafeEqual(session.resumeToken, seat.resumeToken)) {
      throw new RoomError("Invalid player session", "invalid-token");
    }

    return seat.id;
  }

  private roomPlayers(): readonly RoomPlayer[] {
    return [...this.seats.values()].map(seat => ({
      id: seat.id,
      name: seat.name,
      connected: this.players.has(seat.id),
      ready: seat.ready,
      deckSubmitted: seat.deck !== null
    }));
  }
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode
  ) {
    super(message);
    this.name = "RoomError";
  }
}

function isRestorableMulliganChoices(
  choices: unknown,
  firstPlayer: "A" | "B"
): boolean {
  if (!Array.isArray(choices) || choices.length !== 2) return false;
  const firstIndex = firstPlayer === "A" ? 0 : 1;
  const otherIndex = firstIndex === 0 ? 1 : 0;
  const firstChoice = choices[firstIndex];
  const otherChoice = choices[otherIndex];
  if (firstChoice === null) return otherChoice === null;
  const isFirstChoice = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.length <= 2 &&
    value.every(cardId => typeof cardId === "string" && cardId.length > 0) &&
    new Set(value).size === value.length;
  return isFirstChoice(firstChoice) && otherChoice === null;
}

function commandWithActor(command: PlayerCommand, playerId: PlayerId): Command {
  switch (command.type) {
    case "pass":
      return { type: "pass", playerId };
    case "concede":
      return { type: "concede", playerId };
    case "play-card":
      return {
        type: "play-card",
        playerId,
        instanceId: command.instanceId,
        ...(command.targets === undefined ? {} : { targets: command.targets })
      };
    case "respond-to-prompt":
      return {
        type: "respond-to-prompt",
        playerId,
        promptId: command.promptId,
        optionId: command.optionId,
        ...(command.stateVersion === undefined
          ? {}
          : { stateVersion: command.stateVersion })
      };
  }
}

function hashCommand(
  roomId: string,
  playerId: PlayerId,
  command: PlayerCommand
): string {
  return createHash("sha256")
    .update(stableStringify({ roomId, playerId, command }))
    .digest("hex");
}

function hashDuelCommandAttempt(command: DuelCommandMessageV3Actions1): string {
  return createHash("sha256")
    .update(stableStringify({ expectedVersion: command.expectedVersion,
      command: command.command }))
    .digest("hex");
}

function hashEngineMulliganCommand(command: Extract<V2Command, { readonly type: "mulligan" }>): string {
  return createHash("sha256")
    .update(stableStringify({
      type: command.type,
      selectedObjectIds: command.selectedObjectIds,
      selectedUIDs: command.selectedUIDs,
    }))
    .digest("hex");
}

function hashRoomRequest(
  requestType: "submit-deck" | "set-ready",
  playerId: PlayerId,
  payload: unknown
): string {
  return createHash("sha256")
    .update(stableStringify({ requestType, playerId, payload }))
    .digest("hex");
}

function requestKey(playerId: PlayerId, requestId: string): string {
  return `${playerId}\0${requestId}`;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function timingSafeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let result = 0;
  for (let index = 0; index < actual.length; index++) {
    result |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return result === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRoomChatArchive(archive: RoomArchive): void {
  if (!isRecord(archive)) return;
  const archiveRoomChatDescriptor = Object.getOwnPropertyDescriptor(archive, "roomChat");
  if (!archiveRoomChatDescriptor) return;
  if (archiveRoomChatDescriptor.get !== undefined || archiveRoomChatDescriptor.set !== undefined) {
    throw new Error("Invalid room chat archive shape");
  }
  const roomChat = archive.roomChat;
  let roomChatPrototype: object | null;
  try {
    roomChatPrototype = isRecord(roomChat) ? Object.getPrototypeOf(roomChat) : null;
  } catch {
    throw new Error("Invalid room chat archive shape");
  }
  if (!isRecord(roomChat) || (roomChatPrototype !== Object.prototype && roomChatPrototype !== null) ||
      Reflect.ownKeys(roomChat).length !== 1 || Reflect.ownKeys(roomChat)[0] !== "messages" ||
      Object.getOwnPropertyDescriptor(roomChat, "messages")?.get !== undefined ||
      Object.getOwnPropertyDescriptor(roomChat, "messages")?.set !== undefined ||
      !Array.isArray(roomChat.messages) || roomChat.messages.length === 0) {
    throw new Error("Invalid room chat archive shape");
  }
  try {
    validateRoomChatMessages(roomChat.messages);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid room chat archive");
  }
}

export function createRoomId(): string {
  return randomUUID().slice(0, 8);
}
