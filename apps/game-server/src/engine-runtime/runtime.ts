import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { createMatch, concede, type Match, type MatchDeck } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import { createProgramBinding, type ProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import type { ChoiceRequest, GameAction, ObjectRef, PlayerId } from "../../../../packages/engine-core/dist/effects/contract.js";
import type { V2ChoiceAnswer, V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { ENGINE_RUNTIME_RULESET_VERSION, RuntimeJournalWriter, type RuntimeJournal, type RuntimeJournalEntry, digest } from "./journal.js";
import { EngineRuntimeHost, type RuntimeCard } from "./host.js";
import { projectRuntime, projectionDigest } from "./projection.js";

export interface EngineRuntimeDeck extends MatchDeck {
  readonly mainDeck: readonly RuntimeCard[];
  readonly runeDeck: readonly RuntimeCard[];
  readonly championLegend: RuntimeCard;
  readonly chosenChampion: RuntimeCard;
  readonly battlefields: readonly [RuntimeCard, RuntimeCard, RuntimeCard];
}

export interface EngineRuntimeOptions {
  readonly matchId: string;
  readonly roomId?: string;
  readonly seats?: readonly [{ readonly playerId: string; readonly name: string }, { readonly playerId: string; readonly name: string }];
  readonly decks: readonly [EngineRuntimeDeck, EngineRuntimeDeck];
  readonly seed?: string | number;
  readonly firstPlayer?: 0 | 1 | "A" | "B";
  readonly battlefieldChoice?: readonly [number | undefined, number | undefined];
  readonly mulligans?: readonly [readonly string[], readonly string[]];
  readonly catalogDigest?: string;
  readonly programs?: readonly CardProgram[] | ReadonlyMap<string, CardProgram>;
  readonly engineVersion?: string;
  readonly createdAt?: string;
}

export interface RuntimeReceipt {
  readonly commandId: string;
  readonly status: "accepted" | "duplicate" | "rejected" | "pending";
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly error?: string;
  readonly result?: Record<string, unknown>;
  readonly choice?: { readonly choiceId: string; readonly ownerPlayerId: string; readonly stateVersion: number };
}

export interface RuntimeSubmitResult {
  readonly receipt: RuntimeReceipt;
  readonly projection: V2Projection;
}

export interface EngineRuntime {
  readonly matchId: string;
  start(): EngineRuntime;
  submit(playerId: PlayerId, command: V2Command): RuntimeSubmitResult;
  projectFor(playerId: PlayerId | null): V2Projection;
  journal(): RuntimeJournal;
  restore(journal: RuntimeJournal): EngineRuntime;
}

class PendingChoiceError extends Error {
  constructor(readonly request: ChoiceRequest<unknown>) { super(`Choice required: ${request.id}`); this.name = "PendingChoiceError"; }
}

interface SeenCommand {
  readonly playerId: string;
  readonly command: V2Command;
  readonly receipt: RuntimeReceipt;
}

class MatchRuntime implements EngineRuntime {
  private match: Match | null = null;
  private host: EngineRuntimeHost | null = null;
  private binding: ProgramBinding | null = null;
  private journalWriter: RuntimeJournalWriter | null = null;
  private stateVersion = 0;
  private pending: { readonly request: ChoiceRequest<unknown>; readonly command: V2Command; readonly playerId: string } | null = null;
  private decision: unknown = undefined;
  private readonly seen = new Map<string, SeenCommand>();
  private runtimeOptions: EngineRuntimeOptions;

  constructor(options: EngineRuntimeOptions) { this.runtimeOptions = options; }

  get matchId(): string { return this.runtimeOptions.matchId; }

  start(): EngineRuntime {
    if (this.match) throw new Error("Engine runtime has already started");
    const seats = this.runtimeOptions.seats ?? [{ playerId: "A", name: "Player A" }, { playerId: "B", name: "Player B" }];
    if (seats.length !== 2 || new Set(seats.map(seat => seat.playerId)).size !== 2) throw new TypeError("Engine runtime requires exactly two unique seats");
    let choice: ChoiceRequest<unknown> | null = null;
    const hostState = new EngineRuntimeHost(Object.fromEntries(seats.map(seat => [seat.playerId, seat.name])), request => {
      if (this.decision !== undefined) { const answer = this.decision; this.decision = undefined; return answer as never; }
      choice = request as ChoiceRequest<unknown>;
      throw new PendingChoiceError(request as ChoiceRequest<unknown>);
    });
    this.host = hostState;
    const normalizedDecks = this.normalizeDecks(this.runtimeOptions.decks);
    const pipelineHost = createActionPipelineHost({
      checkpoint: () => hostState.checkpoint(), restore: checkpoint => hostState.restore(checkpoint), objects: () => hostState.objects(),
      perform: action => hostState.perform(action), choose: request => hostState.choose(request),
      context: (source, controller, timingPoint) => hostState.context(source, controller, timingPoint),
    });
    const matchHost = { ...pipelineHost, player: (id: PlayerId) => hostState.player(id) };
    const firstPlayer = this.runtimeOptions.firstPlayer === "B" || this.runtimeOptions.firstPlayer === 1 ? 1 : 0;
    try {
      this.match = createMatch({
        decks: normalizedDecks,
        seed: this.runtimeOptions.seed,
        firstPlayer,
        battlefieldChoice: this.runtimeOptions.battlefieldChoice,
        mulligans: this.runtimeOptions.mulligans,
        rulesetVersion: ENGINE_RUNTIME_RULESET_VERSION,
        programs: this.runtimeOptions.programs ? { programs: this.runtimeOptions.programs } : undefined,
        host: matchHost,
      });
    } catch (error) {
      if (error instanceof PendingChoiceError && choice) throw new Error("Match setup unexpectedly requested a choice");
      throw error;
    }
    if (this.runtimeOptions.programs) {
      this.binding = createProgramBinding({ cardPrograms: this.runtimeOptions.programs });
      this.binding.attachLifecycle(this.match.flow.chain);
    }
    this.journalWriter = new RuntimeJournalWriter({
      header: {
        engineVersion: this.runtimeOptions.engineVersion ?? "@riftbound/engine-core/current",
        matchId: this.runtimeOptions.matchId, roomId: this.runtimeOptions.roomId ?? this.runtimeOptions.matchId,
        catalogDigest: this.runtimeOptions.catalogDigest ?? "sha256:" + digest(normalizedDecks),
        rosterDigest: digest(seats), trustedDeckDigest: digest({ seats, decks: normalizedDecks }),
        seed: String(this.runtimeOptions.seed ?? this.match.seed), seats, createdAt: this.runtimeOptions.createdAt ?? new Date(0).toISOString(),
        creation: { entropy: [], deterministicSeed: String(this.runtimeOptions.seed ?? this.match.seed), uidSeed: null, creator: "game-server" },
      }, stateDigest: this.stateDigest(), privateStateDigest: this.privateStateDigest(),
    });
    return this;
  }

  submit(playerId: PlayerId, command: V2Command): RuntimeSubmitResult {
    this.requireStarted();
    const prior = this.seen.get(command.commandId);
    if (prior) {
      if (prior.playerId !== playerId || JSON.stringify(prior.command) !== JSON.stringify(command)) return this.rejected(command, playerId, "commandId was already used for a different command");
      const duplicate = { ...prior.receipt, status: "duplicate" as const };
      this.appendJournal(playerId, command, duplicate, duplicate.result ?? { accepted: true }, true);
      return { receipt: duplicate, projection: this.projectFor(playerId) };
    }
    if (command.stateVersion !== this.stateVersion) return this.rejected(command, playerId, `stateVersion mismatch: expected ${this.stateVersion}, received ${command.stateVersion}`);
    if (command.type === "choose") return this.choose(playerId, command);
    try {
      const result = this.execute(playerId, command);
      this.stateVersion += 1;
      const receipt: RuntimeReceipt = { commandId: command.commandId, status: "accepted", stateVersion: this.stateVersion, eventSeq: this.match!.events().length, result };
      this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
      this.appendJournal(playerId, command, receipt, result);
      return { receipt, projection: this.projectFor(playerId) };
    } catch (error) {
      if (error instanceof PendingChoiceError) {
        this.pending = { request: error.request, command: structuredClone(command), playerId };
        const receipt: RuntimeReceipt = { commandId: command.commandId, status: "pending", stateVersion: this.stateVersion, eventSeq: this.match!.events().length, choice: { choiceId: error.request.id, ownerPlayerId: error.request.chooser, stateVersion: this.stateVersion } };
        this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
        this.appendJournal(playerId, command, receipt, { pending: true, choice: receipt.choice! }, false, {
          choiceId: error.request.id,
          ownerPlayerId: error.request.chooser,
          kind: error.request.type,
        });
        return { receipt, projection: this.projectFor(playerId) };
      }
      return this.rejected(command, playerId, error instanceof Error ? error.message : String(error));
    }
  }

  projectFor(playerId: PlayerId | null): V2Projection {
    this.requireStarted();
    const pendingProjection = this.pending ? {
      choiceId: this.pending.request.id,
      ownerPlayerId: this.pending.request.chooser,
      stateVersion: this.stateVersion,
      kind: this.pending.request.type,
      ...(this.pending.request.type === "mode" ? {
        options: this.pending.request.options.map(option => {
          const value = typeof option === "string" || typeof option === "number" || typeof option === "boolean" ? option : undefined;
          return { id: String(option), label: String(option), ...(value === undefined ? {} : { value }) };
        }),
      } : {}),
      ...(this.pending.request.type === "select-objects" ? { min: this.pending.request.min, max: this.pending.request.max } : {}),
    } : null;
    return projectRuntime(this.match!, this.host!, this.runtimeOptions.matchId, playerId, this.stateVersion, this.pending ? {
      ...pendingProjection!,
    } : null);
  }

  journal(): RuntimeJournal {
    if (!this.journalWriter) throw new Error("Engine runtime has not started");
    return this.journalWriter.snapshot();
  }

  restore(journal: RuntimeJournal): EngineRuntime {
    if (!this.journalWriter) this.start();
    if (journal.header.matchId !== this.runtimeOptions.matchId) throw new Error("Journal matchId does not match runtime");
    const options = this.runtimeOptions;
    this.match = null; this.host = null; this.binding = null; this.journalWriter = null; this.stateVersion = 0; this.pending = null; this.seen.clear();
    this.runtimeOptions = { ...options, seed: journal.header.seed, createdAt: journal.header.createdAt };
    this.start();
    for (const entry of journal.entries) {
      if (entry.duplicate) continue;
      const result = this.submit(entry.playerId, entry.command);
      if (entry.pendingReason) {
        if (result.receipt.status !== "pending") throw new Error(`Journal replay failed for pending ${entry.commandId}: ${result.receipt.error ?? result.receipt.status}`);
      } else if (result.receipt.status !== "accepted") {
        throw new Error(`Journal replay failed for ${entry.commandId}: ${result.receipt.error ?? result.receipt.status}`);
      }
    }
    return this;
  }

  private choose(playerId: string, command: Extract<V2Command, { type: "choose" }>): RuntimeSubmitResult {
    if (!this.pending) return this.rejected(command, playerId, "No choice is pending");
    if (this.pending.request.id !== command.choiceId || this.pending.request.chooser !== playerId) return this.rejected(command, playerId, "Choice is not owned by this player");
    const original = this.pending; this.pending = null; this.decision = command.answer;
    try {
      const result = this.execute(original.playerId, original.command);
      this.stateVersion += 1;
      const receipt: RuntimeReceipt = { commandId: command.commandId, status: "accepted", stateVersion: this.stateVersion, eventSeq: this.match!.events().length, result: { resumedCommandId: original.command.commandId, accepted: true } };
      this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
      this.appendJournal(playerId, command, receipt, receipt.result!);
      return { receipt, projection: this.projectFor(playerId) };
    } catch (error) {
      this.decision = undefined; this.pending = original;
      return this.rejected(command, playerId, error instanceof Error ? error.message : String(error));
    }
  }

  private execute(playerId: string, command: V2Command): Record<string, unknown> {
    const match = this.match!;
    if (command.type === "concede") { concede(match, playerId); return { accepted: true, winnerPlayerId: match.result().winner }; }
    if (command.type === "pass") { match.flow.pass(playerId); return { accepted: true }; }
    if (command.type === "mulligan") throw new Error("Mulligan is supplied to start(); setup is already complete");
    if (command.type === "choose") throw new Error("Choice commands are handled by the runtime boundary");
    if (command.type === "move") {
      const ref = this.resolveObjectRef(command.objectId, command.stateVersion);
      let outcome;
      if (command.to.zone === "deck" || command.to.zone === "rune-deck") {
        outcome = this.host!.perform({ type: "move-zone", object: ref, to: command.to.zone === "deck" ? command.to.position === "top" ? "deck-top" : "deck-bottom" : "rune-deck" });
      } else {
        const destination = command.to as { readonly zone: string; readonly locationId?: string; readonly playerId?: string };
        outcome = this.host!.perform({ type: "move-zone", object: ref, to: destination.zone as never, location: destination.locationId ? destination.zone === "battlefield" ? { type: "battlefield", id: destination.locationId } : destination.zone === "base" ? { type: "base", player: destination.playerId ?? playerId } : undefined : undefined });
      }
      if (outcome.status !== "done") throw new Error(`Move could not be applied: ${outcome.status}`);
      return { accepted: true, objectId: command.objectId };
    }
    if (command.type === "play") {
      if (!this.binding) throw new Error("No trusted card-program registry is bound");
      const source = this.resolveObject(command.cardObjectId);
      const draft = this.binding.describePlay({ type: "play", object: source.ref, player: playerId }, source);
      match.flow.execute(draft);
      return { accepted: true, objectId: command.cardObjectId };
    }
    if (command.type === "activate") {
      if (!this.binding) throw new Error("No trusted card-program registry is bound");
      const source = this.resolveObject(command.sourceObjectId);
      match.flow.execute(this.binding.describeActivate(source, playerId));
      return { accepted: true, objectId: command.sourceObjectId, abilityId: command.abilityId };
    }
    if (command.type === "declare-attack" || command.type === "declare-defense") throw new Error(`${command.type} is not available until the combat transaction adapter is installed`);
    return { accepted: true };
  }

  private resolveObject(id: string): ReturnType<EngineRuntimeHost["objects"]>[number] {
    const object = this.host!.objects().find(candidate => candidate.ref.id === id); if (!object) throw new Error(`Unknown object ${id}`); return object;
  }

  private resolveObjectRef(id: string, _stateVersion: number): ObjectRef { return this.resolveObject(id).ref; }

  private rejected(command: V2Command, playerId: string, error: string): RuntimeSubmitResult {
    const receipt: RuntimeReceipt = { commandId: command.commandId, status: "rejected", stateVersion: this.stateVersion, eventSeq: this.match?.events().length ?? 0, error };
    return { receipt, projection: this.projectFor(playerId) };
  }

  private appendJournal(
    playerId: string,
    command: V2Command,
    receipt: RuntimeReceipt,
    result: Record<string, unknown>,
    duplicate = false,
    pendingReason?: Readonly<Record<string, unknown>>,
  ): RuntimeJournalEntry {
    const writer = this.journalWriter!;
    return writer.append({
      playerId, actor: playerId, requestId: command.commandId, commandId: command.commandId, command, payload: command,
      acceptedAt: new Date(0).toISOString(),
      expectedStateVersion: duplicate || receipt.status === "pending" ? this.stateVersion : Math.max(0, this.stateVersion - 1),
      expectedRoomVersion: 0,
      appliedStateVersion: this.stateVersion, roomVersion: 0, eventSeq: this.match!.events().length, result, publicReceipt: result,
      duplicate, rejection: null, ...(pendingReason ? { pendingReason } : {}), entropyConsumed: [],
      projectionDigestByViewer: Object.fromEntries([null, ...Object.keys(this.host!.playerNames())].map(viewer => [viewer ?? "spectator", projectionDigest(this.projectFor(viewer))])),
    });
  }

  private requireStarted(): void { if (!this.match || !this.host || !this.journalWriter) throw new Error("Engine runtime has not started"); }

  private stateDigest(): string { return digest({ objects: this.host!.objects(), players: Object.keys(this.host!.playerNames()).map(id => this.host!.player(id)) }); }
  private privateStateDigest(): string { return digest(this.host!.checkpoint()); }

  private normalizeDecks(decks: readonly [EngineRuntimeDeck, EngineRuntimeDeck]): readonly [EngineRuntimeDeck, EngineRuntimeDeck] {
    return decks.map(deck => ({
      ...deck,
      mainDeck: deck.mainDeck.map(card => ({ ...card })), runeDeck: deck.runeDeck.map(card => ({ ...card })),
      championLegend: { ...deck.championLegend }, chosenChampion: { ...deck.chosenChampion },
      battlefields: deck.battlefields.map(card => ({ ...card })) as unknown as EngineRuntimeDeck["battlefields"],
    })) as unknown as readonly [EngineRuntimeDeck, EngineRuntimeDeck];
  }
}

export function createEngineRuntime(options: EngineRuntimeOptions): EngineRuntime { return new MatchRuntime(options); }
export const createAuthoritativeRuntime = createEngineRuntime;
export const createRuntime = createEngineRuntime;
