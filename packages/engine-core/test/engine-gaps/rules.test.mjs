import assert from "node:assert/strict";
import test from "node:test";
import restrict from "../../src/effects/instructions/continuous.restrict.ts";
import timing from "../../src/effects/instructions/continuous.timing.ts";
import deck from "../../src/effects/instructions/continuous.deck.ts";
import { runInstruction, world } from "../../src/effects/testing/index.ts";
import { ContinuousEffectRegistry } from "../../src/layers/duration.ts";
import {
  actionRules,
  actionTimings,
  abilityUses,
  canActivate,
  canApplyCombatRule,
  canGainResource,
  canPlay,
  canTarget,
  combatRules,
  deckLimit,
  resourceRules,
  restrictions,
} from "../../src/layers/rules/query.ts";

const literal = value => ({ kind: "constant", value });
const registryOf = kernel => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};
const snapshot = (ref, controller = "A", overrides = {}) => ({
  ref, cardId: "card:test", name: "Test", types: ["unit"], tags: [], keywords: [],
  owner: controller, controller, zone: "board", location: { type: "battlefield", id: "bf" },
  might: 1, energy: null, power: null, exhausted: false, damage: 0, stunned: false,
  buffs: 0, attachedTo: null, faceDown: false, isToken: false, ...overrides,
});


test("source-relative scope resolves self/opponent from the source controller", () => {
  const registry = new ContinuousEffectRegistry();
  const source = { id: "source", zoneEntryId: 1 };
  const affected = { id: "affected", zoneEntryId: 2 };
  registry.register({
    id: "relative", layer: "ability", source,
    filter: { controller: "source-controller" },
    effect: { kind: "restriction", actions: ["play"], restriction: "source-only", sourcePlayer: "A" },
  }, { type: "permanent" });
  const scope = { source: snapshot(source, "A"), affected: snapshot(affected, "A"), player: "A" };
  assert.equal(canPlay(registry, scope), false);
  assert.equal(canPlay(registry, { ...scope, affected: snapshot(affected, "B") }), true);
});

test("play and activate timing grants remain separate", () => {
  const registry = new ContinuousEffectRegistry();
  const card = { id: "card", zoneEntryId: 1 };
  const object = snapshot(card);
  registry.register({ id: "play", layer: "ability", source: card, filter: {}, effect: { kind: "timing", grants: ["action"], appliesTo: ["card"], actionKind: "play" } }, { type: "permanent" });
  registry.register({ id: "activate", layer: "ability", source: card, filter: {}, effect: { kind: "timing", grants: ["reaction"], appliesTo: ["activated-ability"], actionKind: "activate" } }, { type: "permanent" });
  assert.deepEqual(actionTimings(registry, { source: object, affected: object, actionKind: "play" }), ["action"]);
  assert.deepEqual(actionTimings(registry, { source: object, affected: object, actionKind: "activate" }), ["reaction"]);
});

test("action consumers expose target, cost, and play decisions", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "target-deny", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "restriction", actions: ["target"], restriction: "untargetable" } }, { type: "permanent" });
  registry.register({ id: "cost", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "applied-cost", actions: ["play"], cost: { energy: 1 }, actionKind: "play" } }, { type: "permanent" });
  assert.equal(canTarget(registry), false);
  assert.equal(canPlay(registry), true);
  assert.equal(actionRules(registry, "play").appliedCosts.length, 1);
});

test("ability-use and resource rules preserve null-safe values and fail closed for unknowns", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "uses", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "ability-count", limit: 1, scope: "turn", activator: "controller" } }, { type: "permanent" });
  registry.register({ id: "energy", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "resource", resource: "energy", actions: ["gain"], amount: 1, allowed: true } }, { type: "permanent" });
  registry.register({ id: "unknown", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "resource", resource: "mystery", actions: ["gain"], amount: 99 } }, { type: "permanent" });
  assert.equal(abilityUses(registry)[0].limit, 1);
  assert.equal(canGainResource(registry, "energy"), true);
  assert.equal(canGainResource(registry, "mystery"), false);
  assert.equal(resourceRules(registry, "mystery").length, 0);
});

test("unknown restrictions and combat flags are not executable", () => {
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "future", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "restriction", actions: ["play"], restriction: "future-official-rule" } }, { type: "permanent" });
  registry.register({ id: "future-combat", layer: "ability", source: { id: "s", zoneEntryId: 1 }, filter: {}, effect: { kind: "combat", flags: ["future-combat-rule"] } }, { type: "permanent" });
  assert.equal(restrictions(registry, "play").length, 1);
  assert.equal(canPlay(registry), false);
  assert.equal(combatRules(registry).length, 0);
  assert.equal(canApplyCombatRule(registry, "future-combat-rule"), false);
});

test("continuous instructions execute through the real registry and deck name stays scoped", () => {
  const kernel = world().unit("hero", { name: "Hero" }).build();
  runInstruction(restrict, { mode: literal("applied-cost"), action: literal("play"), cost: literal({ energy: 1 }) }, { world: kernel });
  runInstruction(timing, { grants: literal("action") }, { world: kernel });
  runInstruction(deck, { mode: literal("max"), amount: literal(1), name: literal("Hero"), appliesTo: literal({ type: "unit" }) }, { world: kernel });
  const registry = registryOf(kernel);
  assert.equal(actionRules(registry, "play").appliedCosts.length, 1);
  assert.deepEqual(actionTimings(registry), ["action"]);
  assert.deepEqual(deckLimit(registry, "Hero"), { mode: "max", amount: 1 });
  assert.equal(deckLimit(registry, "Other"), null);
});
