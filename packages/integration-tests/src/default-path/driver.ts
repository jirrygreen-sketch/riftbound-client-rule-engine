import { createHash } from "node:crypto";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  DUEL_RULESET_ID,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionV3Actions1,
  isServerMessage,
  type ClientSession,
  type DuelActionV3Actions1,
  type DuelProjectionV3Actions1,
  type DuelWireCommandV3Actions1,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../../../apps/game-server/src/card-catalog.js";
import { GameRoom } from "../../../../apps/game-server/src/room.js";
import { DECK_FIXTURE, realDecks } from "./decks.js";

export const DEFAULT_ROOM_PROFILE = "p4";
export const DEFAULT_RUNTIME_PROFILE = "optional-unit-choice-clock-v4";
export const PLAYERS = ["player-1", "player-2"] as const;
export type Player = typeof PLAYERS[number];
export type PlayingView = DuelProjectionV3Actions1 & {
  match: Extract<DuelProjectionV3Actions1["match"], { stage: "playing" }>;
};
type WireEvent = { readonly recipient: Player; readonly message: ServerToClientMessage };
type Receipt = Extract<ServerToClientMessage, { type: "request-result" | "error" }>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")).map(
      ([key, entry]) => [key, canonical(entry)]
    )
  );
  return value;
}

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

export class ProjectionNormalizer {
  private readonly identifiers = new Map<string, string>();

  normalize(value: unknown): unknown {
    if (typeof value === "string") return value.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      identifier => {
        let alias = this.identifiers.get(identifier);
        if (!alias) {
          alias = `uid-${String(this.identifiers.size + 1).padStart(3, "0")}`;
          this.identifiers.set(identifier, alias);
        }
        return alias;
      }
    );
    if (Array.isArray(value)) return value.map(entry => this.normalize(entry));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [this.normalize(key), this.normalize(entry)])
    );
    return value;
  }
}

function summary(projection: DuelProjectionV3Actions1, normalizer: ProjectionNormalizer) {
  const match = projection.match;
  return {
    hash: digest(normalizer.normalize(projection)),
    viewer: projection.viewerPlayerId,
    schema: projection.projectionSchema,
    stage: match.stage,
    stateVersion: match.stateVersion,
    eventSeq: match.eventSeq,
    ...(match.stage === "setup" ? { setup: normalizer.normalize(match.setup) } : {
      frame: normalizer.normalize(match.frame),
      players: normalizer.normalize(match.players.map(player => ({
        playerId: player.playerId, handCount: player.handCount, mainDeckCount: player.mainDeckCount,
        ...(player.hand ? { hand: player.hand } : {}), trash: player.trash,
        champion: player.champion, legend: player.legend
      }))),
      resources: normalizer.normalize({ players: match.resources.players,
        bases: match.resources.bases.map(base => ({ playerId: base.playerId,
          runes: base.baseRunes.map(rune => ({ uid: rune.uid, domain: rune.domain, readied: rune.readied })),
          goldTokens: base.goldTokens })) }),
      board: normalizer.normalize({ battlefields: match.board.battlefields,
        units: match.board.units, gears: match.board.gears }),
      scoring: normalizer.normalize(match.scoring)
    }),
    actions: normalizer.normalize(projection.actions.map(({ id: _id, label: _label, ...action }) => action))
  };
}

function seededRandomIndex(seed: number) {
  let state = seed >>> 0;
  return (bound: number) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return Math.floor(state / 0x1_0000_0000 * bound);
  };
}

export class DefaultPathDriver {
  readonly steps: unknown[] = [];
  readonly normalizer = new ProjectionNormalizer();
  private readonly sessions = new Map<Player, ClientSession>();
  private readonly projections = new Map<Player, DuelProjectionV3Actions1>();
  private readonly messages: WireEvent[] = [];
  private commandNumber = 0;
  private roomEventCursor = 0;

  private constructor(readonly room: GameRoom, readonly seed: number,
    readonly catalog: Awaited<ReturnType<typeof loadCardCatalogRuntime>>) {}

  static async create(seed = 77): Promise<DefaultPathDriver> {
    const catalog = await loadCardCatalogRuntime();
    for (const [name, deck] of Object.entries(realDecks)) {
      const validation = validateCatalogDeck(catalog, deck);
      if (!validation.valid) throw new Error(`Real deck ${name} is invalid: ${JSON.stringify(validation.issues)}`);
    }
    const room = new GameRoom("default-path", DUEL_RULESET_ID, catalog,
      seededRandomIndex(seed), DEFAULT_ROOM_PROFILE, undefined, DEFAULT_RUNTIME_PROFILE);
    const driver = new DefaultPathDriver(room, seed, catalog);
    for (const [index, player] of PLAYERS.entries()) {
      const connection = room.join(index === 0 ? "Alice" : "Bob", driver.transport(player), player);
      driver.sessions.set(player, { roomId: room.roomId, playerId: player, resumeToken: connection.resumeToken });
    }
    room.broadcastRoom();
    for (const [index, player] of PLAYERS.entries()) {
      room.submitDeck(driver.session(player), player, room.roomView().roomVersion,
        index === 0 ? realDecks.a : realDecks.b, `deck-${player}`, driver.transport(player));
    }
    for (const player of PLAYERS) room.setReady(driver.session(player), player, room.roomView().roomVersion,
      true, `ready-${player}`, driver.transport(player));
    const archive = room.exportArchive();
    if (archive.duelProfile !== DEFAULT_ROOM_PROFILE || archive.duelRuntimeProfile !== DEFAULT_RUNTIME_PROFILE ||
        archive.duelJournal?.schemaVersion !== 7 || archive.duelJournal.profile !== DEFAULT_RUNTIME_PROFILE) {
      throw new Error("The room did not construct the CLI default P4 recorded runtime (schema 7)");
    }
    driver.checkpoint("room-ready");
    return driver;
  }

  private session(player: Player): ClientSession {
    const session = this.sessions.get(player);
    if (!session) throw new Error(`No room session for ${player}`);
    return session;
  }

  private transport(recipient: Player) {
    return (message: ServerToClientMessage) => {
      if (!isServerMessage(message)) throw new Error(`Invalid room wire message: ${JSON.stringify(message)}`);
      this.messages.push({ recipient, message });
      if (message.type === "duel-projection") {
        if (!isDuelProjectionV3Actions1(message.projection)) throw new Error("Expected P4 public projection");
        this.projections.set(recipient, message.projection);
      }
    };
  }

  view(player: Player = "player-1"): DuelProjectionV3Actions1 {
    const projection = this.projections.get(player);
    if (!projection) throw new Error(`No projection for ${player}`);
    return projection;
  }

  playing(player: Player = "player-1"): PlayingView {
    const projection = this.view(player);
    if (projection.match.stage !== "playing") throw new Error("Expected the room to be playing");
    return projection as PlayingView;
  }

  action<Kind extends DuelActionV3Actions1["kind"]>(player: Player, kind: Kind,
    predicate: (action: Extract<DuelActionV3Actions1, { kind: Kind }>) => boolean = () => true) {
    const action = this.view(player).actions.find(candidate => candidate.kind === kind && candidate.enabled &&
      predicate(candidate as Extract<DuelActionV3Actions1, { kind: Kind }>));
    if (!action) throw new Error(`Missing enabled ${kind} for ${player}: ${JSON.stringify(this.view(player))}`);
    return action as Extract<DuelActionV3Actions1, { kind: Kind }>;
  }

  send(player: Player, command: DuelWireCommandV3Actions1, label: string,
    options: { readonly expectedVersion?: number; readonly reject?: boolean } = {}): Receipt {
    const packet = {
      type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: `request-${++this.commandNumber}`, commandId: `command-${this.commandNumber}`,
      expectedVersion: options.expectedVersion ?? this.view(player).match.stateVersion, command
    } as const;
    if (!isDuelCommandMessageV3Actions1(packet)) throw new Error(`Invalid scripted command: ${JSON.stringify(packet)}`);
    this.room.submitDuel(this.session(player), player, packet, this.transport(player));
    const receipt = this.messages.map(event => event.message).find(
      (message): message is Receipt => (message.type === "request-result" || message.type === "error") &&
        message.requestId === packet.requestId
    );
    if (!receipt || (receipt.type === "error") !== Boolean(options.reject)) {
      throw new Error(`Unexpected ${label} receipt: ${JSON.stringify(receipt)}`);
    }
    this.checkpoint(label, { player, packet });
    return receipt;
  }

  checkpoint(label: string, submitted?: unknown): void {
    const roomEvents = this.room.exportArchive().roomEventLog.slice(this.roomEventCursor);
    this.roomEventCursor += roomEvents.length;
    for (const player of PLAYERS) {
      const view = this.view(player);
      const players = view.match.stage === "setup" ? view.match.setup.players : view.match.players;
      for (const seat of players) {
        if (seat.playerId !== player && seat.hand !== undefined) throw new Error("Opponent hand leaked through room");
        if (seat.playerId === player && seat.hand?.length !== seat.handCount) throw new Error("Owner hand count mismatch");
      }
    }
    const events = this.messages.splice(0).map(({ recipient, message }) => ({
      recipient,
      ...(message.type === "duel-projection" ? {
        type: message.type,
        stateVersion: message.projection.match.stateVersion,
        eventSeq: message.projection.match.eventSeq,
        stage: message.projection.match.stage
      } : message.type === "owner-deck-confirmation" ? {
        type: message.type
      } : message)
    }));
    this.steps.push({ label, ...(submitted ? { submitted: this.normalizer.normalize(submitted) } : {}),
      roomEvents: this.normalizer.normalize(roomEvents), events: this.normalizer.normalize(events),
      projections: PLAYERS.map(player => summary(this.view(player), this.normalizer)) });
  }

  mulligan(): void {
    for (let index = 0; index < 2; index++) {
      const view = this.view();
      if (view.match.stage !== "setup") throw new Error("Expected actual room mulligan");
      const player = view.match.setup.currentMulliganOwner as Player;
      this.action(player, "mulligan");
      this.send(player, { type: "mulligan", selectedUIDs: [] }, `${player}-keep`);
    }
  }

  endTurn(): void {
    const player = this.playing().match.frame.turnPlayerId as Player;
    const action = this.action(player, "end-turn");
    this.send(player, { type: "end-turn", windowId: action.windowId }, `end-turn-${this.playing().match.frame.turnNumber}`);
  }

  untilTurn(turn: number): void {
    const remaining = turn - this.playing().match.frame.turnNumber;
    for (let index = 0; index < remaining; index++) this.endTurn();
    if (this.playing().match.frame.turnNumber !== turn) throw new Error("Unexpected turn cursor");
  }

  playUnit(player: Player, cardId: string, accelerate = false): string {
    const card = this.playing(player).match.players.find(seat => seat.playerId === player)?.hand?.find(
      candidate => candidate.cardId === cardId
    );
    if (!card) throw new Error(`The real hand has no ${cardId}`);
    const play = this.action(player, "play-card", action => action.cardUID === card.uid);
    this.send(player, { type: "play-card", cardUID: card.uid, windowId: play.windowId }, `play-${cardId}`);
    const choice = this.playing(player).match.frame.pendingChoice;
    if (!choice || !("kind" in choice) || choice.kind !== "play-choices") throw new Error("Expected optional Unit choice");
    this.send(player, { type: "answer-pending-choice", choiceId: choice.choiceId,
      answers: choice.prompts.map(prompt => {
        const option = prompt.options.find(candidate => candidate.label === (accelerate ? "支付额外费用" : "不支付额外费用"));
        if (!option) throw new Error("Missing real Accelerate decision");
        return { promptId: prompt.promptId, optionIds: [option.id] };
      }) }, accelerate ? "accept-accelerate" : "decline-accelerate");
    const cost = this.playing(player).match.frame.pendingPayment?.resolvedCost;
    if (!cost) throw new Error("Expected authoritative pending cost");
    while (this.playing(player).match.resources.players.find(seat => seat.playerId === player)!.runePool.energy < cost.energy) {
      const rune = this.view(player).actions.find(action => action.kind === "rune-energy" && action.enabled);
      if (!rune || rune.kind !== "rune-energy") throw new Error("Insufficient real Runes for Unit energy");
      this.send(player, { type: "rune-energy", uid: rune.uid }, "fund-unit-energy");
    }
    for (const requirement of cost.power) {
      for (let amount = 0; amount < requirement.amount; amount++) {
        const runes = this.playing(player).match.resources.bases.find(base => base.playerId === player)!.baseRunes;
        const rune = this.view(player).actions.find(action => action.kind === "rune-power" && action.enabled &&
          runes.some(candidate => candidate.uid === action.uid && requirement.allowedDomains.includes(candidate.domain)));
        if (!rune || rune.kind !== "rune-power") throw new Error("Insufficient real Runes for Unit power");
        this.send(player, { type: "rune-power", uid: rune.uid }, "fund-unit-power");
      }
    }
    const payment = this.action(player, "pay-pending");
    this.send(player, { type: "pay-pending", paymentId: payment.paymentId }, "pay-unit");
    const unit = this.playing().match.board.units.find(candidate => candidate.objectId === card.uid);
    if (!unit || unit.readied !== accelerate) throw new Error("Unit entry readiness did not match the real choice");
    return unit.objectId;
  }

  move(player: Player, uid: string, fieldIndex: number): void {
    const field = this.playing().match.board.battlefields[fieldIndex];
    if (!field) throw new Error("Missing battlefield");
    const action = this.action(player, "standard-move", candidate => candidate.destinations.some(
      destination => destination.locationId === field.locationId && destination.eligibleUnitUIDs.includes(uid)
    ));
    this.send(player, { type: "standard-move", windowId: action.windowId,
      unitUIDs: [uid], destinationLocationId: field.locationId }, `move-to-field-${fieldIndex}`);
    for (let count = 0; count < 2; count++) {
      const owner = this.playing().match.frame.focusPlayerId as Player;
      const pass = this.action(owner, "pass-focus");
      this.send(owner, { type: "pass-focus", windowId: pass.windowId }, "pass-showdown-focus");
    }
  }

  resolveCombat(): void {
    for (let count = 0; count < 2; count++) {
      const player = PLAYERS.find(candidate => {
        const choice = this.playing(candidate).match.frame.pendingChoice;
        return choice && "kind" in choice && choice.kind === "combat-allocation";
      });
      if (!player) throw new Error("Missing real combat allocation");
      const choice = this.playing(player).match.frame.pendingChoice;
      if (!choice || !("kind" in choice) || choice.kind !== "combat-allocation" || choice.targets.length !== 1) {
        throw new Error("Expected one real combat target");
      }
      this.send(player, { type: "assign-combat-damage", choiceId: choice.choiceId,
        assignments: [{ unitObjectId: choice.targets[0]!.unitObjectId, amount: choice.budget }] }, `allocate-${choice.side}-damage`);
    }
  }

  snapshot(id: string, coverage: readonly string[], stop: string) {
    const match = this.view().match;
    return {
      schemaVersion: 1,
      scenario: id,
      source: { roomProfile: DEFAULT_ROOM_PROFILE, runtimeProfile: DEFAULT_RUNTIME_PROFILE,
        journalSchemaVersion: 7, seed: this.seed, random: "lcg32:1664525,1013904223",
        dataVersion: this.catalog.publicCatalog.dataVersion, catalogDigest: this.catalog.publicCatalog.digest,
        decks: { fixture: DECK_FIXTURE, hashes: [digest(realDecks.a), digest(realDecks.b)] } },
      coverage,
      stop,
      steps: this.steps,
      finalScoring: match.stage === "playing" ? this.normalizer.normalize(match.scoring) : null
    };
  }
}
