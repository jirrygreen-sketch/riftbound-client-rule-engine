import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousEffectRegistry } from "../../../src/layers/duration.ts";
import { canAct, actionTimings, deckLimit, movement, playLocations, appliedCosts, requirements, restrictions } from "../../../src/layers/rules/query.ts";

const register = (registry, effect, duration = { type: "permanent" }, source = { id: "src", zoneEntryId: 1 }) =>
  registry.register({ id: effect.kind + ":" + (effect.name ?? effect.actions?.[0] ?? "x") + ":" + Math.random().toString(36).slice(2), layer: "ability", source, filter: {}, effect }, duration);

const baseState = { player: "A", turnPlayer: "A", priorityHolder: "A" };

test("canAct allows Action speed during Showdown but not during Closed States", () => {
  assert.equal(canAct({ ...baseState, speed: "action", showdown: true, closedState: false, focusHolder: "A" }), true);
  assert.equal(canAct({ ...baseState, speed: "action", showdown: true, closedState: true }), false);
  assert.equal(canAct({ ...baseState, speed: "action", showdown: false, closedState: true }), false);
  assert.equal(canAct({ ...baseState, speed: "action", showdown: false, closedState: false, focusHolder: "A" }), false);
});

test("canAct subsumes Action permissions under Reaction (CR 813.1.b)", () => {
  assert.equal(canAct({ ...baseState, speed: "reaction", showdown: true, closedState: false, focusHolder: "A" }), true);
  assert.equal(canAct({ ...baseState, speed: "reaction", showdown: true, closedState: true, focusHolder: "A" }), true);
  assert.equal(canAct({ ...baseState, speed: "reaction", showdown: false, closedState: true, focusHolder: "A" }), true);
  assert.equal(canAct({ ...baseState, speed: "reaction", showdown: false, closedState: false, focusHolder: "A", chainDepth: 0 }), true);
});

test("canAct requires Priority and, in Showdown, Focus", () => {
  assert.equal(canAct({ ...baseState, priorityHolder: "B", speed: "normal", showdown: false, closedState: false }), false);
  assert.equal(canAct({ ...baseState, speed: "action", showdown: true, closedState: false, focusHolder: "B" }), false);
  assert.equal(canAct({ ...baseState, priorityHolder: null, speed: "action", showdown: true, closedState: false }), false);
});

test("canAct allows neutral-open normal-speed actions only for the turn player", () => {
  assert.equal(canAct({ ...baseState, speed: "normal", showdown: false, closedState: false }), true);
  assert.equal(canAct({ ...baseState, turnPlayer: "B", speed: "normal", showdown: false, closedState: false }), false);
  assert.equal(canAct({ ...baseState, speed: "normal", showdown: true, closedState: false }), false);
});

test("actionTimings unions speed grants and reads the timings alias", () => {
  const registry = new ContinuousEffectRegistry();
  register(registry, { kind: "timing", grants: ["action"] });
  register(registry, { kind: "timing", timings: ["reaction"] });
  assert.deepEqual([...actionTimings(registry)].sort(), ["action", "reaction"]);
});

test("actionTimings respects objectId filters", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "t:hero", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: { objectId: "hero" }, effect: { kind: "timing", grants: ["action"] } }, { type: "permanent" });
  assert.deepEqual(actionTimings(registry, { id: "hero", zoneEntryId: 1 }), ["action"]);
  assert.deepEqual(actionTimings(registry, { id: "other", zoneEntryId: 1 }), []);
});

test("movement reports battlefield-to-battlefield permissions as canGank", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "m:gank", layer: "ability", source: { id: "guster", zoneEntryId: 1 }, filter: { objectId: "guster" },
    effect: { kind: "movement", permission: { routes: ["battlefield-to-battlefield"], move: "standard", source: "battlefield", destination: "battlefield" } },
  }, { type: "permanent" });
  const view = movement(registry, { id: "guster", zoneEntryId: 1 });
  assert.equal(view.canGank, true);
  assert.equal(view.battlefieldToBattlefield, true);
  assert.deepEqual(view.restrictions, []);
});

test("movement collects restrictions without turning them into permissions", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "m:deny", layer: "ability", source: { id: "lair", zoneEntryId: 1 }, filter: {},
    effect: { kind: "movement", restrictions: ["move-from-here-to-base"] },
  }, { type: "permanent" });
  const view = movement(registry);
  assert.equal(view.canGank, false);
  assert.deepEqual(view.restrictions, ["move-from-here-to-base"]);
});

test("restrictions and requirements stay separate (contract 3.4)", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "r:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "restriction", actions: ["play-spell"] } }, { type: "permanent" });
  registry.register({ id: "q:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "requirement", actions: ["play-spell"], restriction: "must-have-unit" } }, { type: "permanent" });
  assert.equal(restrictions(registry, "play-spell").length, 1);
  assert.equal(requirements(registry, "play-spell").length, 1);
  assert.equal(requirements(registry, "play-spell")[0].name, "must-have-unit");
  assert.equal(restrictions(registry, "move").length, 0);
  assert.equal(requirements(registry, "move").length, 0);
});

test("appliedCosts collects applied-cost modifications per action", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "c:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "applied-cost", actions: ["move"], cost: { energy: 1 } } }, { type: "permanent" });
  assert.equal(appliedCosts(registry, "move").length, 1);
  assert.equal(appliedCosts(registry, "attack").length, 0);
});

test("playLocations reports permissions and restrictions separately", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "l:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "location", permission: "any-battlefield" } }, { type: "permanent" });
  registry.register({ id: "l:2", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "location", restriction: "no-battlefield" } }, { type: "permanent" });
  const view = playLocations(registry);
  assert.deepEqual(view.permissions.map(item => item.name), ["any-battlefield"]);
  assert.deepEqual(view.restrictions.map(item => item.name), ["no-battlefield"]);
});

test("deckLimit combines unlimited and max effects (Spiderling / Unique)", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "d:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: { characteristics: { name: "Spiderling" } }, effect: { kind: "deck-limit", mode: "unlimited" } }, { type: "permanent" });
  assert.deepEqual(deckLimit(registry, "Spiderling"), { mode: "unlimited" });
  assert.equal(deckLimit(registry, "Other"), null);
  registry.register({ id: "d:2", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: { characteristics: { name: "Unique Leader" } }, effect: { kind: "deck-limit", mode: "max", amount: 1 } }, { type: "permanent" });
  assert.deepEqual(deckLimit(registry, "Unique Leader"), { mode: "max", amount: 1 });
});

test("end-of-turn effects expire through the real registry (turn-end)", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "t:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "timing", grants: ["action"] } }, { type: "end-of-turn" });
  registry.register({ id: "t:2", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "timing", grants: ["reaction"] } }, { type: "permanent" });
  const expired = registry.expireAt({ id: "turn-end" }, () => null);
  assert.deepEqual(expired, ["t:1"]);
  assert.deepEqual(actionTimings(registry), ["reaction"]);
});

test("end-of-combat effects expire at combat-end and survive turn-end", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "c:1", layer: "ability", source: { id: "src", zoneEntryId: 1 }, filter: {}, effect: { kind: "timing", grants: ["action"] } }, { type: "end-of-combat" });
  registry.expireAt({ id: "turn-end" }, () => null);
  assert.deepEqual(actionTimings(registry), ["action"]);
  registry.expireAt({ id: "combat-end" }, () => null);
  assert.deepEqual(actionTimings(registry), []);
});

test("while-source-in-zone effects expire when the source leaves", () => {
  const registry = new ContinuousEffectRegistry();
  const source = { id: "hero", zoneEntryId: 1 };
  registry.register({ id: "w:1", layer: "ability", source, filter: {}, effect: { kind: "timing", grants: ["action"] } }, { type: "while-source-in-zone", source });
  const live = [{ ref: source, name: "Hero" }];
  assert.deepEqual(actionTimings(registry), ["action"]);
  registry.expireInactive(() => live.find(object => object.ref === source) ?? null);
  registry.expireInactive(() => null);
  assert.deepEqual(actionTimings(registry), []);
});
