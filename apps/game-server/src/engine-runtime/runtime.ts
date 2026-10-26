import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { createMatch, concede, type Match, type MatchDeck } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import {
  createProgramBinding,
  type ProgramBinding,
  type ProgramPrintedCatalogCard,
} from "../../../../packages/engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../packages/engine-core/dist/programs/statics.js";
import { playPermissionAllows } from "../../../../packages/engine-core/dist/programs/play-permissions.js";
import { moveUnits } from "../../../../packages/engine-core/dist/game/commands/movement.js";
import type { ChoiceRequest, Domain, GameAction, Instruction, LocationRef, ObjectRef, PlayerId } from "../../../../packages/engine-core/dist/effects/contract.js";
import type { TriggerRegistration } from "../../../../packages/engine-core/dist/events/pipeline-types.js";
import {
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation,
  type BasicRuneResourceReceipt,
} from "../../../../packages/engine-core/dist/runes/index.js";
import {
  isV2Command,
  type V2ChoiceAnswer,
  type V2ChoiceOption,
  type V2CombatDamageCommand,
  type V2Command,
  type V2Location,
  type V2PendingChoice,
  type V2Projection,
  type V2RuneResourceCommand,
} from "../../../../packages/protocol/dist/v2/index.js";
import { assertRuntimeJournal, ENGINE_RUNTIME_RULESET_VERSION, RuntimeJournalWriter, canonicalJson,
  digestCanonicalJson, type RuntimeJournal, type RuntimeJournalEntry, digest } from "./journal.js";
import { EngineRuntimeHost, type RuntimeCard, type RuntimeVisibilityGrant } from "./host.js";
import { advanceResponsiblePlayer, projectObjectForChoice, projectRuntime,
  projectRuntimeFromSnapshot, projectionCanonicalJson, projectionDigest, projectionSnapshot } from "./projection.js";

type PendingChoice = Extract<V2PendingChoice, { readonly status: "pending" }>;
type V2PendingChoiceSource = NonNullable<PendingChoice["source"]>;

interface ChoiceMetadata {
  readonly source?: V2PendingChoiceSource;
  readonly prompt?: string;
}

interface ResolvedTriggerOption {
  readonly source?: ReturnType<EngineRuntimeHost["objects"]>[number];
  readonly controller?: PlayerId;
  readonly name: string;
  readonly keyword?: string;
}

interface TriggerRegistrationSource {
  readonly id: string;
  readonly source: ReturnType<EngineRuntimeHost["objects"]>[number];
  readonly controller: PlayerId;
}

function triggerOrderRegistration(id: string, registrations: readonly TriggerRegistrationSource[]): TriggerRegistrationSource | undefined {
  const exact = registrations.find(registration => registration.id === id);
  return exact ?? registrations.flatMap(registration =>
    id.startsWith(`${registration.id}:`) ? [registration] : [])
    .sort((left, right) => right.id.length - left.id.length)[0];
}

function readableKeyword(source: ReturnType<EngineRuntimeHost["objects"]>[number] | undefined, id: string): string | undefined {
  const keyword = source?.keywords.find(candidate => candidate.id.toLowerCase() === id.toLowerCase());
  return keyword?.id ?? (id.trim().length === 0 ? undefined
    : `${id[0]!.toUpperCase()}${id.slice(1)}`);
}

function visibleTriggerSource(source: ReturnType<EngineRuntimeHost["objects"]>[number], controller: PlayerId,
  viewer: string | null, grants: readonly RuntimeVisibilityGrant[]): boolean {
  if (viewer === null || controller !== viewer || source.faceDown) return false;
  return !projectObjectForChoice(source, viewer, grants).faceDown;
}

function triggerSourceMetadata(source: ReturnType<EngineRuntimeHost["objects"]>[number], viewer: string,
  grants: readonly RuntimeVisibilityGrant[]): V2PendingChoiceSource | undefined {
  if (!visibleTriggerSource(source, source.controller, viewer, grants)) return undefined;
  const projected = projectObjectForChoice(source, viewer, grants);
  const name = projected.name?.trim() ?? source.name.trim();
  return { objectId: projected.objectId, ...(name.length === 0 ? {} : { name }) };
}

interface ChainChoiceItem {
  readonly id: string;
  readonly source: ReturnType<EngineRuntimeHost["objects"]>[number];
  readonly body: readonly Instruction[];
  readonly trigger?: {
    readonly source: ReturnType<EngineRuntimeHost["objects"]>[number];
    readonly registration: TriggerRegistration;
  };
}

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
  /** Trusted canonical-card printed costs loaded by the server catalog. */
  readonly printedCatalog?: readonly ProgramPrintedCatalogCard[];
  readonly engineVersion?: string;
  readonly createdAt?: string;
  /** Non-wire lifecycle seam for asserting post-execution transaction failure. */
  readonly afterCommandExecution?: (command: V2Command, clock: { readonly stateVersion: number; readonly eventSeq: number }) => void;
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

interface ObjectChoiceCandidate {
  readonly ref: ObjectRef;
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly objectRef: { readonly objectId: string; readonly zoneEntryId: number };
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
  constructor(readonly request: ChoiceRequest<unknown>, readonly metadata: ChoiceMetadata = {}) {
    super(`Choice required: ${request.id}`); this.name = "PendingChoiceError";
  }
}

interface SeenCommand {
  readonly playerId: string;
  readonly command: V2Command;
  readonly receipt: RuntimeReceipt;
}

interface PreparedPlay {
  readonly playerId: string;
  readonly objectId: string;
  readonly commandId: string;
  readonly stateVersion: number;
  readonly base: ReturnType<ProgramBinding["describePlay"]>;
}

interface AtomicChain {
  atomic<T>(run: () => T): T;
}

interface TurnFlowCheckpoint {
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
}

interface RuntimeMetadataCheckpoint {
  readonly stateVersion: number;
  readonly pending: MatchRuntime["pending"];
  readonly decisions: MatchRuntime["decisions"];
  readonly preparedPlay: PreparedPlay | null;
  readonly visibilityGrants: readonly RuntimeVisibilityGrant[];
  readonly seen: ReadonlyMap<string, SeenCommand>;
}

/**
 * The engine-core action vocabulary distinguishes the Board zone from the
 * location carried by each Permanent. EngineRuntimeHost's raw zone move keeps
 * `base`/`battlefield` as the Zone, while TurnFlow's Awaken and Standard Move
 * require a Unit/Gear to remain in `board` and carry its Location separately.
 * Adapt only that host representation at the runtime boundary; Chain legality,
 * location rules, events, and rollback remain engine-core owned.
 */
class RuntimeBoardHost extends EngineRuntimeHost {
  override perform(action: GameAction): ReturnType<EngineRuntimeHost["perform"]> {
    this.invalidateObjectCache();
    const outcome = super.perform(action);
    try {
      return this.normalizeBoardObject(outcome);
    } finally {
      this.invalidateObjectCache();
    }
  }

  private normalizeBoardObject(outcome: ReturnType<EngineRuntimeHost["perform"]>): ReturnType<EngineRuntimeHost["perform"]> {
    // EngineRuntimeHost's concrete-location zone spelling is adapted at this
    // single runtime seam so chain, Awaken, Move and projection all observe the
    // same `board + location` authority expected by engine-core.
    for (const object of this.objects()) {
      if (String(object.zone) !== "base" && String(object.zone) !== "battlefield") continue;
      if (!object.types.some(type => ["unit", "gear"].includes(type.toLowerCase()))) continue;
      const players = (this as unknown as { players: Map<string, { zones: Record<string, string[]> }> }).players;
      for (const player of players.values()) for (const ids of Object.values(player.zones)) {
        const index = ids.indexOf(object.ref.id);
        if (index >= 0) ids.splice(index, 1);
      }
      players.get(object.owner)!.zones.board!.unshift(object.ref.id);
      (this as unknown as { objectMap: Map<string, { zone: string }> }).objectMap.get(object.ref.id)!.zone = "board";
    }
    return outcome;
  }
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

function objectChoiceCandidates(request: ChoiceRequest<unknown>, host: EngineRuntimeHost, viewer: string | null,
  grants = host.visibility()): readonly ObjectChoiceCandidate[] {
  if (viewer !== request.chooser || (request.type !== "select-objects" && request.type !== "order")) return [];
  return request.options.flatMap(ref => {
    const object = host.object(ref);
    if (object === null) return [];
    const granted = grants.some(grant => grant.active && grant.object.id === ref.id &&
      grant.object.zoneEntryId === ref.zoneEntryId && grant.viewers.includes(request.chooser));
    const projected = projectObjectForChoice(object, viewer, grants);
    if (!granted && projected.faceDown) return [];
    const identity = projected.objectId;
    // The look/reveal grant is viewer-specific and this candidate set is only
    // emitted to the chooser, so an authorized card name remains readable
    // while the stable wire identity is still the redacted projected objectId.
    const readable = granted || !projected.faceDown;
    const inspectionLabel = readable && object.cardId !== null
      ? object.name || object.cardId || identity
      : "Hidden card";
    return [{
      ref: { id: ref.id, zoneEntryId: ref.zoneEntryId },
      id: identity,
      label: inspectionLabel,
      value: identity,
      objectRef: { objectId: identity, zoneEntryId: ref.zoneEntryId },
    }];
  });
}

function choiceOptions(request: ChoiceRequest<unknown>, host: EngineRuntimeHost, viewer: string | null,
  grants: readonly RuntimeVisibilityGrant[] = host.visibility(),
  triggerRegistrations: readonly TriggerRegistrationSource[] = [],
  capturedSource?: V2PendingChoiceSource): readonly V2ChoiceOption[] | undefined {
  if (viewer !== request.chooser) return undefined;
  if (request.type === "optional" || request.type === "number") return undefined;
  if (request.type === "mode") {
    const triggerOrder = /^trigger:\d+:[^:]+:order:\d+$/.test(request.id);
    const resolved = new Map<string, ResolvedTriggerOption | undefined>(request.options.map(option => {
      const id = String(option);
      if (!triggerOrder) return [id, undefined] as const;
      const registration = triggerOrderRegistration(id, triggerRegistrations);
      const registeredId = registration?.id ?? id;
      const programSource = /^program:(.+):(\d+):\d+$/.exec(registeredId);
      const keywordSource = keywordRegistrationLabel(registeredId);
      if (registration !== undefined && keywordSource !== undefined &&
          (registration!.source.ref.id !== keywordSource.objectId ||
            registration!.source.ref.zoneEntryId !== keywordSource.zoneEntryId)) return [id, undefined] as const;
      const currentSource = keywordSource === undefined
        ? programSource === null ? [] : host.objects().filter(object =>
            object.ref.id === programSource[1])
        : host.objects().filter(object => object.ref.id === keywordSource.objectId);
      // A Chain-to-Board play effect is collected while the new source is
      // still on the Chain. Prefer the authoritative registered snapshot; its
      // name is stable and already subject to the viewer visibility check.
      const current = currentSource.length === 1 ? currentSource[0] : undefined;
      const source = registration?.source ?? current;
      // On retry the lifecycle briefly has neither a live registration nor a
      // current incarnation for the just-played card. Reuse only the already
      // visibility-checked source captured with the pending order when the raw
      // keyword token names that exact object incarnation.
      const captured = source === undefined && current === undefined &&
        capturedSource !== undefined && keywordSource !== undefined && capturedSource.objectId === keywordSource.objectId &&
        capturedSource.name !== undefined ? capturedSource : undefined;
      if (source === undefined && captured !== undefined) {
        return [id, {
          name: captured.name!, keyword: keywordSource!.keyword,
        }] as const;
      }
      if (source === undefined) return [id, undefined] as const;
      const candidate = {
        source, controller: registration?.controller ?? source.controller,
        name: source.name,
        ...(keywordSource === undefined ? {} : { keyword: keywordSource.keyword }),
      };
      // A trigger collected by a just-played Permanent can still name its
      // pre-board snapshot. The chooser controls the trigger; reveal only the
      // printed name in the prompt, never the card's hidden live identity.
      const controller = registration?.controller ?? source.controller;
      const visible = controller === viewer && !source.faceDown;
      return [id, visible ? candidate : undefined] as const;
    }));
    // Two independent cards may have the same printed name, and one source can
    // register several separate keyword instances. Number those visible
    // entries for the chooser; the occurrence is derived from this option list
    // and never replaces the engine token.
    const duplicateNames = new Set<string>();
    const duplicateKeywords = new Set<string>();
    const optionNames = new Set<string>();
    const optionKeywords = new Map<string, number>();
    for (const registration of resolved.values()) {
      const optionName = registration?.name.trim();
      if (optionName === undefined || optionName.length === 0) continue;
      if (optionNames.has(optionName)) duplicateNames.add(optionName);
      optionNames.add(optionName);
      if (registration?.keyword !== undefined) {
        const key = `${optionName}\u0000${registration.keyword.toLowerCase()}`;
        const count = optionKeywords.get(key) ?? 0;
        if (count > 0) duplicateKeywords.add(key);
        optionKeywords.set(key, count + 1);
      }
    }
    const seenName = new Map<string, number>();
    const seenKeyword = new Map<string, number>();
    return request.options.map(option => {
      const value = typeof option === "string" || typeof option === "number" || typeof option === "boolean" ? option : undefined;
      const id = String(option);
      const registration = resolved.get(id);
      const name = registration?.name.trim();
      // `resolved` contains only the chooser's non-face-down sources; never
      // re-admit a name here from an unprojected snapshot.
      const readable = registration !== undefined && name !== undefined && name.length > 0;
      const occurrence = name === undefined || name.length === 0
        ? 0 : (seenName.get(name) ?? 0) + 1;
      if (occurrence > 0) seenName.set(name!, occurrence);
      const keyword = registration?.keyword === undefined ? undefined
        : readableKeyword(registration.source, registration.keyword);
      const keywordKey = registration?.keyword === undefined || name === undefined
        ? undefined : `${name}\u0000${registration.keyword.toLowerCase()}`;
      const keywordOccurrence = keywordKey === undefined
        ? 0 : (seenKeyword.get(keywordKey) ?? 0) + 1;
      if (keywordKey !== undefined) seenKeyword.set(keywordKey, keywordOccurrence);
      const optionLabel = occurrence > 0 && readable
        ? `${name}${keyword === undefined ? "" : ` · ${keyword}`}` : undefined;
      const label = optionLabel === undefined ? id
        : keywordKey !== undefined && duplicateKeywords.has(keywordKey)
          ? `${optionLabel} (trigger ${keywordOccurrence})`
          : duplicateNames.has(name!) ? `${optionLabel} (trigger ${occurrence})` : optionLabel;
      return { id, label, ...(value === undefined ? {} : { value }) };
    });
  }
  const candidates = objectChoiceCandidates(request, host, viewer, grants);
  // An order answer must be a permutation of the engine's complete candidate
  // set. If any identity is invisible, withhold the whole prompt rather than
  // offer a partial order that can never be valid or leak the omitted refs.
  if (request.type === "order" && candidates.length !== request.options.length) return [];
  return candidates.map(({ id, label, value, objectRef }) => ({ id, label, value, objectRef }));
}

/**
 * Keyword lifecycle registrations use:
 * `program-keyword-ability:<objectId>:<zoneEntryId>:<keyword>:<instance>:<ordinal>`.
 * Object ids can contain colons, so the source identity is bounded by the
 * numeric zone-entry segment immediately before the keyword. The caller still
 * resolves the authoritative snapshot from the registered trigger; this
 * parser only supplies the display keyword and an exact-incarnation guard.
 */
function keywordRegistrationLabel(id: string): { readonly objectId: string; readonly zoneEntryId: number; readonly keyword: string } | undefined {
  const match = /^program-keyword-ability:(.+):(\d+):([^:]+):[^:]+:\d+$/.exec(id);
  if (match === null) return undefined;
  const zoneEntryId = Number(match[2]);
  if (!Number.isSafeInteger(zoneEntryId) || zoneEntryId < 0) return undefined;
  return { objectId: match[1]!, zoneEntryId, keyword: match[3]! };
}

/** Resolve metadata from an exact existing request path without widening visibility. */
function choiceMetadataRequest(request: ChoiceRequest<unknown>, host: EngineRuntimeHost, viewer: string | null,
  grants: readonly RuntimeVisibilityGrant[], triggerRegistrations: readonly TriggerRegistrationSource[],
  chainItems: readonly ChainChoiceItem[], binding: ProgramBinding | null): ChoiceMetadata {
  if (viewer === null || viewer !== request.chooser) return {};
  if (request.type !== "optional" && request.type !== "select-objects" && request.type !== "mode") return {};
  let source: ReturnType<EngineRuntimeHost["objects"]>[number] | undefined;
  let triggerItem: ChainChoiceItem | undefined;
  for (const registration of triggerRegistrations) {
    const escaped = registration.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^trigger:\\d+:${escaped}:(?:\\d+):optional$`).test(request.id)) continue;
    source = host.objects().find(object => object.ref.id === registration.source.ref.id &&
      object.ref.zoneEntryId === registration.source.ref.zoneEntryId);
    triggerItem = chainItems.find(item => item.trigger?.registration.id === registration.id &&
      item.source.ref.id === registration.source.ref.id &&
      item.source.ref.zoneEntryId === registration.source.ref.zoneEntryId);
    break;
  }
  if (request.type === "mode" && /^trigger:\d+:[^:]+:order:\d+$/.test(request.id)) {
    const sources = new Map<string, ReturnType<EngineRuntimeHost["objects"]>[number]>();
    for (const option of request.options) {
      const registration = triggerOrderRegistration(String(option), triggerRegistrations);
      // Any unresolved or invisible option makes the whole order's source
      // ambiguous. Omitting the metadata is safer than claiming one source.
      if (registration === undefined || registration.controller !== viewer ||
          !visibleTriggerSource(registration.source, registration.controller, viewer, grants)) return {};
      sources.set(`${registration.source.ref.id}:${registration.source.ref.zoneEntryId}`, registration.source);
    }
    // Across different cards there is no single source to attach. Several
    // separate keyword instances from one visible card are still unique.
    if (sources.size === 1) {
      const uniqueSource = sources.values().next().value;
      if (uniqueSource === undefined) return {};
      source = uniqueSource;
      const metadata = triggerSourceMetadata(uniqueSource, viewer, grants);
      const prompt = wireChoicePrompt(request.prompt, viewer, request.chooser);
      if (metadata === undefined) return prompt === undefined ? {} : { prompt };
      return { source: metadata, ...(prompt === undefined ? {} : { prompt }) };
    }
    const prompt = wireChoicePrompt(request.prompt, viewer, request.chooser);
    return prompt === undefined ? {} : { prompt };
  }
  const chainItemId = choiceSourceItemId(request, chainItems);
  const item = chainItemId === undefined ? undefined : chainItems.find(candidate => candidate.id === chainItemId);
  if (item !== undefined) {
    triggerItem = item;
    const captured = item.trigger?.source ?? item.source;
    const current = host.objects().find(object => object.ref.id === captured.ref.id &&
      object.ref.zoneEntryId === captured.ref.zoneEntryId);
    if (current !== undefined) source = current;
  }
  const prompt = wireChoicePrompt(request.prompt ??
    (triggerItem === undefined ? undefined : optionalPrompt(triggerItem, binding)), viewer, request.chooser);
  if (source === undefined) return prompt === undefined ? {} : { prompt };
  const projected = projectObjectForChoice(source, viewer, grants);
  const objectId = projected.objectId;
  const name = !source.faceDown && !projected.faceDown ? source.name.trim() : "";
  const sourceMetadata = {
    ...(objectId.length === 0 ? {} : { objectId }),
    ...(name.length === 0 ? {} : { name }),
  };
  return {
    ...(Object.keys(sourceMetadata).length === 0 ? {} : { source: sourceMetadata }),
    ...(prompt === undefined ? {} : { prompt }),
  };
}

/** Wire metadata is chooser-only and bounded; invalid engine text is omitted. */
function wireChoicePrompt(value: string | undefined, viewer: string | null, owner: string): string | undefined {
  return viewer !== owner || value === undefined || value.length === 0 || value.length > 512 || value.trim() !== value
    ? undefined : value;
}

function wireChoiceSource(value: V2PendingChoiceSource | undefined, viewer: string | null, owner: string): V2PendingChoiceSource | undefined {
  if (viewer !== owner || value === undefined) return undefined;
  const objectId = value.objectId !== undefined && value.objectId.length > 0 && value.objectId.length <= 512 &&
    value.objectId.trim() === value.objectId ? value.objectId : undefined;
  const name = value.name !== undefined && value.name.length > 0 && value.name.length <= 512 &&
    value.name.trim() === value.name ? value.name : undefined;
  return objectId === undefined && name === undefined ? undefined : {
    ...(objectId === undefined ? {} : { objectId }),
    ...(name === undefined ? {} : { name }),
  };
}

function withChoiceMetadata(projection: V2Projection, pending: MatchRuntime["pending"]): V2Projection {
  if (pending === null || projection.pendingChoice.status !== "pending" ||
      projection.pendingChoice.ownerPlayerId !== projection.viewerPlayerId) return projection;
  const owner = pending.request.chooser;
  const prompt = wireChoicePrompt(pending.request.prompt ?? pending.prompt, projection.viewerPlayerId, owner);
  const source = wireChoiceSource(pending.source, projection.viewerPlayerId, owner);
  if (prompt === undefined && source === undefined) return projection;
  return {
    ...projection,
    pendingChoice: {
      ...projection.pendingChoice,
      ...(prompt === undefined ? {} : { prompt }),
      ...(source === undefined ? {} : { source }),
    },
  };
}

/** Resolve only a request path that names exactly one existing Chain item. */
function choiceSourceItemId(request: ChoiceRequest<unknown>, chainItems: readonly ChainChoiceItem[]): string | undefined {
  const trigger = /^finalize:(trigger:\d+):optional$/.exec(request.id);
  if (trigger !== null) return trigger[1];
  const matches = chainItems.filter(item => choicePathNamesItem(request.id, item.body));
  return matches.length === 1 ? matches[0]!.id : undefined;
}

/** Exact authored prompt metadata for the Finalize optional carried by this item. */
function optionalPrompt(item: ChainChoiceItem, binding: ProgramBinding | null): string | undefined {
  const direct = instructionPrompt(item.trigger?.registration.body ?? item.body);
  if (direct !== undefined || item.trigger === undefined || binding === null) return direct;
  const source = item.trigger.source;
  const index = Number(/:([0-9]+)$/.exec(item.trigger.registration.id)?.[1]);
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  const authored = binding.inspect(source).abilities[index];
  return authored?.kind === "triggered" ? instructionPrompt(authored.body) : undefined;
}

function instructionPrompt(body: readonly Instruction[]): string | undefined {
  for (const instruction of body) {
    if (instruction.op !== "choice.optional") continue;
    const prompt = instruction.args.prompt;
    if ((prompt?.kind === "constant" || prompt?.kind === "literal") && typeof prompt.value === "string" &&
        prompt.value.length > 0 && prompt.value.length <= 512 && prompt.value.trim() === prompt.value) return prompt.value;
  }
  return undefined;
}

/** The request path is evidence only when it names this item's instruction/target. */
function choicePathNamesItem(requestId: string, body: readonly Instruction[]): boolean {
  const segments = requestId.split("/").flatMap(segment => {
    try { return [decodeURIComponent(segment)]; } catch { return []; }
  });
  const namesInstruction = (instruction: Instruction): boolean => {
    if (segments.includes(instruction.id)) return true;
    if (instruction.targets?.some(target => requestId === `target:${target.id}` || segments.includes(`target:${target.id}`))) return true;
    const bodies: unknown[] = [];
    const bodyExpression = instruction.args.body;
    if (bodyExpression !== undefined && (bodyExpression.kind === "constant" || bodyExpression.kind === "literal") &&
        Array.isArray(bodyExpression.value)) bodies.push(bodyExpression.value);
    const modes = instruction.args.modes;
    if (modes !== undefined && (modes.kind === "constant" || modes.kind === "literal") && Array.isArray(modes.value)) {
      for (const mode of modes.value) {
        if (mode !== null && typeof mode === "object" && !Array.isArray(mode) && Array.isArray((mode as { readonly body?: unknown }).body)) {
          bodies.push((mode as { readonly body: readonly unknown[] }).body);
        }
      }
    }
    return bodies.some(value => Array.isArray(value) &&
      value.every(entry => entry !== null && typeof entry === "object") &&
      choicePathNamesItem(requestId, value as readonly Instruction[]));
  };
  return body.some(namesInstruction);
}

function orderedChoiceAnswer(request: ChoiceRequest<unknown>, answer: V2ChoiceAnswer,
  candidates: readonly ObjectChoiceCandidate[], mode: "select-objects" | "order"): readonly ObjectRef[] | null {
  if (request.type !== "select-objects" && request.type !== "order") return null;
  if (!Array.isArray(answer)) return null;
  const min = request.type === "select-objects" ? request.min : request.options.length;
  const max = request.type === "select-objects" ? request.max : request.options.length;
  if (answer.length < min || answer.length > max) return null;
  const options = new Map<string, ObjectRef>(candidates.map(candidate => [
    `${candidate.objectRef.objectId}:${candidate.objectRef.zoneEntryId}`, candidate.ref,
  ] as const));
  const picked = new Set<string>();
  const refs: ObjectRef[] = [];
  for (const value of answer) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const ref = value as { readonly objectId?: unknown; readonly zoneEntryId?: unknown };
    if (typeof ref.objectId !== "string" || !Number.isSafeInteger(ref.zoneEntryId) || Number(ref.zoneEntryId) < 0) return null;
    const key = `${ref.objectId}:${String(ref.zoneEntryId)}`;
    const option = options.get(key);
    if (option === undefined || picked.has(key)) return null;
    picked.add(key);
    refs.push(option);
  }
  if (mode === "order" && picked.size !== candidates.length) return null;
  return refs;
}

class MatchRuntime implements EngineRuntime {
  private match: Match | null = null;
  private host: EngineRuntimeHost | null = null;
  private binding: ProgramBinding | null = null;
  private journalWriter: RuntimeJournalWriter | null = null;
  private stateVersion = 0;
  private pending: {
    readonly request: ChoiceRequest<unknown>;
    readonly command: V2Command;
    readonly playerId: string;
    readonly visibilityGrants: readonly RuntimeVisibilityGrant[];
    readonly answers: ReadonlyMap<string, unknown>;
    readonly preparedPlay: PreparedPlay | null;
    readonly source?: V2PendingChoiceSource;
    readonly prompt?: string;
  } | null = null;
  private decisions: ReadonlyMap<string, unknown> | null = null;
  private preparedPlay: PreparedPlay | null = null;
  private choiceVisibilityGrants: readonly RuntimeVisibilityGrant[] = [];
  private readonly seen = new Map<string, SeenCommand>();
  private runtimeOptions: EngineRuntimeOptions;

  constructor(options: EngineRuntimeOptions) { this.runtimeOptions = options; }

  get matchId(): string { return this.runtimeOptions.matchId; }

  start(): EngineRuntime {
    if (this.match) throw new Error("Engine runtime has already started");
    const seats = this.runtimeOptions.seats ?? [{ playerId: "A", name: "Player A" }, { playerId: "B", name: "Player B" }];
    if (seats.length !== 2 || new Set(seats.map(seat => seat.playerId)).size !== 2) throw new TypeError("Engine runtime requires exactly two unique seats");
    let choice: ChoiceRequest<unknown> | null = null;
    let choiceMetadata: ChoiceMetadata = {};
    const normalizedDecks = this.normalizeDecks(this.runtimeOptions.decks);
    const catalogDomains = this.catalogDomains(normalizedDecks);
    const hostState = new RuntimeBoardHost(Object.fromEntries(seats.map(seat => [seat.playerId, seat.name])), request => {
      if (this.decisions !== null && this.decisions.has(request.id)) {
        return structuredClone(this.decisions.get(request.id)) as never;
      }
      choice = request as ChoiceRequest<unknown>;
      const grants = hostState.visibility();
      this.choiceVisibilityGrants = grants;
      const chain = this.match?.flow.chain;
      choiceMetadata = chain === undefined ? {} : this.choiceMetadataAtPending(request, hostState, grants,
        chain.pipeline.registeredTriggers(), chain.items as readonly ChainChoiceItem[]);
      throw new PendingChoiceError(request as ChoiceRequest<unknown>, choiceMetadata);
    }, catalogDomains);
    this.host = hostState;
    const pipelineHost = createActionPipelineHost({
      checkpoint: () => hostState.checkpoint(), restore: checkpoint => hostState.restore(checkpoint), objects: () => hostState.objects(),
      perform: action => hostState.perform(action), choose: request => hostState.choose(request),
      performContract: action => hostState.performContract(action),
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
      this.binding = createProgramBinding({
        cardPrograms: this.runtimeOptions.programs,
        ...(this.runtimeOptions.printedCatalog === undefined
          ? {}
          : { printedCatalog: this.runtimeOptions.printedCatalog }),
        staticBinder: createEngineStaticBinder(this.match.flow.chain),
      });
      this.binding.attachLifecycle(this.match.flow.chain);
    }
    for (const field of this.match.flow.battlefields) {
      const battlefield = hostState.objects().find(object => object.ref.id === field.id);
      if (battlefield) hostState.registerBattlefield(battlefield.owner, field.id);
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
    this.syncHiddenTurn();
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
      this.appendJournal(playerId, command, duplicate, duplicate.result ?? { accepted: true }, true, undefined, undefined);
      return { receipt: duplicate, projection: this.projectFor(playerId) };
    }
    if (command.stateVersion !== this.stateVersion) return this.rejected(command, playerId, `stateVersion mismatch: expected ${this.stateVersion}, received ${command.stateVersion}`);
    if (command.type === "choose") return this.choose(playerId, command);
    try {
      return this.atomicCommand(() => this.executeAndCommit(playerId, command));
    } catch (error) {
      if (error instanceof PendingChoiceError) {
        this.pending = { request: error.request, command: structuredClone(command), playerId,
          visibilityGrants: this.choiceVisibilityGrants, answers: new Map(),
          preparedPlay: this.preparedPlay, ...(error.metadata.source === undefined ? {} : { source: error.metadata.source }),
          ...(error.metadata.prompt === undefined ? {} : { prompt: error.metadata.prompt }) };
        const receipt: RuntimeReceipt = { commandId: command.commandId, status: "pending", stateVersion: this.stateVersion, eventSeq: this.match!.events().length, choice: { choiceId: error.request.id, ownerPlayerId: error.request.chooser, stateVersion: this.stateVersion } };
        this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
        this.appendJournal(playerId, command, receipt, { pending: true, choice: receipt.choice! }, false, {
          choiceId: error.request.id,
          ownerPlayerId: error.request.chooser,
          kind: error.request.type,
        }, undefined);
        return { receipt, projection: this.projectFor(playerId) };
      }
      return this.rejected(command, playerId, error instanceof Error ? error.message : String(error));
    }
  }

  projectFor(playerId: PlayerId | null): V2Projection {
    this.requireStarted();
    const snapshot = projectionSnapshot(this.match!, this.host!, this.runtimeOptions.matchId, this.stateVersion);
    return this.projectForSnapshot(playerId, snapshot);
  }

  private projectForSnapshot(playerId: PlayerId | null,
    snapshot: Parameters<typeof projectRuntimeFromSnapshot>[6]): V2Projection {
    const projection = projectRuntimeFromSnapshot(this.match!, this.host!, this.runtimeOptions.matchId,
      playerId, this.stateVersion, this.pendingChoiceFor(playerId), snapshot);
    return withChoiceMetadata(projection, this.pending);
  }

  journal(): RuntimeJournal {
    if (!this.journalWriter) throw new Error("Engine runtime has not started");
    return this.journalWriter.snapshot();
  }

  restore(journal: RuntimeJournal): EngineRuntime {
    assertRuntimeJournal(journal);
    if (journal.header.matchId !== this.runtimeOptions.matchId) throw new Error("Journal matchId does not match runtime");
    const options = this.runtimeOptions;
    this.match = null; this.host = null; this.binding = null; this.journalWriter = null; this.stateVersion = 0;
    this.pending = null; this.decisions = null; this.preparedPlay = null; this.choiceVisibilityGrants = []; this.seen.clear();
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
    let decision: unknown = command.answer;
    if (original.request.type === "select-objects" || original.request.type === "order") {
      const candidates = objectChoiceCandidates(original.request, this.host!, playerId, original.visibilityGrants);
      const refs = orderedChoiceAnswer(original.request, command.answer, candidates, original.request.type);
      if (refs === null) return this.rejected(command, playerId, original.request.type === "order"
        ? "Order choice must be a permutation of the projected object references"
        : "Object choice must contain unique projected references within its bounds");
      decision = refs;
    }
    const answers = new Map(original.answers);
    answers.set(original.request.id, decision);
    this.pending = null; this.decisions = answers;
    try {
      return this.atomicCommand(() => {
        this.execute(original.playerId, original.command);
        const receipt = { commandId: command.commandId, status: "accepted" as const, stateVersion: this.stateVersion + 1,
          eventSeq: this.match!.events().length, result: { resumedCommandId: original.command.commandId, accepted: true } };
        this.stateVersion += 1;
        const snapshot = projectionSnapshot(this.match!, this.host!, this.runtimeOptions.matchId, this.stateVersion);
        const projection = this.projectForSnapshot(playerId, snapshot);
        this.appendJournal(playerId, command, receipt, receipt.result!, false, undefined, projection, snapshot);
        this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
        this.decisions = null;
        this.preparedPlay = null;
        this.choiceVisibilityGrants = [];
        return { receipt, projection };
      });
    } catch (error) {
      if (error instanceof PendingChoiceError) {
        this.pending = { request: error.request, command: original.command, playerId: original.playerId,
          visibilityGrants: this.choiceVisibilityGrants, answers,
          preparedPlay: this.preparedPlay, ...(error.metadata.source === undefined ? {} : { source: error.metadata.source }),
          ...(error.metadata.prompt === undefined ? {} : { prompt: error.metadata.prompt }) };
        const receipt: RuntimeReceipt = { commandId: command.commandId, status: "pending", stateVersion: this.stateVersion,
          eventSeq: this.match!.events().length, choice: { choiceId: error.request.id, ownerPlayerId: error.request.chooser, stateVersion: this.stateVersion } };
        this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
        this.appendJournal(playerId, command, receipt, { pending: true, choice: receipt.choice! }, false, {
          choiceId: error.request.id, ownerPlayerId: error.request.chooser, kind: error.request.type,
        }, undefined);
        return { receipt, projection: this.projectFor(playerId) };
      }
      this.decisions = null; this.pending = original; this.preparedPlay = original.preparedPlay;
      this.choiceVisibilityGrants = original.visibilityGrants;
      return this.rejected(command, playerId, error instanceof Error ? error.message : String(error));
    }
  }

  private execute(playerId: string, command: V2Command): Record<string, unknown> {
    const match = this.match!;
    // Concede also owns its winner outside the object host, so the outer
    // Command transaction includes it with the same rollback boundary.
    if (command.type === "concede") { concede(match, playerId); return { accepted: true, winnerPlayerId: match.result().winner }; }
    return this.executeValidatedCommand(match, playerId, command);
  }

  private executeValidatedCommand(match: Match, playerId: string, command: Exclude<V2Command, { readonly type: "concede" }>): Record<string, unknown> {
    if (command.type === "pass") {
      if (match.flow.chain.items.some(item => item.status === "pending")) {
        // Finalize choices are part of the chain and may suspend before the
        // priority holder can pass. Resume Finalize here; resolve passes through
        // the normal chain priority after the item is finalized.
        match.flow.chain.advance();
        match.flow.advance();
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
      const execution = moveUnits({ match, stateVersion: this.stateVersion }, playerId,
        [command.objectId], command.to);
      return {
        accepted: true,
        objectId: command.objectId,
        destination: execution.to,
        transactionId: execution.receipt.transactionId ?? null,
      };
    }
    if (command.type === "play") {
      if (!this.binding) throw new Error("No trusted card-program registry is bound");
      if (command.picks !== undefined && command.picks.length > 0) {
        throw new Error("Wire picks require the authoritative Finalize pick adapter");
      }
      const source = this.resolveObject(command.cardObjectId);
      this.assertCanControl(playerId, source.ref);
      const location = command.destination === undefined
        ? undefined
        : this.resolvePlayDestination(command.destination, playerId, source);
      const prepared = this.preparedPlay?.playerId === playerId &&
          this.preparedPlay.objectId === command.cardObjectId &&
          this.preparedPlay.commandId === command.commandId &&
          this.preparedPlay.stateVersion === command.stateVersion
        ? this.preparedPlay.base : undefined;
      const base = prepared ?? this.binding.describePlay({
          type: "play", object: source.ref, player: playerId,
          ...(source.types.some(type => ["unit", "gear"].includes(type.toLowerCase())) && location !== undefined
            ? { location } : {}),
        }, source);
      this.preparedPlay = { playerId, objectId: command.cardObjectId, commandId: command.commandId,
        stateVersion: command.stateVersion, base };
      const targets = this.finalizeTargets(base.body, base.targets, command.targets, playerId);
      const selections = command.cost;
      if (selections !== undefined && (selections.energy !== undefined || selections.power !== undefined || selections.xp !== undefined ||
          selections.exhaustObjectIds !== undefined || selections.recycleObjectIds !== undefined || selections.hidden !== undefined)) {
        throw new Error("Explicit finalized cost components require the external Pay Costs continuation");
      }
      const cost = selections === undefined || selections.optionId === undefined ? base.cost : {
        ...(base.cost ?? { id: `wire-cost:${command.commandId}`, cost: { kind: "printed" as const } }),
        baseChoice: selections.optionId,
      };
      const draft = {
        ...base,
        ...(targets.length === 0 ? {} : { targets }),
        ...(cost === undefined ? {} : { cost }),
      };
      match.flow.execute(draft);
      return {
        accepted: true,
        objectId: command.cardObjectId,
        targets: targets.length,
        destination: location ?? { type: "base", player: playerId },
      };
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
    if (command.type === "end-turn") {
      match.flow.endTurn(playerId);
      return { accepted: true, activePlayerId: match.flow.turnPlayer };
    }
    if (command.type === "advance") {
      if (advanceResponsiblePlayer(match, this.pending !== null, playerId) !== playerId) {
        throw new Error("Advance is only available to the projected responsible Turn Player " +
          "after a Combat Showdown closes with a stable empty Chain and no pending choice");
      }
      if (match.flow.combat.current?.step === "showdown" && match.flow.chain.focus === null) {
        match.flow.combat.prepareDamage();
        return { accepted: true, activePlayerId: match.flow.turnPlayer, combatStep: "damage" };
      }
      throw new Error("Advance is not available in the current Combat Showdown");
    }
    if (command.type === "combat-damage") return this.executeCombatDamage(playerId, command);
    if (command.type === "declare-attack" || command.type === "declare-defense") {
      throw new Error(`${command.type} is not available: CR 466.2.c assigns all present Units automatically`);
    }
    throw new Error(`Unhandled runtime command: ${(command as { readonly type?: unknown }).type ?? "unknown"}`);
  }

  private resolveObject(id: string): ReturnType<EngineRuntimeHost["objects"]>[number] {
    const object = this.host!.objects().find(candidate => candidate.ref.id === id); if (!object) throw new Error(`Unknown object ${id}`); return object;
  }

  private atomicChain(): AtomicChain { return this.match!.flow.chain as unknown as AtomicChain; }

  /** Execute and commit exactly one network command inside the same rollback. */
  private executeAndCommit(playerId: string, command: V2Command): RuntimeSubmitResult {
    const result = this.execute(playerId, command);
    this.stateVersion += 1;
    this.runtimeOptions.afterCommandExecution?.(command, {
      stateVersion: this.stateVersion,
      eventSeq: this.match!.events().length,
    });
    const receipt: RuntimeReceipt = { commandId: command.commandId, status: "accepted", stateVersion: this.stateVersion,
      eventSeq: this.match!.events().length, result };
    const snapshot = projectionSnapshot(this.match!, this.host!, this.runtimeOptions.matchId, this.stateVersion);
    const projection = this.projectForSnapshot(playerId, snapshot);
    this.appendJournal(playerId, command, receipt, result, false, undefined, projection, snapshot);
    this.seen.set(command.commandId, { playerId, command: structuredClone(command), receipt });
    if (this.preparedPlay?.playerId === playerId && this.preparedPlay.commandId === command.commandId) {
      this.preparedPlay = null;
    }
    return { receipt, projection };
  }

  private metadataCheckpoint(): RuntimeMetadataCheckpoint {
    return { stateVersion: this.stateVersion, pending: this.pending, decisions: this.decisions,
      preparedPlay: this.preparedPlay,
      visibilityGrants: this.choiceVisibilityGrants, seen: new Map(this.seen) };
  }

  private restoreMetadata(before: RuntimeMetadataCheckpoint): void {
    this.stateVersion = before.stateVersion;
    this.pending = before.pending;
    this.decisions = before.decisions;
    this.preparedPlay = before.preparedPlay;
    this.choiceVisibilityGrants = before.visibilityGrants;
    this.seen.clear();
    for (const [commandId, seen] of before.seen) this.seen.set(commandId, seen);
  }

  /** One command transaction: all synchronous authoritative owners. */
  private atomicCommand<T>(run: () => T): T {
    const chain = this.atomicChain();
    const flow = this.match!.flow as unknown as TurnFlowCheckpoint;
    const metadata = this.metadataCheckpoint();
    const flowCheckpoint = flow.checkpoint();
    try {
      this.syncHiddenTurn();
      return chain.atomic(run);
    } catch (error) {
      const suspended = error instanceof PendingChoiceError ? {
        decisions: this.decisions,
        preparedPlay: this.preparedPlay,
      } : null;
      flow.restore(flowCheckpoint);
      const grants = error instanceof PendingChoiceError ? this.choiceVisibilityGrants : metadata.visibilityGrants;
      this.restoreMetadata(metadata);
      if (suspended !== null) {
        this.choiceVisibilityGrants = grants;
        // A suspended command is a commit point for the frozen choice replay
        // state only. Objects, TurnFlow, receipts and seen commands still roll
        // back to the pre-command checkpoint above.
        this.decisions = suspended.decisions;
        this.preparedPlay = suspended.preparedPlay;
      }
      throw error;
    }
  }

  private resolveObjectRef(id: string, _stateVersion: number): ObjectRef { return this.resolveObject(id).ref; }

  private resolvePlayDestination(destination: V2Location, playerId: string,
    source: ReturnType<EngineRuntimeHost["objects"]>[number]): LocationRef {
    if (!source.types.some(type => ["unit", "gear"].includes(type.toLowerCase()))) {
      throw new Error("Play destination is only valid for a Unit or Gear");
    }
    let location: LocationRef;
    if (destination.kind === "base") {
      if (destination.playerId !== playerId) throw new Error("A permanent may only be played to its controller's Base");
      location = { type: "base", player: playerId };
    } else {
      const battlefield = this.match!.flow.battlefields.find(field => field.id === destination.battlefieldId);
      if (!battlefield) throw new Error(`Unknown Battlefield ${destination.battlefieldId}`);
      location = { type: "battlefield", id: battlefield.id };
    }
    const battlefield = location.type === "battlefield"
      ? this.match!.flow.battlefields.find(field => field.id === location.id) ?? null : null;
    const rulePermission = playPermissionAllows(this.match!.flow.layers.registry, source, location, {
      player: playerId,
      state: battlefield === null ? undefined : {
        ref: location, owner: battlefield.id, controller: battlefield.controller,
        occupied: this.host!.objects().some(object => object.zone === "board" &&
          object.types.includes("unit") && object.location?.type === "battlefield" &&
          object.location.id === battlefield.id),
        contested: battlefield.contestedBy !== null,
        units: this.host!.objects().filter(object => object.zone === "board" &&
          object.types.includes("unit") && object.location?.type === "battlefield" &&
          object.location.id === battlefield.id).map(object => object.ref),
      },
      objects: this.host!.objects(),
    });
    const defaultPermission = destination.kind === "base" || battlefield?.controller === playerId;
    if (!defaultPermission && !rulePermission) {
      throw new Error("A permanent may only be played to its controller's Base or a permitted Battlefield");
    }
    return location;
  }

  private executeCombatDamage(playerId: string, command: V2CombatDamageCommand): Record<string, unknown> {
    const match = this.match!;
    if (this.pending) throw new Error("Combat damage cannot continue while another choice is pending");
    if (match.flow.chain.items.length > 0) throw new Error("Combat damage requires an idle Chain");
    let combat = match.flow.combat.current;
    if (combat === null) throw new Error("No Combat is active");
    if (combat.attacker === undefined || combat.defender === undefined || combat.combatId === undefined) {
      throw new Error("Combat damage requires an active Combat Showdown");
    }
    if (command.combatId !== combat.combatId) throw new Error(`Combat ${command.combatId} is no longer current`);
    if (combat.step === "showdown" && match.flow.chain.turnState === "neutral-open") {
      if (playerId !== combat.attacker) throw new Error("Only the Attacker may submit the first Combat allocation");
      match.flow.combat.prepareDamage();
      combat = match.flow.combat.current;
    }
    if (combat?.step !== "damage") throw new Error(`Combat damage is not available during ${combat?.step ?? "no step"}`);
    const view = match.flow.combat.damageView();
    if (command.combatId !== view.combatId) throw new Error(`Combat ${command.combatId} is no longer current`);
    const assignments = command.assignments.map(assignment => ({
      uid: assignment.unitObjectId,
      amount: assignment.amount,
    }));
    if (!view.attackerSubmitted) {
      match.flow.combat.submitAttackerDamage(playerId, assignments);
      return { accepted: true, combatId: view.combatId, submittedBy: playerId,
        nextPlayerId: view.defenderPlayerId, complete: false };
    }
    const result = match.flow.combat.submitDefenderDamage(playerId, assignments);
    this.advanceCombatUntilBlocked();
    return { accepted: true, combatId: result.combatId, submittedBy: playerId,
      batchId: result.batchId, complete: true };
  }

  private advanceCombatUntilBlocked(): void {
    const match = this.match!;
    for (let step = 0; step < 64; step += 1) {
      if (!match.flow.combat.active || match.flow.chain.items.length > 0) return;
      const before = JSON.stringify({
        step: match.flow.combat.current?.step ?? null,
        turnState: match.flow.chain.turnState,
        events: match.events().length,
      });
      match.flow.advance();
      const after = JSON.stringify({
        step: match.flow.combat.current?.step ?? null,
        turnState: match.flow.chain.turnState,
        events: match.events().length,
      });
      if (before === after) return;
    }
    throw new Error("Combat did not reach a stable public boundary");
  }

  private assertCanControl(playerId: string, ref: ObjectRef): void {
    const object = this.host!.object(ref);
    if (!object) throw new Error(`Unknown object ${ref.id}`);
    if (object.controller !== playerId) throw new Error("Player does not control object");
  }

  private finalizeTargets(
    body: ReturnType<ProgramBinding["describePlay"]>["body"],
    specs: ReturnType<ProgramBinding["describePlay"]>["targets"],
    selections: Extract<V2Command, { type: "play" }>["targets"],
    actor: PlayerId,
  ): Array<NonNullable<ReturnType<ProgramBinding["describePlay"]>["targets"]>[number]> {
    const requirements: Array<NonNullable<ReturnType<ProgramBinding["describePlay"]>["targets"]>[number]> = specs === undefined
      ? body.flatMap(instruction => (instruction.targets ?? []).map(requirement => ({ requirement })))
      : [...specs];
    if (selections === undefined || selections.length === 0) return [];
    const assigned = new Set<string>();
    const finalized: Array<NonNullable<ReturnType<ProgramBinding["describePlay"]>["targets"]>[number]> = [];
    for (const selection of selections) {
      if (selection.kind !== "object") throw new Error("Only object target selections are supported for Finalize");
      const matches = requirements.filter(candidate => !assigned.has(candidate.requirement.id) && this.targetMatches(candidate.requirement, selection, actor));
      if (matches.length !== 1) throw new Error(`Target selection ${selection.objectId} does not match exactly one requirement`);
      const target = matches[0]!;
      const object = this.resolveObject(selection.objectId);
      if (selection.zoneEntryId !== undefined && object.ref.zoneEntryId !== selection.zoneEntryId) throw new Error(`Stale target ${selection.objectId}`);
      if (target.options?.selected !== undefined) throw new Error(`Target requirement ${target.requirement.id} was already finalized`);
      assigned.add(target.requirement.id);
      finalized.push({ ...target, options: { ...(target.options ?? {}), selected: [object.ref] } });
    }
    for (const requirement of requirements) {
      if (assigned.has(requirement.requirement.id)) continue;
      const min = requirement.requirement.min ?? (requirement.requirement.selection === "up-to" ? 0 : 1);
      if (min > 0) throw new Error(`Target requirement ${requirement.requirement.id} has no finalized target`);
      finalized.push({ ...requirement, options: { ...(requirement.options ?? {}), selected: [] } });
    }
    return finalized;
  }

  private targetMatches(requirement: { readonly filter: Record<string, unknown> }, selection: {
    readonly kind: "object"; readonly objectId: string; readonly zoneEntryId?: number;
  }, actor: PlayerId): boolean {
    const filter = requirement.filter;
    const value = this.resolveObject(selection.objectId);
    if (value.ref.zoneEntryId !== (selection.zoneEntryId ?? value.ref.zoneEntryId)) return false;
    const types = value.types.map(type => type.toLowerCase());
    if (filter.type !== undefined) {
      const wanted = Array.isArray(filter.type) ? filter.type.map(String) : [String(filter.type)];
      if (!wanted.some(type => types.includes(type.toLowerCase()))) return false;
    }
    if (filter.zone !== undefined && filter.zone !== value.zone) return false;
    if (filter.controller !== undefined) {
      const wanted = typeof filter.controller === "string" ? filter.controller : undefined;
      if (wanted === "you" || wanted === "self" || wanted === "controller") return value.controller === actor;
      if (wanted === "opponent") return value.controller !== actor;
      if (wanted !== undefined && wanted !== "any" && value.controller !== wanted) return false;
    }
    return true;
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
    duplicate: boolean,
    pendingReason: Readonly<Record<string, unknown>> | undefined,
    actorProjection: V2Projection | undefined,
    sharedSnapshot?: Parameters<typeof projectRuntimeFromSnapshot>[6],
  ): RuntimeJournalEntry {
    const writer = this.journalWriter!;
    const viewers = Object.keys(this.host!.playerNames());
    const snapshot = sharedSnapshot ??
      projectionSnapshot(this.match!, this.host!, this.runtimeOptions.matchId, this.stateVersion);
    const projectionFor = (viewer: string | null) => projectRuntimeFromSnapshot(
      this.match!, this.host!, this.runtimeOptions.matchId, viewer, this.stateVersion,
      this.pendingChoiceFor(viewer), snapshot,
    );
    const spectator = projectionFor(null);
    const projections = [
      actorProjection !== undefined && playerId === viewers[0]
        ? actorProjection : withChoiceMetadata(projectionFor(viewers[0]!), this.pending),
      actorProjection !== undefined && playerId === viewers[1]
        ? actorProjection : withChoiceMetadata(projectionFor(viewers[1]!), this.pending),
      spectator,
    ] as const;
    const canonical = projections.map(projectionCanonicalJson);
    const projectionDigests = canonical.map(digestCanonicalJson);
    return writer.append({
      playerId, actor: playerId, requestId: command.commandId, commandId: command.commandId, command, payload: command,
      acceptedAt: new Date(0).toISOString(),
      expectedStateVersion: duplicate || receipt.status === "pending" ? this.stateVersion : Math.max(0, this.stateVersion - 1),
      expectedRoomVersion: 0,
      appliedStateVersion: this.stateVersion, roomVersion: 0, eventSeq: this.match!.events().length, result, publicReceipt: receipt as unknown as Record<string, unknown>,
      duplicate, rejection: null, ...(pendingReason ? { pendingReason } : {}), entropyConsumed: [],
      projectionDigestByViewer: {
        spectator: projectionDigests[2]!, [viewers[0]!]: projectionDigests[0]!,
        [viewers[1]!]: projectionDigests[1]!,
      },
      stateDigest: projectionDigests[2],
      privateStateDigest: digestCanonicalJson(`[${canonical[0]},${canonical[1]}]`),
    });
  }

  private pendingChoiceFor(viewer: string | null): Parameters<typeof projectRuntime>[5] {
    if (!this.pending) return null;
    const request = this.pending.request;
    const registeredTriggers = this.match?.flow.chain.pipeline.registeredTriggers() ?? [];
    const options = this.host ? choiceOptions(request, this.host, viewer, this.pending.visibilityGrants,
      registeredTriggers, this.pending.source) : undefined;
    return {
      choiceId: request.id,
      ownerPlayerId: request.chooser,
      stateVersion: this.stateVersion,
      kind: request.type,
      ...(options === undefined || options.length === 0 ? {} : { options }),
      ...choiceBounds(request),
    };
  }

  private choiceMetadataAtPending(request: ChoiceRequest<unknown>, host: EngineRuntimeHost,
    grants: readonly RuntimeVisibilityGrant[], registeredTriggers: readonly TriggerRegistrationSource[],
    chainItems: readonly ChainChoiceItem[]): ChoiceMetadata {
    return choiceMetadataRequest(request, host, request.chooser, grants, registeredTriggers, chainItems, this.binding);
  }

  private requireStarted(): void { if (!this.match || !this.host || !this.journalWriter) throw new Error("Engine runtime has not started"); }

  private syncHiddenTurn(): void {
    if (!this.match || !this.host) return;
    this.host.advanceTurn(Math.max(this.match.flow.turn, 1));
  }

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
