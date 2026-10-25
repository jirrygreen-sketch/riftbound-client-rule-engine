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
import { digest } from "./journal.js";

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

function eventProjection(match: Match, host: EngineRuntimeHost, viewer: string | null, stateVersion: number): readonly V2Event[] {
  return match.events().map((event, index) => ({
    contract: "riftbound.protocol.v2.event",
    seq: event.eventId ?? index + 1,
    eventSeq: event.eventId ?? index + 1,
    stateVersion,
    timingPoint: event.timingPoint,
    audience: { visibility: "public" },
    payload: {
      reason: { visibility: "public", value: event.kind ?? event.timingPoint },
      ...(event.player === undefined ? {} : { playerId: { visibility: "public", value: event.player } }),
      ...(event.details?.battlefieldId === undefined ? {} : {
        battlefieldId: { visibility: "public", value: String(event.details.battlefieldId) },
      }),
      ...(event.object === undefined || !isPublic(event.object, viewer, host.visibility()) ||
        event.object.faceDown || event.object.zone === "hand" || event.object.zone === "deck" || event.object.zone === "rune-deck" ? {} : {
        objectId: { visibility: "public", value: event.object.ref.id },
      }),
    },
  })) as readonly V2Event[];
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

function actionOptions(match: Match, host: EngineRuntimeHost, viewer: string | null,
  pendingChoice: boolean): V2ActionOptions {
  const canAdvance = advanceResponsiblePlayer(match, pendingChoice, viewer) !== null;
  if (viewer === null || match.result().winner !== null || match.flow.phase !== "main") {
    return { canEndTurn: false, canAdvance, moves: [], plays: [] };
  }
  const chain = match.flow.chain;
  const priority = chain.priority;
  const waitingForFutureCommand = chain.items.length === 0 && !match.flow.combat.active &&
    match.flow.phase === "main" && chain.turnState === "neutral-open" && priority === null;
  const open = !match.flow.combat.active && chain.turnState === "neutral-open" &&
    (chain.canAct(viewer, "normal") || waitingForFutureCommand);
  const canEndTurn = viewer === match.flow.turnPlayer && open;
  if ((priority !== viewer && !waitingForFutureCommand) || !open || chain.items.length > 0) {
    return { canEndTurn, canAdvance, moves: [], plays: [] };
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
  return { canEndTurn, canAdvance, moves, plays };
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
  if (viewer !== null && !Object.hasOwn(host.playerNames(), viewer)) throw new Error(`Unknown projection viewer: ${viewer}`);
  const players = Object.keys(host.playerNames()).map(playerId => {
    const player = host.player(playerId);
    return {
      playerId, name: host.playerNames()[playerId]!, score: player.score, energy: player.energy,
      power: Object.fromEntries(player.power.map(domain => [domain, (player.power.filter(value => value === domain).length)])),
      xp: player.xp, handCount: player.handCount, deckCount: player.deckCount, runeDeckCount: player.runeDeckCount,
      zoneCounts: Object.fromEntries(zoneNames.map(zone => [zone, host.objects().filter(object => object.owner === playerId && v2Zone(object.zone) === zone).length])),
    };
  });
  // Hidden Facedown Zone cards have their own authoritative record. Ordinary
  // opponent hands also use the protocol's `facedown` zone for redaction, but
  // they are not treated as Hidden cards and cannot be played there.
  const hidden = new Map(host.hiddenObjects().map(object => [`${object.ref.id}:${object.ref.zoneEntryId}`, object]));
  const publicObjects = host.objects().filter(object => !hidden.has(`${object.ref.id}:${object.ref.zoneEntryId}`));
  const objects = [
    ...publicObjects.filter(object => !object.faceDown || object.zone === "deck" || object.zone === "rune-deck")
      .map(object => projectedObject(object, viewer, host.visibility())),
    ...[...hidden.values()].map(object => projectedObject(object, viewer, host.visibility())),
  ];
  const zones = players.flatMap(player => zoneNames.map(zone => {
    const sourceZone = zone === "trash" ? "trash" : zone === "rune-zone" ? "rune-zone" : zone as never;
    const visibleObjects = objects.filter(object => object.ownerPlayerId === player.playerId && object.zone === zone);
    const count = zone === "facedown" ? [...hidden.values()].filter(object => object.owner === player.playerId).length
      : host.zoneObjects(player.playerId, sourceZone).length;
    const canList = zone !== "deck" && zone !== "rune-deck" && zone !== "facedown" && (zone !== "hand" || viewer === player.playerId);
    return { zone, ownerPlayerId: player.playerId, count, ...(canList ? { objects: visibleObjects } : {}) };
  }));
  const chain = match.flow.chain.items;
  const chainSnapshot: V2ChainSnapshot = {
    status: chain.length ? "open" : "closed",
    phase: pendingChoice ? "await-commit" : chain.some(item => item.status === "pending") ? "finalize"
      : chain.length ? "resolve" : "open",
    priorityPlayerId: match.flow.chain.priority, focusPlayerId: match.flow.chain.focus,
    items: chain.map(item => ({ itemId: item.id, controllerPlayerId: item.controller, status: item.status === "finalized" ? "finalized" : "pending", kind: item.kind, sourceObjectId: item.source.ref.id, sourceVisibility: "public" as const })),
  };
  const battlefields = match.flow.battlefields;
  const scoring = {
    victoryScore: match.flow.victoryScore,
    battlefieldLocationIds: battlefields.map(field => field.id),
    players: players.map(player => ({ playerId: player.playerId, points: player.score, controlledBattlefieldIds: battlefields.filter(field => field.controller === player.playerId).map(field => field.id), scoredBattlefieldLocationIds: match.flow.scored(player.playerId) })),
  };
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
    eventSeq: match.events().length,
    phase: phase(match),
    turnNumber: Math.max(1, match.flow.turn),
    activePlayerId: match.flow.turnPlayer,
    players,
    zones,
    objects,
    chain: chainSnapshot,
    priority: {
      playerId: match.flow.chain.priority,
      focusPlayerId: match.flow.chain.focus,
      window: pendingChoice ? "choice" : match.flow.chain.focus !== null ? "showdown" : chain.length ? "closed" : "open",
    },
    scoring,
    battlefields: battlefieldProjection(match, host),
    combat: combatProjection(match),
    actionOptions: actionOptions(match, host, viewer, pendingChoice !== null),
    pendingChoice: projectedChoice,
    winnerPlayerId: match.result().winner,
    events: eventProjection(match, host, viewer, stateVersion),
  } as V2Projection;
}

export function projectionDigest(projection: V2Projection): string {
  return digest(projection);
}

export type RuntimeV2Command = V2Command;
