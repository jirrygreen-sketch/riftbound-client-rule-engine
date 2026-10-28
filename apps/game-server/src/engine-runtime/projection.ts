import type {
  V2ActionOptions,
  V2BattlefieldSnapshot,
  V2ChoiceOption,
  V2ChainSnapshot,
  V2Command,
  V2CombatSnapshot,
  V2Event,
  V2Phase,
  V2PlayOption,
  V2Projection,
  V2ProjectedObject,
  V2PlayTargetRequirement,
  V2Zone,
} from "../../../../packages/protocol/dist/v2/index.js";
import { playLocations, restrictions as ruleRestrictions } from "../../../../packages/engine-core/dist/layers/rules/query.js";
import type { Match } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import type { ObjectRef, ObjectSnapshot, PlayerId } from "../../../../packages/engine-core/dist/effects/contract.js";
import { playPermissionAllows, playPermissions } from "../../../../packages/engine-core/dist/programs/play-permissions.js";
import { queryTargetCandidates, type TargetRequirement } from "../../../../packages/engine-core/dist/target/target-plan.js";
import { readEmpowered } from "../../../../packages/engine-core/dist/zones/empower-state.js";
import type { EngineRuntimeHost } from "./host.js";
import { canonicalJson, digest } from "./journal.js";

const zoneNames: readonly V2Zone[] = ["base", "board", "battlefield", "champion", "legend", "rune-zone", "hand", "deck", "rune-deck", "trash", "banishment", "chain", "facedown"];

function v2Zone(zone: ObjectSnapshot["zone"]): V2Zone {
  return zone as V2Zone;
}

function phase(match: Match): V2Phase {
  if (match.result().winner !== null) return "ended";
  switch (match.flow.phase) {
    case "awaken": return "awaken";
    case "beginning": return "beginning";
    case "channel": return "channel";
    case "draw": return "draw";
    case "main": return "main";
    case "ending": return "ending";
    default: return match.result().winner ? "ended" : "setup";
  }
}

function hiddenId(viewer: string | null, object: ObjectSnapshot): string {
  return `hidden:${digest([viewer ?? "spectator", object.ref.id, object.ref.zoneEntryId ?? 0]).slice(0, 32)}`;
}

const objectRefKey = (object: ObjectSnapshot): string => `${object.ref.id}:${object.ref.zoneEntryId ?? 0}`;

/** Projection expects a live object; private grants improve metadata, never invent an incarnation. */
export function projectObjectForChoice(
  object: ObjectSnapshot,
  viewer: string | null,
  grants: ReturnType<EngineRuntimeHost["visibility"]>,
): V2ProjectedObject {
  return projectedObject(object, viewer, grants);
}

function isPublic(object: ObjectSnapshot, viewer: string | null, grants: ReturnType<EngineRuntimeHost["visibility"]>): boolean {
  if (object.faceDown) return false;
  if (object.zone !== "hand" && object.zone !== "deck" && object.zone !== "rune-deck") return true;
  if (viewer !== null && object.controller === viewer) return true;
  return grants.some(grant => grant.active && grant.object.id === object.ref.id && grant.object.zoneEntryId === object.ref.zoneEntryId && grant.viewers.includes(viewer ?? ""));
}

function projectedObject(object: ObjectSnapshot, viewer: string | null, grants: ReturnType<EngineRuntimeHost["visibility"]>): V2ProjectedObject {
  const visible = isPublic(object, viewer, grants);
  // A hidden opponent hand card is represented in the protocol's facedown
  // zone. Keeping it in `hand` with public visibility would expose a
  // hand-zone object even though its identity is redacted.
  const zone = !visible && (object.faceDown || object.zone === "hand") ? "facedown" : v2Zone(object.zone);
  const hidden = !visible || zone === "deck" || zone === "rune-deck";
  const value: Record<string, unknown> = {
    objectId: hidden ? hiddenId(viewer, object) : object.ref.id,
    zoneEntryId: object.ref.zoneEntryId,
    zone,
    ownerPlayerId: object.owner,
    ...(object.controller !== object.owner ? { controllerPlayerId: object.controller } : {}),
    faceDown: hidden || object.faceDown,
    visibility: object.owner === viewer && visible ? "owner-only" : "public",
  };
  if (object.location?.type === "base") value.location = { kind: "base", playerId: object.location.player };
  if (object.location?.type === "battlefield") value.location = { kind: "battlefield", battlefieldId: object.location.id };
  if (!hidden) {
    if (object.cardId !== null) value.cardId = object.cardId;
    value.name = object.name;
    value.exhausted = object.exhausted;
    value.damage = object.damage;
    if (object.might !== null) value.might = object.might;
    // Protocol v2 has one generic counter map rather than dedicated Buff and
    // Empowered fields. Preserve the authoritative carriers under distinct
    // keys; never infer Empowered from the ordinary Buff count. The runtime
    // host emits both compatibility spellings from empoweredState().
    const empowered = readEmpowered(object);
    const ordinaryCounters = (object as ObjectSnapshot & {
      readonly counters?: Readonly<Record<string, number>>;
    }).counters ?? {};
    value.counters = {
      ...ordinaryCounters,
      buffs: object.buffs,
      empowered,
      empoweredCount: empowered,
    };
  }
  return value as unknown as V2ProjectedObject;
}

/**
 * The public player responsible for continuing a Combat Showdown after both
 * Focus passes. The Chain has returned to neutral/open with no items or Focus,
 * and renewed Priority belongs to the current Turn Player. This is deliberately
 * narrower than "any state where TurnFlow.advance() changes something".
 */
export function advanceResponsiblePlayer(match: Match, pendingChoice: boolean,
  viewer: PlayerId | null): PlayerId | null {
  const chain = match.flow.chain;
  const combat = match.flow.combat.current;
  if (viewer === null || pendingChoice || match.result().winner !== null || match.flow.phase !== "main" ||
      combat?.step !== "showdown" || chain.turnState !== "neutral-open" ||
      chain.items.length !== 0 || chain.focus !== null ||
      chain.priority === null || chain.priority !== match.flow.turnPlayer ||
      chain.priority !== viewer) return null;
  return viewer;
}

/** CR 467.2.c-d makes each player's damage allocation mandatory in sequence. */
export function isCombatDamageAssignment(match: Match): boolean {
  return match.flow.combat.current?.step === "damage";
}

/**
 * Mirror the public runtime's `pass` routing without mutating the Match.
 * Pending Finalize is resumed by the runtime; an idle neutral Main Phase is
 * an end-turn request; every other pass is owned by ChainEngine.canPass.
 */
export function canPassForViewer(match: Match, pendingChoice: boolean, viewer: PlayerId | null): boolean {
  if (viewer === null || pendingChoice || match.result().winner !== null || isCombatDamageAssignment(match)) return false;
  const chain = match.flow.chain;
  if (chain.items.some(item => item.status === "pending")) return true;
  if (!chain.items.length && !match.flow.combat.active) {
    // This is the exact condition evaluated by TurnFlow.endTurn after its own
    // `advance()` pass. Reusing it keeps the projection aligned with the real
    // command rather than approximating end-turn eligibility from Priority.
    return match.flow.phase === "main" && chain.canAct(viewer, "normal");
  }
  // The method is private in the Engine TypeScript surface so only production
  // rules code can expose it; this read-only call still targets that exact
  // implementation rather than duplicating its internal state checks.
  return (chain as unknown as { canPass(player: PlayerId): boolean }).canPass(viewer);
}

function actionOptions(match: Match, host: EngineRuntimeHost, viewer: string | null,
  pendingChoice: boolean): V2ActionOptions {
  const canAdvance = advanceResponsiblePlayer(match, pendingChoice, viewer) !== null;
  const canPass = canPassForViewer(match, pendingChoice, viewer);
  if (viewer === null || match.result().winner !== null || match.flow.phase !== "main") {
    return { canEndTurn: false, canAdvance, canPass, moves: [], plays: [] };
  }
  const chain = match.flow.chain;
  const priority = chain.priority;
  const waitingForFutureCommand = chain.items.length === 0 && !match.flow.combat.active &&
    match.flow.phase === "main" && chain.turnState === "neutral-open" && priority === null;
  const open = !match.flow.combat.active && chain.turnState === "neutral-open" &&
    (chain.canAct(viewer, "normal") || waitingForFutureCommand);
  const canEndTurn = viewer === match.flow.turnPlayer && open;
  if ((priority !== viewer && !waitingForFutureCommand) || !open || chain.items.length > 0) {
    return { canEndTurn, canAdvance, canPass, moves: [], plays: [] };
  }
  const objects = host.objects();
  const battlefields = match.flow.battlefields;
  const moves: V2ActionOptions["moves"][number][] = [];
  for (const object of objects) {
    if (object.controller !== viewer || object.zone !== "board" || !object.types.includes("unit") ||
        object.exhausted || object.location === null) continue;
    if (object.location.type === "battlefield") {
      moves.push({ objectId: object.ref.id, destination: { kind: "base", playerId: viewer } });
    }
    if (object.location.type === "base" || object.location.type === "battlefield") {
      for (const field of battlefields) {
        if (object.location.type === "battlefield" && object.location.id === field.id) continue;
        if (object.location.type === "base" || object.keywords.some(keyword =>
          keyword.id.toLowerCase().replace(/[\s_-]+/g, "") === "ganking")) {
          moves.push({ objectId: object.ref.id, destination: { kind: "battlefield", battlefieldId: field.id } });
        }
      }
    }
  }
  const plays: V2ActionOptions["plays"][number][] = [];
  const energy = host.player(viewer).energy;
  const power = host.player(viewer).power;
  const binding = match.programBinding;
  const printedCatalog = binding === undefined ? undefined :
    (binding.describePlay as typeof binding.describePlay & {
      readonly printedCatalog?: (canonicalCardId: string) => {
        readonly domains: readonly string[];
        readonly energy: number | null;
        readonly power: number | null;
      } | undefined;
    }).printedCatalog;
  const hasTargets = (source: ObjectSnapshot): boolean => {
    const program = binding?.registry.inspect(source.cardId);
    if (program === undefined || program.status !== "executable") return false;
    const ability = program.abilities.find(candidate => candidate.kind === "play");
    if (ability === undefined || ability.kind !== "play") return false;
    return ability.body.some(instruction => (instruction.targets?.length ?? 0) > 0);
  };
  const canPay = (source: ObjectSnapshot): boolean => {
    const row = source.cardId === null ? undefined : printedCatalog?.(source.cardId);
    const printedEnergy = row?.energy ?? source.energy;
    if (printedEnergy === null || printedEnergy! > energy) return false;
    const requiredPower = row === undefined ? (source.power ?? []).length : row.power ?? 0;
    if (requiredPower === 0) return true;
    const allowed = row?.domains ?? source.power ?? [];
    return power.filter(source => allowed.includes(source) || source === "universal" ||
      source === "any" || source === "universal-power").length >= requiredPower;
  };
  const explicitPermissions = (source: ObjectSnapshot) => playPermissions(chain.layers.registry, source);
  // `undefined` means the trusted ability has no direct target requirement.
  // `null` means this exact play is unavailable because a mandatory group has
  // no visible, legal candidate. No hidden zone or opponent hand can enter.
  const targetRequirements = (source: ObjectSnapshot): V2PlayOption["targetRequirements"] | null | undefined => {
    if (!hasTargets(source)) return undefined;
    if (binding === undefined) return null;
    let draft: ReturnType<typeof binding.describePlay>;
    try {
      draft = binding.describePlay({ type: "play", object: source.ref, player: viewer }, source);
    } catch { return null; }
    const requirements = draft.targets === undefined
      ? draft.body.flatMap(instruction => (instruction.targets ?? []).map(requirement => ({ requirement })))
      : [...draft.targets];
    if (requirements.length === 0) return undefined;
    const context = host.context(source, viewer, "chain-item-finalize");
    const projected: V2PlayTargetRequirement[] = [];
    for (const entry of requirements) {
      const requirement: TargetRequirement = entry.requirement;
      const selection = requirement.selection ?? "one";
      const min = requirement.min ?? (selection === "one" ? 1 : 0);
      const candidates = queryTargetCandidates(context, requirement, {
        ruleRegistry: chain.layers.registry, rulePlayer: viewer,
      });
      const visible = candidates.flatMap(ref => {
        const object = host.object(ref);
        if (object === null) return [];
        const candidate = projectedObject(object, viewer, host.visibility());
        if (candidate.faceDown || object.zone === "hand" || object.zone === "deck" || object.zone === "rune-deck" ||
            ruleRestrictions(chain.layers.registry, "target", ref, object, viewer).length > 0 ||
            ruleRestrictions(chain.layers.registry, "choose-as-target", ref, object, viewer).length > 0) return [];
        return [{ id: candidate.objectId, label: candidate.name ?? candidate.cardId ?? candidate.objectId,
          value: candidate.objectId, objectRef: { objectId: candidate.objectId, zoneEntryId: ref.zoneEntryId } }];
      });
      if (visible.length === 0 && min > 0) return null;
      if (visible.length === 0) continue;
      const max = requirement.max === null || requirement.max === undefined
        ? selection === "one" ? 1 : Math.max(min, visible.length) : requirement.max;
      projected.push({ id: requirement.id, label: requirement.id, kind: "object",
        min, max: Math.min(max, visible.length), options: visible });
    }
    return projected.length === 0 ? undefined : projected;
  };
  if (!chain.items.length) {
    for (const source of objects) {
      if (source.controller !== viewer || source.zone !== "hand" || source.cardId === null ||
          !canPay(source) ||
          (!waitingForFutureCommand && !chain.canAct(viewer, source.types.includes("spell") || source.types.includes("gear") ? "action" : "normal", source.ref, source))) continue;
      const requirements = targetRequirements(source);
      if (requirements === null) continue;
      const unit = source.types.some(type => type.toLowerCase() === "unit");
      const gear = source.types.some(type => type.toLowerCase() === "gear");
      if (!unit && !gear) {
        plays.push({ cardObjectId: source.ref.id, destination: { kind: "base", playerId: viewer },
          requiresDestination: false, ...(requirements === undefined ? {} : { targetRequirements: requirements }) });
        continue;
      }
      const view = playLocations(chain.layers.registry, source.ref, source, viewer);
      if (view.restrictions.some(rule => ["no-base", "cannot-base", "cannot-play-base"].includes(rule.name.toLowerCase()))) continue;
      const permissions = explicitPermissions(source);
      const battlefieldPermission = (field: (typeof battlefields)[number]) =>
        permissions.length > 0 &&
        playPermissionAllows(chain.layers.registry, source, { type: "battlefield", id: field.id }, {
          player: viewer,
          state: {
            ref: { type: "battlefield", id: field.id }, owner: field.id, controller: field.controller,
            occupied: objects.some(object => object.zone === "board" && object.types.includes("unit") &&
              object.location?.type === "battlefield" && object.location.id === field.id),
            contested: field.contestedBy !== null,
            units: objects.filter(object => object.zone === "board" && object.types.includes("unit") &&
              object.location?.type === "battlefield" && object.location.id === field.id).map(object => object.ref),
          },
          objects,
        });
      // CR 355.2.a and 148.1.a.1/149.2 make the viewer's Base a default for
      // Unit and Gear plays. A 355.2.b permission adds locations and does not
      // remove destinations that were already valid. Unit+Gear follows the
      // Unit branch under 152.2/359.2.c.
      plays.push({ cardObjectId: source.ref.id, destination: { kind: "base", playerId: viewer },
        requiresDestination: true, ...(requirements === undefined ? {} : { targetRequirements: requirements }) });
      for (const field of battlefields) {
        if (view.restrictions.some(rule => ["no-battlefield", "cannot-battlefield", "cannot-play-battlefield"].includes(rule.name.toLowerCase()))) continue;
        const defaultLocationMatches = unit && field.controller === viewer;
        const battlefieldPermissionMatches = battlefieldPermission(field);
        if (!defaultLocationMatches && !battlefieldPermissionMatches) continue;
        plays.push({ cardObjectId: source.ref.id, destination: { kind: "battlefield", battlefieldId: field.id },
          requiresDestination: true, ...(requirements === undefined ? {} : { targetRequirements: requirements }) });
      }
    }
  }
  return { canEndTurn, canAdvance, canPass, moves, plays };
}

function battlefieldProjection(match: Match, host: EngineRuntimeHost): readonly V2BattlefieldSnapshot[] {
  const units = host.objects().filter(object => object.zone === "board" && object.types.includes("unit"));
  return match.flow.battlefields.map(field => ({
    battlefieldId: field.id,
    controllerPlayerId: field.controller,
    contestedByPlayerId: field.contestedBy,
    staged: field.staged,
    occupantObjectIds: units.filter(unit => unit.location?.type === "battlefield" &&
      unit.location.id === field.id).map(unit => unit.ref.id),
  }));
}

function combatProjection(match: Match): V2CombatSnapshot {
  const combat = match.flow.combat.current;
  if (combat === null) return { status: "none" };
  if (combat.attacker === undefined || combat.defender === undefined || combat.combatId === undefined) {
    return { status: "active", battlefieldId: combat.field, step: "showdown" };
  }
  if (combat.step === "damage") {
    const view = match.flow.combat.damageView();
    return {
      status: "active", battlefieldId: combat.field, step: combat.step,
      combatId: combat.combatId, attackerPlayerId: combat.attacker, defenderPlayerId: combat.defender,
      damage: {
        attackerMight: view.attackerMight, defenderMight: view.defenderMight,
        attackerSubmitted: view.attackerSubmitted,
        expectedPlayerId: view.attackerSubmitted ? view.defenderPlayerId : view.attackerPlayerId,
      },
    };
  }
  return {
    status: "active", battlefieldId: combat.field, step: combat.step,
    combatId: combat.combatId, attackerPlayerId: combat.attacker, defenderPlayerId: combat.defender,
  };
}

export function projectRuntime(
  match: Match,
  host: EngineRuntimeHost,
  matchId: string,
  viewer: string | null,
  stateVersion: number,
  pendingChoice: { readonly choiceId: string; readonly ownerPlayerId: string; readonly stateVersion: number; readonly kind: "optional" | "mode" | "select-objects" | "order" | "number"; readonly options?: readonly V2ChoiceOption[]; readonly min?: number; readonly max?: number } | null,
): V2Projection {
  return projectRuntimeFromSnapshot(match, host, matchId, viewer, stateVersion, pendingChoice,
    projectionSnapshot(match, host, matchId, stateVersion));
}

/**
 * Read-only state shared by the spectator and both private journal views. Host
 * snapshots are already frozen; derived arrays are frozen without deep cloning
 * authoritative objects. Every viewer-specific value is still rebuilt by
 * `projectRuntimeFromSnapshot`.
 */
export interface RuntimeProjectionSnapshot {
  readonly matchId: string;
  readonly stateVersion: number;
  readonly viewerPlayers: Readonly<Record<string, V2Projection["players"][number]>>;
  readonly events: readonly V2Event[];
  readonly eventPrivateObjects: ReadonlyMap<number, ObjectSnapshot>;
  readonly eventPublicObjects: ReadonlyMap<number, string>;
  readonly playerIds: readonly string[];
  readonly objectSource: readonly ObjectSnapshot[];
  readonly hiddenObjectSource: readonly ObjectSnapshot[];
  readonly visibilityGrants: ReturnType<EngineRuntimeHost["visibility"]>;
  readonly zoneCounts: Readonly<Record<string, V2Projection["players"][number]["zoneCounts"]>>;
  readonly chain: V2ChainSnapshot;
  readonly phase: V2Phase;
  readonly turnNumber: number;
  readonly activePlayerId: string;
  readonly priority: V2Projection["priority"];
  readonly scoring: V2Projection["scoring"];
  readonly battlefields: readonly V2BattlefieldSnapshot[];
  readonly combat: V2CombatSnapshot;
  readonly winnerPlayerId: string | null;
  readonly projectedObjects: Map<string, readonly V2ProjectedObject[]>;
  readonly eventsByViewer: Map<string, readonly V2Event[]>;
  readonly zoneObjects: Readonly<Record<string, Readonly<Record<string, readonly ObjectSnapshot[]>>>>;
}

export function projectionSnapshot(match: Match, host: EngineRuntimeHost, matchId: string,
  stateVersion: number): RuntimeProjectionSnapshot {
  const playerIds = Object.freeze(Object.keys(host.playerNames()));
  const names = host.playerNames();
  const objectSource = host.objects();
  const hiddenObjectSource = Object.freeze([...host.hiddenObjects()]);
  const visibilityGrants = Object.freeze(host.visibility());
  const zoneCounts = Object.fromEntries(playerIds.map(playerId => [playerId, Object.freeze(Object.fromEntries(
    zoneNames.map(zone => [zone, objectSource.filter(object => object.owner === playerId && v2Zone(object.zone) === zone).length]),
  ) as V2Projection["players"][number]["zoneCounts"])])) as Readonly<Record<string, V2Projection["players"][number]["zoneCounts"]>>;
  const viewerPlayers = Object.fromEntries(playerIds.map(playerId => {
    const player = host.player(playerId);
    return [playerId, {
      playerId, name: names[playerId]!, score: player.score, energy: player.energy,
      power: Object.fromEntries(player.power.map(domain => [domain, (player.power.filter(value => value === domain).length)])),
      xp: player.xp, handCount: player.handCount, deckCount: player.deckCount, runeDeckCount: player.runeDeckCount,
    zoneCounts: zoneCounts[playerId]!,
    }];
  }));
  // Hidden Facedown Zone cards have their own authoritative record. Ordinary
  // opponent hands also use the protocol's `facedown` zone for redaction, but
  // they are not treated as Hidden cards and cannot be played there.
  const publicViewerEvents: V2Event[] = [];
  const eventPrivateObjects = new Map<number, ObjectSnapshot>();
  const eventPublicObjects = new Map<number, string>();
  const events = match.events();
  for (const [index, event] of events.entries()) {
    const seq = event.eventId ?? index + 1;
    const payload: V2Event["payload"] & {
      reason: V2Event["payload"]["reason"];
      objectId?: { readonly visibility: "public"; readonly value: string };
    } = {
      reason: { visibility: "public", value: event.kind ?? event.timingPoint },
      ...(event.player === undefined ? {} : { playerId: { visibility: "public", value: event.player } }),
      ...(event.details?.battlefieldId === undefined ? {} : {
        battlefieldId: { visibility: "public", value: String(event.details.battlefieldId) },
      }),
    };
    const objectVisible = event.object !== undefined && isPublic(event.object, null, visibilityGrants) &&
      !event.object.faceDown && event.object.zone !== "hand" && event.object.zone !== "deck" &&
      event.object.zone !== "rune-deck";
    if (objectVisible) { payload.objectId = { visibility: "public", value: event.object!.ref.id }; eventPublicObjects.set(seq, event.object!.ref.id); }
    else if (event.object !== undefined) eventPrivateObjects.set(seq, event.object);
    publicViewerEvents.push({
      contract: "riftbound.protocol.v2.event", seq, eventSeq: seq, stateVersion,
      timingPoint: event.timingPoint, audience: { visibility: "public" }, payload,
    } as V2Event);
  }
  const battlefieldSource = match.flow.battlefields;
  const units = objectSource.filter(object => object.zone === "board" && object.types.includes("unit"));
  const battlefields = battlefieldSource.map(field => ({
    battlefieldId: field.id, controllerPlayerId: field.controller, contestedByPlayerId: field.contestedBy,
    staged: field.staged,
    occupantObjectIds: units.filter(unit => unit.location?.type === "battlefield" && unit.location.id === field.id).map(unit => unit.ref.id),
  }));
  const players = playerIds.map(playerId => viewerPlayers[playerId]!);
  const scoring = {
    victoryScore: match.flow.victoryScore,
    battlefieldLocationIds: battlefieldSource.map(field => field.id),
    players: players.map(player => ({ playerId: player.playerId, points: player.score,
      controlledBattlefieldIds: battlefieldSource.filter(field => field.controller === player.playerId).map(field => field.id),
      scoredBattlefieldLocationIds: match.flow.scored(player.playerId) })),
  };
  const chain = match.flow.chain.items;
  const chainSnapshot: V2ChainSnapshot = {
    status: chain.length ? "open" : "closed",
    phase: chain.some(item => item.status === "pending") ? "finalize" : chain.length ? "resolve" : "open",
    priorityPlayerId: match.flow.chain.priority, focusPlayerId: match.flow.chain.focus,
    items: chain.map(item => ({ itemId: item.id, controllerPlayerId: item.controller,
      status: item.status === "finalized" ? "finalized" : "pending", kind: item.kind,
      sourceObjectId: item.source.ref.id, sourceVisibility: "public" as const })),
  };
  const combat = combatProjection(match);
  const projectedObjects = new Map<string, readonly V2ProjectedObject[]>();
  const eventsByViewer = new Map<string, readonly V2Event[]>();
  const zoneObjects = Object.fromEntries(playerIds.map(playerId => [playerId, Object.fromEntries(
    zoneNames.map(zone => [zone, Object.freeze(objectSource.filter(object => object.owner === playerId &&
      (zone === "facedown" ? hiddenObjectSource.some(hidden => objectRefKey(hidden) === objectRefKey(object)) :
        v2Zone(object.zone) === zone)))]) as [V2Zone, readonly ObjectSnapshot[]][],
  )]));
  return {
    matchId, stateVersion,
    viewerPlayers, events: Object.freeze(publicViewerEvents),
    eventPrivateObjects, eventPublicObjects,
    playerIds, objectSource, hiddenObjectSource, visibilityGrants,
    zoneCounts,
    chain: chainSnapshot, phase: phase(match), turnNumber: Math.max(1, match.flow.turn),
    activePlayerId: match.flow.turnPlayer,
    priority: { playerId: match.flow.chain.priority, focusPlayerId: match.flow.chain.focus, window: "open" },
    scoring, battlefields, combat, winnerPlayerId: match.result().winner,
    projectedObjects, eventsByViewer,
    zoneObjects: zoneObjects as RuntimeProjectionSnapshot["zoneObjects"],
  };
}

function snapshotObjects(snapshot: RuntimeProjectionSnapshot, viewer: string | null): readonly V2ProjectedObject[] {
  const key = viewer ?? "spectator";
  const cached = snapshot.projectedObjects.get(key);
  if (cached !== undefined) return cached;
  const hidden = new Map(snapshot.hiddenObjectSource.map(object => [objectRefKey(object), object]));
  const objects = Object.freeze([
    ...snapshot.objectSource.filter(object => !hidden.has(objectRefKey(object)) &&
      (!object.faceDown || object.zone === "deck" || object.zone === "rune-deck"))
      .map(object => projectedObject(object, viewer, snapshot.visibilityGrants)),
    ...[...hidden.values()].map(object => projectedObject(object, viewer, snapshot.visibilityGrants)),
  ]);
  snapshot.projectedObjects.set(key, objects);
  return objects;
}

function snapshotEvents(snapshot: RuntimeProjectionSnapshot, viewer: string | null): readonly V2Event[] {
  const key = viewer ?? "spectator";
  const cached = snapshot.eventsByViewer.get(key);
  if (cached !== undefined) return cached;
  const events = viewer === null ? snapshot.events : Object.freeze(snapshot.events.map(event => {
    if (event.payload.objectId === undefined) {
      const publicValue = snapshot.eventPublicObjects.get(event.seq);
      if (publicValue !== undefined) return { ...event, payload: { ...event.payload, objectId: { visibility: "public" as const, value: publicValue } } } as V2Event;
    }
    const object = snapshot.eventPrivateObjects.get(event.seq);
    if (event.payload.objectId === undefined && object !== undefined &&
        isPublic(object, viewer, snapshot.visibilityGrants) && !object.faceDown && object.zone !== "hand" &&
        object.zone !== "deck" && object.zone !== "rune-deck") {
      return { ...event, payload: { ...event.payload,
        objectId: { visibility: "public" as const, value: object.ref.id } } } as V2Event;
    }
    return event;
  }));
  snapshot.eventsByViewer.set(key, events);
  return events;
}

export function projectRuntimeFromSnapshot(
  match: Match,
  host: EngineRuntimeHost,
  matchId: string,
  viewer: string | null,
  stateVersion: number,
  pendingChoice: { readonly choiceId: string; readonly ownerPlayerId: string; readonly stateVersion: number; readonly kind: "optional" | "mode" | "select-objects" | "order" | "number"; readonly options?: readonly V2ChoiceOption[]; readonly min?: number; readonly max?: number } | null,
  snapshot: RuntimeProjectionSnapshot,
): V2Projection {
  if (viewer !== null && !Object.hasOwn(snapshot.viewerPlayers, viewer)) throw new Error(`Unknown projection viewer: ${viewer}`);
  const players = snapshot.playerIds.map(playerId => snapshot.viewerPlayers[playerId]!);
  const objects = snapshotObjects(snapshot, viewer);
  const zones = players.flatMap(player => zoneNames.map(zone => {
    const visibleObjects = objects.filter(object => object.ownerPlayerId === player.playerId && object.zone === zone);
    const count = snapshot.zoneObjects[player.playerId]?.[zone]?.length ?? 0;
    const canList = zone !== "deck" && zone !== "rune-deck" && zone !== "facedown" && (zone !== "hand" || viewer === player.playerId);
    return { zone, ownerPlayerId: player.playerId, count, ...(canList ? { objects: visibleObjects } : {}) };
  }));
  const projectedChoice = pendingChoice ? {
    status: "pending" as const,
    choiceId: pendingChoice.choiceId,
    ownerPlayerId: pendingChoice.ownerPlayerId,
    stateVersion: pendingChoice.stateVersion,
    kind: pendingChoice.kind,
    ...(viewer === pendingChoice.ownerPlayerId && pendingChoice.options !== undefined ? { options: pendingChoice.options } : {}),
    ...(pendingChoice.min === undefined ? {} : { min: pendingChoice.min }),
    ...(pendingChoice.max === undefined ? {} : { max: pendingChoice.max }),
  } : { status: "none" as const };
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId,
    viewerPlayerId: viewer,
    stateVersion,
    eventSeq: snapshot.events.length,
    phase: snapshot.phase,
    turnNumber: snapshot.turnNumber,
    activePlayerId: snapshot.activePlayerId,
    players,
    zones,
    objects,
    chain: { ...snapshot.chain, phase: pendingChoice ? "await-commit" : snapshot.chain.phase },
    priority: {
      playerId: snapshot.priority.playerId, focusPlayerId: snapshot.priority.focusPlayerId,
      window: pendingChoice ? "choice" : snapshot.priority.focusPlayerId !== null ? "showdown" :
        snapshot.chain.items.length ? "closed" : "open",
    },
    scoring: snapshot.scoring,
    battlefields: snapshot.battlefields,
    combat: snapshot.combat,
    actionOptions: actionOptions(match, host, viewer, pendingChoice !== null),
    pendingChoice: projectedChoice,
    winnerPlayerId: snapshot.winnerPlayerId,
    events: snapshotEvents(snapshot, viewer),
  } as V2Projection;
}

export function projectionDigest(projection: V2Projection): string {
  return digest(projection);
}

export function projectionCanonicalJson(projection: V2Projection): string {
  return canonicalJson(projection);
}

export type RuntimeV2Command = V2Command;
