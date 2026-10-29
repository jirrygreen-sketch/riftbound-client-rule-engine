import type {
  V2ChainItemSnapshot,
  V2ProjectedObject,
  V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";

/**
 * Playmat stacking and on-board combat allocation (RIFT-1146).
 *
 * Legends such as Viktor or Rumble can put ten or more identical tokens into
 * one location. Identical permanents are drawn as one stack with a count, and
 * the combat panel assigns damage by clicking units. Everything here is a pure
 * reading of the projection or of local, not-yet-sent drafts; the server stays
 * authoritative for every command these feed.
 */

export interface V2UnitGroup {
  readonly key: string;
  readonly objects: readonly V2ProjectedObject[];
}

function controllerOf(object: V2ProjectedObject): string {
  return object.controllerPlayerId ?? object.ownerPlayerId;
}

/** Everything a player can see that tells two permanents apart; equal keys stack. */
export function v2UnitGroupKey(object: V2ProjectedObject): string {
  const counters = object.counters === undefined ? "" :
    Object.entries(object.counters).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(",");
  // The location keeps a base stack and a battlefield stack of the same token apart.
  const location = object.location === undefined ? object.zone :
    object.location.kind === "base" ? `base:${object.location.playerId}` : `battlefield:${object.location.battlefieldId}`;
  return [location, controllerOf(object), object.faceDown ? "facedown" : object.cardId ?? object.name ?? object.objectId,
    object.name ?? "", object.visibility, object.exhausted === true ? "ex" : "ready", object.damage ?? 0,
    object.might ?? "", counters].join("|");
}

/** Stack identical permanents, keeping the projection's order of first appearance. */
export function v2GroupUnits(objects: readonly V2ProjectedObject[]): readonly V2UnitGroup[] {
  const groups = new Map<string, V2ProjectedObject[]>();
  for (const object of objects) {
    // Face-down permanents never stack: their identities are hidden from us.
    const key = object.faceDown ? `facedown|${object.objectId}` : v2UnitGroupKey(object);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [object]);
    else group.push(object);
  }
  return [...groups].map(([key, members]) => ({ key, objects: members }));
}

/** Total projected Might of one player's units at a battlefield. */
export function v2MightAt(projection: V2Projection, battlefieldId: string, playerId: string): number {
  return projection.objects.filter(object => object.location?.kind === "battlefield" &&
    object.location.battlefieldId === battlefieldId && controllerOf(object) === playerId && object.might !== undefined)
    .reduce((sum, object) => sum + (object.might ?? 0), 0);
}

/** Damage still needed to make a unit lethal: Might minus marked damage, never below 1. */
export function v2LethalNeed(object: Pick<V2ProjectedObject, "might" | "damage">): number {
  return Math.max(1, (object.might ?? 1) - (object.damage ?? 0));
}

/** Local, unsent allocation: amounts as typed strings plus the order units were first assigned. */
export interface V2DamagePlan {
  readonly drafts: Readonly<Record<string, string>>;
  readonly order: readonly string[];
}

function amountOf(plan: V2DamagePlan, objectId: string): number {
  const value = Number(plan.drafts[objectId] ?? "");
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function v2PlannedDamage(plan: V2DamagePlan): number {
  return Object.keys(plan.drafts).reduce((sum, objectId) => sum + amountOf(plan, objectId), 0);
}

/**
 * A click on one unit or a stack. Combat damage must make one unit lethal
 * before the next (core rules: Fight!), so a click tops each clicked unit up
 * to lethal in turn. Damage beyond lethal is only allowed once no other
 * target can still take lethal damage (CR 467.2.c.3/.c.4): a click on an
 * already lethal unit goes to the next not-yet-lethal target in `targets`
 * (the server-projected enemy units) and only overflows onto the clicked
 * unit when every target is lethal. The budget is never exceeded.
 */
export function v2AssignDamage(plan: V2DamagePlan, clicked: readonly V2ProjectedObject[], budget: number,
  targets: readonly V2ProjectedObject[] = clicked): V2DamagePlan {
  let remaining = budget - v2PlannedDamage(plan);
  if (remaining <= 0 || clicked.length === 0) return plan;
  const drafts: Record<string, string> = { ...plan.drafts };
  const order = [...plan.order];
  const put = (objectId: string, amount: number): void => {
    drafts[objectId] = String(amount);
    if (!order.includes(objectId)) order.push(objectId);
  };
  let added = false;
  for (const unit of clicked) {
    if (remaining <= 0) break;
    const current = amountOf({ drafts, order }, unit.objectId);
    const need = v2LethalNeed(unit) - current;
    if (need <= 0) continue;
    const add = Math.min(need, remaining);
    put(unit.objectId, current + add);
    remaining -= add;
    added = true;
  }
  if (!added) {
    const next = targets.find(target => amountOf({ drafts, order }, target.objectId) < v2LethalNeed(target));
    if (next === undefined) {
      put(clicked[0]!.objectId, amountOf({ drafts, order }, clicked[0]!.objectId) + 1);
    } else {
      const current = amountOf({ drafts, order }, next.objectId);
      put(next.objectId, current + Math.min(v2LethalNeed(next) - current, remaining));
    }
  }
  return { drafts, order };
}

/** Right click: take one point back from the last clicked unit that has any. */
export function v2UnassignDamage(plan: V2DamagePlan, clicked: readonly V2ProjectedObject[]): V2DamagePlan {
  const target = [...clicked].reverse().find(unit => amountOf(plan, unit.objectId) > 0);
  if (target === undefined) return plan;
  const next = amountOf(plan, target.objectId) - 1;
  const drafts: Record<string, string> = { ...plan.drafts };
  if (next === 0) {
    delete drafts[target.objectId];
    return { drafts, order: plan.order.filter(objectId => objectId !== target.objectId) };
  }
  drafts[target.objectId] = String(next);
  return { drafts, order: plan.order };
}

/**
 * The drafts to send, in assignment order: clicked units first, then any
 * other filled-in targets in projection order. Untouched targets are left out
 * so a small budget never has to cover every enemy.
 */
export function v2OrderedDamageDrafts(plan: V2DamagePlan, targets: readonly V2ProjectedObject[]):
  readonly { readonly unitObjectId: string; readonly amount: string }[] {
  const listed = new Set(targets.map(target => target.objectId));
  const ordered = [...plan.order.filter(objectId => listed.has(objectId)),
    ...targets.map(target => target.objectId).filter(objectId => !plan.order.includes(objectId))];
  return ordered.filter(objectId => (plan.drafts[objectId] ?? "") !== "")
    .map(objectId => ({ unitObjectId: objectId, amount: plan.drafts[objectId]! }));
}

const CHAIN_KIND_LABELS: Readonly<Record<V2ChainItemSnapshot["kind"], string>> = {
  spell: "法术", unit: "单位", gear: "装备", activated: "能力", triggered: "触发", add: "资源", unknown: "效果"
};

export function v2ChainKindLabel(kind: V2ChainItemSnapshot["kind"]): string {
  return CHAIN_KIND_LABELS[kind] ?? kind;
}

const CHAIN_STATUS_LABELS: Readonly<Record<V2ChainItemSnapshot["status"], string>> = {
  pending: "待定稿", finalized: "等待结算", resolving: "结算中"
};

export function v2ChainStatusLabel(status: V2ChainItemSnapshot["status"]): string {
  return CHAIN_STATUS_LABELS[status] ?? status;
}

/** Chinese headings for the timing points a player cares about. */
const EVENT_LABELS: Readonly<Record<string, string>> = {
  "turn-start": "回合开始", "turn-end": "回合结束", "awaken-start": "唤醒阶段", "beginning-start": "开始阶段",
  "channel-start": "频道阶段", "draw-start": "抽牌阶段", "main-start": "主要阶段",
  "card-played": "打出", "chain-item-pending": "进链", "chain-item-finalize": "定稿", "chain-item-resolve": "结算",
  "object-enters-base": "进入基地", "object-enters-battlefield": "进入战场", "object-enters-trash": "进入废牌堆",
  "object-enters-hand": "进入手牌", "object-enters-deck": "进入主牌堆", "object-enters-rune-zone": "进入符文区",
  "object-enters-rune-deck": "进入符文库", "object-enters-banishment": "被放逐",
  "object-killed": "被消灭", "object-readied": "就绪", "object-exhausted": "休眠", "object-moved": "移动",
  "became-target": "成为目标", "attack-declared": "进攻", "defense-declared": "防守",
  "showdown-open": "对决开始", "showdown-close": "对决结束", "combat-start": "战斗开始",
  "combat-damage-before": "战斗伤害", "combat-damage-after": "战斗伤害结算", "combat-result": "战斗结果",
  "combat-end": "战斗结束", "control-established": "取得控制", "control-lost": "失去控制", "conquer": "占领",
  "hold": "据守", "score": "得分", "points-gained": "得分", "final-point": "制胜分", "card-drawn": "抽牌",
  "card-discarded": "弃牌", "damage-dealt": "造成伤害", "unit-stunned": "眩晕", "xp-gained": "获得经验",
  "buff-added": "获得增益", "buff-spent": "消耗增益", "empowered-changed": "强化变化",
  "contested-applied": "开始争夺", "contested-removed": "结束争夺", "card-recycled": "回收", "card-banished": "放逐",
  "card-revealed": "展示", "objects-shown-off": "展示", "card-hidden": "隐藏", "card-burned": "焚烧",
  "cards-looked-at": "查看", "object-attached": "装配", "might-changed": "战力变化", "ability-activated": "发动能力"
};

/**
 * Housekeeping events the log hides: cleanup passes, phase ends and the
 * generic zone hops that always come with a more specific event.
 */
export function v2EventHidden(timingPoint: string): boolean {
  return timingPoint.startsWith("cleanup-") || /^(?:awaken|beginning|channel|draw|main)-end$/u.test(timingPoint) ||
    /^object-leaves-/u.test(timingPoint) || ["object-enters-zone", "object-enters-board", "object-enters-chain"].includes(timingPoint);
}

export function v2EventLabel(timingPoint: string): string {
  return EVENT_LABELS[timingPoint] ?? timingPoint;
}
