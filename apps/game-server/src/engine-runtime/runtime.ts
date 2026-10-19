import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { createMatch, concede, type Match, type MatchDeck } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import { createProgramBinding, type ProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import type { ChoiceRequest, Domain, GameAction, ObjectRef, PlayerId } from "../../../../packages/engine-core/dist/effects/contract.js";
import {
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation,
  type BasicRuneResourceReceipt,
} from "../../../../packages/engine-core/dist/runes/index.js";
import {
  isV2Command,
  type V2ChoiceAnswer,
  type V2Command,
  type V2Projection,
  type V2RuneResourceCommand,
} from "../../../../packages/protocol/dist/v2/index.js";
import { assertRuntimeJournal, ENGINE_RUNTIME_RULESET_VERSION, RuntimeJournalWriter, canonicalJson, type RuntimeJournal, type RuntimeJournalEntry, digest } from "./journal.js";
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

function canonicalCommand(command: V2Command): string {
  return canonicalJson(command);
}

function choiceBounds(request: ChoiceRequest<unknown>): { readonly min?: number; readonly max?: number } {
  if (request.type !== "select-objects" && request.type !== "number") return {};
  if (!Number.isSafeInteger(request.min) || !Number.isSafeInteger(request.max) ||
      request.min < 0 || request.max < request.min) throw new TypeError("Pending choice range is invalid");
  return { min: request.min, max: request.max };
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
    const normalizedDecks = this.normalizeDecks(this.runtimeOptions.decks);
    const catalogDomains = this.catalogDomains(normalizedDecks);
    const hostState = new EngineRuntimeHost(Object.fromEntries(seats.map(seat => [seat.playerId, seat.name])), request => {
      if (this.decision !== undefined) { const answer = this.decision; this.decision = undefined; return answer as never; }
      choice = request as ChoiceRequest<unknown>;
      throw new PendingChoiceError(request as ChoiceRequest<unknown>);
    }, catalogDomains);
    this.host = hostState;
    const pipelineHost = createActionPipelineHost({
      checkpoint: () => hostState.checkpoint(), restore: checkpoint => hostState.restore(checkpoint), objects: () => hostState.objects(),
      perform: action => hostState.perform(action), choose: request => hostState.choose(request),
      performWithDeathBoundary: (action, boundary) => hostState.performWithDeathBoundary(action, boundary),
      performKillBatchWithDeathBoundary: (actions, batchId, boundary) =>
        hostState.performKillBatchWithDeathBoundary(actions, batchId, boundary),
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
        setup: {
          ...(this.runtimeOptions.firstPlayer === undefined ? {} : {
            firstPlayer: this.runtimeOptions.firstPlayer === "B" || this.runtimeOptions.firstPlayer === 1 ? 1 : 0,
          }),
          ...(this.runtimeOptions.battlefieldChoice === undefined ? {} : {
            battlefieldChoice: [
              this.runtimeOptions.battlefieldChoice[0] ?? null,
              this.runtimeOptions.battlefieldChoice[1] ?? null,
            ] as const,
          }),
          mulligans: [
            [...(this.runtimeOptions.mulligans?.[0] ?? [])],
            [...(this.runtimeOptions.mulligans?.[1] ?? [])],
          ] as const,
        },
      }, stateDigest: this.stateDigest(), privateStateDigest: this.privateStateDigest(),
    });
    return this;
  }

  submit(playerId: PlayerId, command: V2Command): RuntimeSubmitResult {
    this.requireStarted();
    if (!isV2Command(command)) return this.rejected(command, playerId, "Invalid protocol v2 command");
    if (!Object.hasOwn(this.host!.playerNames(), playerId)) return this.rejected(command, playerId, "Unknown player");
    const prior = this.seen.get(command.commandId);
    if (prior) {
      if (prior.playerId !== playerId || canonicalCommand(prior.command) !== canonicalCommand(command)) return this.rejected(command, playerId, "commandId was already used for a different command");
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
      ...choiceBounds(this.pending.request),
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
    assertRuntimeJournal(journal);
    if (journal.header.matchId !== this.runtimeOptions.matchId) throw new Error("Journal matchId does not match runtime");
    const options = this.runtimeOptions;
    this.match = null; this.host = null; this.binding = null; this.journalWriter = null; this.stateVersion = 0; this.pending = null; this.seen.clear();
    const setup = journal.header.setup;
    this.runtimeOptions = {
      ...options,
      seed: journal.header.seed,
      createdAt: journal.header.createdAt,
      ...(setup ? {
        mulligans: [
          [...setup.mulligans[0]],
          [...setup.mulligans[1]],
        ] as const,
        ...(setup.firstPlayer === undefined ? {} : { firstPlayer: setup.firstPlayer }),
        ...(setup.battlefieldChoice === undefined ? {} : {
          battlefieldChoice: [
            setup.battlefieldChoice[0] ?? undefined,
            setup.battlefieldChoice[1] ?? undefined,
          ] as const,
        }),
      } : {}),
    };
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
    const original = this.pending;
    if (original.request.type === "number" &&
        (typeof command.answer !== "number" || !Number.isSafeInteger(command.answer) ||
          command.answer < original.request.min || command.answer > original.request.max))
      return this.rejected(command, playerId,
        `Number choice must be an integer between ${original.request.min} and ${original.request.max}`);
    this.pending = null; this.decision = command.answer;
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
    if (command.type === "pass") {
      if (match.flow.chain.items.some(item => item.status === "pending")) {
        // Finalize choices are part of the chain and may suspend before the
        // priority holder can pass. Resume Finalize here; resolve passes through
        // the normal chain priority after the item is finalized.
        match.flow.chain.advance();
        return { accepted: true };
      }
      match.flow.pass(playerId);
      return { accepted: true };
    }
    if (command.type === "mulligan") throw new Error("Mulligan is supplied to start(); setup is already complete");
    if (command.type === "choose") throw new Error("Choice commands are handled by the runtime boundary");
    if (command.type === "move") {
      const ref = this.resolveObjectRef(command.objectId, command.stateVersion);
      this.assertCanControl(playerId, ref);
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
      if (command.cost !== undefined || command.targets !== undefined || command.picks !== undefined) {
        throw new Error("Wire cost, target and pick selections require the authoritative Finalize choice adapter");
      }
      const source = this.resolveObject(command.cardObjectId);
      this.assertCanControl(playerId, source.ref);
      const draft = this.binding.describePlay({ type: "play", object: source.ref, player: playerId }, source);
      match.flow.execute(draft);
      return { accepted: true, objectId: command.cardObjectId };
    }
    if (command.type === "activate") {
      if (!this.binding) throw new Error("No trusted card-program registry is bound");
      const source = this.resolveObject(command.sourceObjectId);
      this.assertCanControl(playerId, source.ref);
      if (!/^(?:0|[1-9]\d*)$/u.test(command.abilityId)) throw new Error(`Unknown ability ${command.abilityId}`);
      const abilityIndex = Number(command.abilityId);
      if (!Number.isSafeInteger(abilityIndex) || abilityIndex < 0 || !this.binding.activationAbilities(source)[abilityIndex]) {
        throw new Error(`Unknown ability ${command.abilityId}`);
      }
      match.flow.execute(this.binding.describeActivate(source, playerId, abilityIndex));
      return { accepted: true, objectId: command.sourceObjectId, abilityId: command.abilityId };
    }
    if (command.type === "rune-energy" || command.type === "rune-power") {
      return this.executeRuneResource(playerId, command);
    }
    if (command.type === "declare-attack" || command.type === "declare-defense") throw new Error(`${command.type} is not available until the combat transaction adapter is installed`);
    throw new Error(`Unhandled runtime command: ${(command as { readonly type?: unknown }).type ?? "unknown"}`);
  }

  private resolveObject(id: string): ReturnType<EngineRuntimeHost["objects"]>[number] {
    const object = this.host!.objects().find(candidate => candidate.ref.id === id); if (!object) throw new Error(`Unknown object ${id}`); return object;
  }

  private resolveObjectRef(id: string, _stateVersion: number): ObjectRef { return this.resolveObject(id).ref; }

  private assertCanControl(playerId: string, ref: ObjectRef): void {
    const object = this.host!.object(ref);
    if (!object) throw new Error(`Unknown object ${ref.id}`);
    if (object.controller !== playerId) throw new Error("Player does not control object");
  }

  private executeRuneResource(playerId: string, command: V2RuneResourceCommand): Record<string, unknown> {
    const match = this.match!;
    const source = this.resolveObject(command.runeObjectId);
    if (source.ref.zoneEntryId !== command.zoneEntryId) {
      throw new Error(`Rune ${command.runeObjectId}:${command.zoneEntryId} is no longer current`);
    }
    const priorityLegal = match.flow.chain.canAct(playerId, "reaction", source.ref, source);
    const request = {
      actor: playerId,
      activationId: `rune-command:${command.commandId}`,
      intent: {
        type: command.type,
        runeObjectId: command.runeObjectId,
        zoneEntryId: command.zoneEntryId,
      },
      window: priorityLegal ? { kind: "priority" as const } : { kind: "payment" as const },
    };
    const plan = planBasicRuneResourceActivation({
      chain: match.flow.chain,
      state: this.host!,
      resolveIdentity: cardId => {
        const domains = this.host!.runeDomains(source.ref);
        if (domains.length !== 1) return null;
        return { cardId, canonicalCardId: cardId, domain: domains[0]! };
      },
      request,
    });
    const receipt = executeBasicRuneResourcePlan(plan);
    return this.runeReceiptResult(receipt);
  }

  private runeReceiptResult(receipt: BasicRuneResourceReceipt): Record<string, unknown> {
    return {
      accepted: true,
      activationId: receipt.activationId,
      resource: receipt.resource,
      energyAdded: receipt.energyAdded,
      powerAdded: [...receipt.powerAdded],
      runeBefore: { ...receipt.runeBefore },
      runeAfter: { ...receipt.runeAfter },
      runeZoneAfter: receipt.runeZoneAfter,
    };
  }

  private rejected(command: V2Command | { readonly commandId?: unknown }, playerId: string, error: string): RuntimeSubmitResult {
    const commandId = typeof command.commandId === "string" && command.commandId.length > 0 ? command.commandId : "invalid-command";
    const receipt: RuntimeReceipt = { commandId, status: "rejected", stateVersion: this.stateVersion, eventSeq: this.match?.events().length ?? 0, error };
    const viewer = Object.hasOwn(this.host?.playerNames() ?? {}, playerId) ? playerId : null;
    return { receipt, projection: this.projectFor(viewer) };
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
    const viewers = Object.keys(this.host!.playerNames());
    const projections = [
      projectRuntime(this.match!, this.host!, this.runtimeOptions.matchId, viewers[0]!, this.stateVersion, this.pendingChoiceFor(viewers[0]!)),
      projectRuntime(this.match!, this.host!, this.runtimeOptions.matchId, viewers[1]!, this.stateVersion, this.pendingChoiceFor(viewers[1]!)),
      projectRuntime(this.match!, this.host!, this.runtimeOptions.matchId, null, this.stateVersion, this.pendingChoiceFor(null)),
    ] as const;
    return writer.append({
      playerId, actor: playerId, requestId: command.commandId, commandId: command.commandId, command, payload: command,
      acceptedAt: new Date(0).toISOString(),
      expectedStateVersion: duplicate || receipt.status === "pending" ? this.stateVersion : Math.max(0, this.stateVersion - 1),
      expectedRoomVersion: 0,
      appliedStateVersion: this.stateVersion, roomVersion: 0, eventSeq: this.match!.events().length, result, publicReceipt: receipt as unknown as Record<string, unknown>,
      duplicate, rejection: null, ...(pendingReason ? { pendingReason } : {}), entropyConsumed: [],
      projectionDigestByViewer: Object.fromEntries(["spectator", ...viewers].map((viewer, index) => [viewer, projectionDigest(projections[index === 0 ? 2 : index - 1]!) ])),
      stateDigest: projectionDigest(projections[2]), privateStateDigest: digest(projections.slice(0, 2)),
    });
  }

  private pendingChoiceFor(viewer: string | null): Parameters<typeof projectRuntime>[5] {
    if (!this.pending) return null;
    const request = this.pending.request;
    const options = request.type === "mode" ? request.options.map(option => {
      const value = typeof option === "string" || typeof option === "number" || typeof option === "boolean" ? option : undefined;
      return { id: String(option), label: String(option), ...(value === undefined ? {} : { value }) };
    }) : undefined;
    return {
      choiceId: request.id,
      ownerPlayerId: request.chooser,
      stateVersion: this.stateVersion,
      kind: request.type,
      ...(viewer === request.chooser && options ? { options } : {}),
      ...choiceBounds(request),
    };
  }

  private requireStarted(): void { if (!this.match || !this.host || !this.journalWriter) throw new Error("Engine runtime has not started"); }

  private stateDigest(): string {
    if (!this.match || !this.host) throw new Error("Engine runtime has not started");
    return projectionDigest(projectRuntime(this.match, this.host, this.runtimeOptions.matchId, null, this.stateVersion, null));
  }
  private privateStateDigest(): string {
    if (!this.match || !this.host) throw new Error("Engine runtime has not started");
    return digest([
      projectRuntime(this.match, this.host, this.runtimeOptions.matchId, Object.keys(this.host.playerNames())[0]!, this.stateVersion, this.pending ? {
        choiceId: this.pending.request.id,
        ownerPlayerId: this.pending.request.chooser,
        stateVersion: this.stateVersion,
        kind: this.pending.request.type,
      } : null),
      projectRuntime(this.match, this.host, this.runtimeOptions.matchId, Object.keys(this.host.playerNames())[1]!, this.stateVersion, this.pending ? {
        choiceId: this.pending.request.id,
        ownerPlayerId: this.pending.request.chooser,
        stateVersion: this.stateVersion,
        kind: this.pending.request.type,
      } : null),
    ]);
  }

  private normalizeDecks(decks: readonly [EngineRuntimeDeck, EngineRuntimeDeck]): readonly [EngineRuntimeDeck, EngineRuntimeDeck] {
    const copy = (card: RuntimeCard): RuntimeCard => ({
      ...card,
      ...(card.domains === undefined ? {} : { domains: [...card.domains] }),
    });
    return decks.map(deck => ({
      ...deck, mainDeck: deck.mainDeck.map(copy), runeDeck: deck.runeDeck.map(copy),
      championLegend: copy(deck.championLegend), chosenChampion: copy(deck.chosenChampion),
      battlefields: deck.battlefields.map(copy) as unknown as EngineRuntimeDeck["battlefields"],
    })) as unknown as readonly [EngineRuntimeDeck, EngineRuntimeDeck];
  }

  private catalogDomains(decks: readonly [EngineRuntimeDeck, EngineRuntimeDeck]): ReadonlyMap<string, readonly Domain[]> {
    const known = new Set<Domain>(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
    const result = new Map<string, readonly Domain[]>();
    const cards = decks.flatMap(deck => [
      ...deck.mainDeck, ...deck.runeDeck, deck.championLegend, deck.chosenChampion, ...deck.battlefields,
    ]);
    for (const card of cards) {
      if (card.domains === undefined) continue;
      const domains: Domain[] = [];
      for (const [index, domain] of card.domains.entries()) {
        if (!known.has(domain)) throw new TypeError(`Runtime card ${card.id} has an invalid Domain at index ${index}`);
        if (!domains.includes(domain)) domains.push(domain);
      }
      const cardId = card.cardId ?? card.id;
      const previous = result.get(cardId);
      if (previous !== undefined &&
          (previous.length !== domains.length || previous.some(domain => !domains.includes(domain)))) {
        throw new TypeError(`Trusted catalog Domains disagree for card ${cardId}`);
      }
      result.set(cardId, domains);
    }
    return result;
  }
}

export function createEngineRuntime(options: EngineRuntimeOptions): EngineRuntime { return new MatchRuntime(options); }
export const createAuthoritativeRuntime = createEngineRuntime;
export const createRuntime = createEngineRuntime;
