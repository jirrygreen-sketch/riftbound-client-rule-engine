import {
  V2_ZONES
} from "./constants.js";
import type {
  V2ActivateCommand, V2ChoiceAnswer, V2Command, V2CommandEnvelope,
  V2ConcedeCommand, V2CostSelection, V2DeclareAttackCommand,
  V2DeclareDefenseCommand, V2MoveCommand, V2MoveDestination, V2MulliganCommand, V2Location,
  V2ObjectRef, V2PassCommand, V2Pick, V2PlayCommand, V2PowerPayment,
  V2RuneResourceCommand, V2Target, V2CombatDamageCommand, V2EndTurnCommand, V2AdvanceCommand
} from "./commands.js";

type Data = Record<string, unknown>;

function data(value: unknown): value is Data {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    return Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor?.enumerable === true && "value" in descriptor;
    });
  } catch { return false; }
}

function exact(value: Data, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key));
}

function text(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function array(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
    Reflect.ownKeys(value).length === value.length + 1;
}

function uniqueStrings(value: unknown, max = 256): value is readonly string[] {
  return array(value) && value.every(item => text(item, max)) &&
    new Set(value).size === value.length;
}

function uniqueIds(value: readonly string[]): boolean {
  return new Set(value).size === value.length;
}

function objectRef(value: unknown): value is V2ObjectRef {
  if (!data(value) || !exact(value, ["objectId"], ["zoneEntryId"]) || !text(value.objectId)) return false;
  return value.zoneEntryId === undefined || count(value.zoneEntryId);
}

function target(value: unknown): value is V2Target {
  if (!data(value) || !text(value.kind, 32)) return false;
  switch (value.kind) {
    case "object":
      return exact(value, ["kind", "objectId"], ["zoneEntryId"]) && text(value.objectId) &&
        (value.zoneEntryId === undefined || count(value.zoneEntryId));
    case "player": return exact(value, ["kind", "playerId"]) && text(value.playerId);
    case "battlefield": return exact(value, ["kind", "battlefieldId"]) && text(value.battlefieldId);
    default: return false;
  }
}

function pick(value: unknown): value is V2Pick {
  if (!data(value) || !text(value.kind, 32)) return false;
  switch (value.kind) {
    case "object":
      return exact(value, ["kind", "objectId"], ["zoneEntryId"]) && text(value.objectId) &&
        (value.zoneEntryId === undefined || count(value.zoneEntryId));
    case "player": return exact(value, ["kind", "playerId"]) && text(value.playerId);
    case "value":
      return exact(value, ["kind", "value"]) &&
        ((typeof value.value === "string" && value.value.length <= 512) ||
          (typeof value.value === "number" && Number.isFinite(value.value)) || typeof value.value === "boolean");
    default: return false;
  }
}

function payment(value: unknown): value is V2PowerPayment {
  return data(value) && exact(value, ["domains", "amount"]) && uniqueStrings(value.domains, 32) &&
    value.domains.length > 0 && count(value.amount) && value.amount > 0;
}

function cost(value: unknown): value is V2CostSelection {
  if (!data(value) || !exact(value, [], ["optionId", "energy", "power", "xp", "exhaustObjectIds", "recycleObjectIds", "hidden"])) return false;
  if (value.optionId !== undefined && !text(value.optionId)) return false;
  if (value.energy !== undefined && !count(value.energy)) return false;
  if (value.xp !== undefined && !count(value.xp)) return false;
  if (value.power !== undefined && (!array(value.power) || !value.power.every(payment))) return false;
  for (const key of ["exhaustObjectIds", "recycleObjectIds"] as const) {
    if (value[key] !== undefined && !uniqueStrings(value[key])) return false;
  }
  return value.hidden === undefined || typeof value.hidden === "boolean";
}

function targets(value: unknown): value is readonly V2Target[] {
  if (!array(value) || !value.every(target)) return false;
  const ids = value.map(item => JSON.stringify(item));
  return uniqueIds(ids);
}

function picks(value: unknown): value is readonly V2Pick[] {
  if (!array(value) || !value.every(pick)) return false;
  const ids = value.map(item => JSON.stringify(item));
  return uniqueIds(ids);
}

function base(value: Data, type: string, optional: readonly string[]): boolean {
  return exact(value, ["type", "commandId", "stateVersion", ...optional.filter(key => false)],
    optional) && value.type === type && text(value.commandId, 256) && count(value.stateVersion);
}

function listRefs(value: unknown): value is readonly string[] {
  return uniqueStrings(value);
}

function choiceAnswer(value: unknown): value is V2ChoiceAnswer {
  if (typeof value === "string") return value.length <= 512;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (objectRef(value)) return true;
  return array(value) && value.every(item =>
    (typeof item === "string" && item.length <= 512) ||
    (typeof item === "number" && Number.isFinite(item)) || typeof item === "boolean" || objectRef(item));
}

function destination(value: unknown): value is V2MoveDestination {
  if (!data(value) || typeof value.zone !== "string" || !(V2_ZONES as readonly string[]).includes(value.zone)) return false;
  if (value.zone === "deck" || value.zone === "rune-deck") {
    return exact(value, ["zone", "position"]) && (value.position === "top" || value.position === "bottom");
  }
  return exact(value, ["zone"], ["locationId", "playerId"]) &&
    (value.locationId === undefined || text(value.locationId)) &&
    (value.playerId === undefined || text(value.playerId));
}

function location(value: unknown): value is V2Location {
  if (!data(value) || typeof value.kind !== "string") return false;
  if (value.kind === "base") return exact(value, ["kind", "playerId"]) && text(value.playerId);
  return value.kind === "battlefield" && exact(value, ["kind", "battlefieldId"]) && text(value.battlefieldId);
}

export function isV2MulliganCommand(value: unknown): value is V2MulliganCommand {
  if (!data(value) || !base(value, "mulligan", ["selectedObjectIds", "selectedUIDs"])) return false;
  const hasObjects = Object.hasOwn(value, "selectedObjectIds");
  const hasUIDs = Object.hasOwn(value, "selectedUIDs");
  if (hasObjects === hasUIDs) return false;
  return listRefs(hasObjects ? value.selectedObjectIds : value.selectedUIDs);
}

export function isV2PlayCommand(value: unknown): value is V2PlayCommand {
  return data(value) && base(value, "play", ["cardObjectId", "destination", "cost", "targets", "picks"]) &&
    exact(value, ["type", "commandId", "stateVersion", "cardObjectId"], ["destination", "cost", "targets", "picks"]) &&
    text(value.cardObjectId) && (value.destination === undefined || location(value.destination)) &&
    (value.cost === undefined || cost(value.cost)) &&
    (value.targets === undefined || targets(value.targets)) && (value.picks === undefined || picks(value.picks));
}

export function isV2ActivateCommand(value: unknown): value is V2ActivateCommand {
  return data(value) && base(value, "activate", ["sourceObjectId", "abilityId", "cost", "targets", "picks"]) &&
    exact(value, ["type", "commandId", "stateVersion", "sourceObjectId", "abilityId"], ["cost", "targets", "picks"]) &&
    text(value.sourceObjectId) && text(value.abilityId) && (value.cost === undefined || cost(value.cost)) &&
    (value.targets === undefined || targets(value.targets)) && (value.picks === undefined || picks(value.picks));
}

export function isV2PassCommand(value: unknown): value is V2PassCommand {
  return data(value) && base(value, "pass", []) && exact(value, ["type", "commandId", "stateVersion"]);
}

export function isV2ChooseCommand(value: unknown): value is Extract<V2Command, { type: "choose" }> {
  return data(value) && base(value, "choose", ["choiceId", "answer"]) &&
    exact(value, ["type", "commandId", "stateVersion", "choiceId", "answer"]) &&
    text(value.choiceId) && choiceAnswer(value.answer);
}

export function isV2MoveCommand(value: unknown): value is V2MoveCommand {
  return data(value) && base(value, "move", ["objectId", "to"]) &&
    exact(value, ["type", "commandId", "stateVersion", "objectId", "to"]) &&
    text(value.objectId) && destination(value.to);
}

export function isV2DeclareAttackCommand(value: unknown): value is V2DeclareAttackCommand {
  return data(value) && base(value, "declare-attack", ["battlefieldId", "attackerObjectIds"]) &&
    exact(value, ["type", "commandId", "stateVersion", "battlefieldId", "attackerObjectIds"]) &&
    text(value.battlefieldId) && listRefs(value.attackerObjectIds) && value.attackerObjectIds.length > 0;
}

export function isV2DeclareDefenseCommand(value: unknown): value is V2DeclareDefenseCommand {
  return data(value) && base(value, "declare-defense", ["battlefieldId", "defenderObjectIds"]) &&
    exact(value, ["type", "commandId", "stateVersion", "battlefieldId", "defenderObjectIds"]) &&
    text(value.battlefieldId) && listRefs(value.defenderObjectIds) && value.defenderObjectIds.length > 0;
}

export function isV2ConcedeCommand(value: unknown): value is V2ConcedeCommand {
  return data(value) && base(value, "concede", []) && exact(value, ["type", "commandId", "stateVersion"]);
}

export function isV2EndTurnCommand(value: unknown): value is V2EndTurnCommand {
  return data(value) && base(value, "end-turn", []) && exact(value, ["type", "commandId", "stateVersion"]);
}

export function isV2AdvanceCommand(value: unknown): value is V2AdvanceCommand {
  return data(value) && base(value, "advance", []) && exact(value, ["type", "commandId", "stateVersion"]);
}

function combatAssignments(value: unknown): value is V2CombatDamageCommand["assignments"] {
  if (!array(value) || value.length === 0) return false;
  const ids: string[] = [];
  for (const assignment of value) {
    if (!data(assignment) || !exact(assignment, ["unitObjectId", "amount"]) ||
        !text(assignment.unitObjectId) || !count(assignment.amount) || assignment.amount <= 0) return false;
    ids.push(assignment.unitObjectId);
  }
  return new Set(ids).size === ids.length;
}

export function isV2CombatDamageCommand(value: unknown): value is V2CombatDamageCommand {
  return data(value) && base(value, "combat-damage", ["combatId", "assignments"]) &&
    exact(value, ["type", "commandId", "stateVersion", "combatId", "assignments"]) &&
    text(value.combatId) && combatAssignments(value.assignments);
}

/** Strict guard for the Basic Rune resource intents. */
export function isV2RuneResourceCommand(value: unknown): value is V2RuneResourceCommand {
  return data(value) &&
    (value.type === "rune-energy" || value.type === "rune-power") &&
    base(value, value.type, ["runeObjectId", "zoneEntryId"]) &&
    exact(value, ["type", "commandId", "stateVersion", "runeObjectId", "zoneEntryId"]) &&
    text(value.runeObjectId) && count(value.zoneEntryId);
}

export function isV2Command(value: unknown): value is V2Command {
  if (!data(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "mulligan": return isV2MulliganCommand(value);
    case "play": return isV2PlayCommand(value);
    case "activate": return isV2ActivateCommand(value);
    case "pass": return isV2PassCommand(value);
    case "choose": return isV2ChooseCommand(value);
    case "move": return isV2MoveCommand(value);
    case "declare-attack": return isV2DeclareAttackCommand(value);
    case "declare-defense": return isV2DeclareDefenseCommand(value);
    case "concede": return isV2ConcedeCommand(value);
    case "end-turn": return isV2EndTurnCommand(value);
    case "advance": return isV2AdvanceCommand(value);
    case "combat-damage": return isV2CombatDamageCommand(value);
    case "rune-energy": return isV2RuneResourceCommand(value);
    case "rune-power": return isV2RuneResourceCommand(value);
    default: return false;
  }
}

export function isV2CommandEnvelope(value: unknown): value is V2CommandEnvelope {
  return data(value) && exact(value, ["contract", "command"]) &&
    value.contract === "riftbound.protocol.v2.command" && isV2Command(value.command);
}

export const isProtocolV2Command = isV2Command;
export const isProtocolV2CommandEnvelope = isV2CommandEnvelope;
export const isV2ProtocolCommand = isV2Command;
