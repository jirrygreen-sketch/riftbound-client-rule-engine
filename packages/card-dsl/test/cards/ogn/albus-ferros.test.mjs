import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/albus-ferros.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ef48253b8c94c8b28932090e3ba51b03bd2a1b1ea8a5465de707daabf2bb92c5";
const ability = program.abilities[0];
const [spendInstruction, channelInstruction] = ability.body;
const [buffPick] = spendInstruction.picks;

// Primitive-only adapter: effect.buff currently consumes targets, not the
// counter PickSpec declared by the card. Keep that limitation explicit while
// producing the real spend receipt for the card's unchanged repeat body.
const supportedSpend = {
  ...spendInstruction,
  args: {
    mode: spendInstruction.args.mode,
    target: spendInstruction.args.pick
  },
  picks: undefined
};

test("ogn-230-298 Albus Ferros: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-230-298 Albus Ferros: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // CR 704.1 / 742.1: Buff counters are counters, not game objects that can be targeted.
  assert.match(program.judgeReason, /704\.1/);
  assert.match(program.judgeReason, /pick/);
  assert.equal(
    program.sourceText,
    "When you play me, spend any number of buffs. For each buff spent, channel 1 rune exhausted."
  );
});

test("ogn-230-298 Albus Ferros: mandatory card-played trigger with the counter spend and the per-buff channel", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  // The binding layer translates the nested self anchor to the host object.
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // No "may" in the printed text: the trigger is mandatory.
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "albus-ferros.spend-buffs",
    "albus-ferros.channel-per-buff"
  ]);
});

test("ogn-230-298 Albus Ferros: the buff spend is declared as a non-target pick (not a TargetSpec)", () => {
  assert.equal(spendInstruction.op, "effect.buff");
  assert.deepEqual(spendInstruction.args.mode, { kind: "constant", value: "spend" });
  // Contract 3.4 / CR 704.1: counters are chosen at resolution and are never targets.
  assert.deepEqual(spendInstruction.args.pick, { kind: "constant", value: "albus-ferros.buffs" });
  assert.equal(spendInstruction.targets, undefined);
  assert.equal(spendInstruction.picks.length, 1);
  assert.equal(buffPick.id, "albus-ferros.buffs");
  assert.deepEqual(buffPick.options, ["buffed-friendly-unit"]);
  assert.deepEqual(buffPick.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    buffed: true
  });
  // CR 355.13: "any number" includes choosing zero.
  assert.equal(buffPick.min, 0);
  assert.equal(buffPick.selection, "any");
  assert.equal(spendInstruction.linkedTo, undefined);
});

test("ogn-230-298 Albus Ferros: the merged binding matches only the host card-played event", () => {
  // The binding translates the nested self anchor into an object-id pattern,
  // so another copy with the same canonical card id does not trigger it.
  const translated = translateTriggerFilter(ability.trigger.filter, "albus-host", "card-played");
  assert.deepEqual(translated, {
    event: "card-played",
    object: { objectId: "albus-host" }
  });
  const result = validateTriggerSpec({ at: "card-played", filter: translated });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));

  const kernel = world()
    .unit("albus-host", { cardId: CANONICAL })
    .unit("albus-copy", { cardId: CANONICAL })
    .build();
  const base = { timingPoint: "card-played", kind: "card-played", player: "A" };
  assert.equal(
    matchesTriggerEvent(translated, { ...base, object: kernel.getObject("albus-host") }, "A"),
    true
  );
  assert.equal(
    matchesTriggerEvent(translated, { ...base, object: kernel.getObject("albus-copy") }, "A"),
    false
  );
});

test("ogn-230-298 Albus Ferros: the channel instruction repeats once per buff actually spent", () => {
  assert.equal(channelInstruction.op, "repeat");
  assert.equal(channelInstruction.linkedTo, undefined);
  assert.deepEqual(channelInstruction.args.count, {
    kind: "linked-value",
    instructionId: "albus-ferros.spend-buffs",
    key: "spentCount"
  });
  assert.deepEqual(channelInstruction.args.body.kind, "constant");
  const [channelOne] = channelInstruction.args.body.value;
  assert.equal(channelOne.id, "albus-ferros.channel-1");
  assert.equal(channelOne.op, "effect.channel");
  assert.deepEqual(channelOne.args.amount, { kind: "constant", value: 1 });
  // CR 431.2: the printed "exhausted" stipulation enters the rune exhausted.
  assert.deepEqual(channelOne.args.exhausted, { kind: "constant", value: true });
});

test("ogn-230-298 Albus Ferros: spending two buffs channels exactly two runes", () => {
  const kernel = world()
    .unit("buffed-one", { controller: "A", buffs: 1 })
    .unit("buffed-two", { controller: "A", buffs: 1 })
    .rune(["rune-1", "rune-2", "rune-3"])
    .build();
  kernel.setTargets(buffPick.id, [kernel.ref("buffed-one"), kernel.ref("buffed-two")]);
  const outcome = resolveChainBody([supportedSpend, channelInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["rune-1", "rune-2"]);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.getObject("buffed-one").buffs, 0);
  assert.equal(kernel.getObject("buffed-two").buffs, 0);
  assert.equal(outcome.results[0].result.linkedValues.spentCount, 2);
  assert.deepEqual(outcome.results[0].result.linkedValues.spent.map(ref => ref.id), ["buffed-one", "buffed-two"]);
  const channeled = outcome.results.filter(result => result.op === "effect.channel");
  assert.equal(channeled.length, 2);
  assert.equal(channeled.every(result => result.result.status === "executed"), true);
  assert.equal(
    outcome.events.filter(event => event.action === "channel-rune").length,
    2
  );
});

test("ogn-230-298 Albus Ferros: spending zero buffs channels nothing", () => {
  const kernel = world().unit("unbuffed", { controller: "A", buffs: 0 }).rune(["rune-1"]).build();
  kernel.setTargets(buffPick.id, [kernel.ref("unbuffed")]);
  const spend = resolveChainBody([supportedSpend], kernel);
  assert.equal(spend.results[0].result.status, "negated");
  assert.equal(spend.results[0].result.reason, "skipped");
  // The primitive publishes the actual zero receipt even when no buff exists.
  assert.equal(kernel.linked("albus-ferros.spend-buffs.spentCount"), 0);
  const outcome = resolveChainBody([channelInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(outcome.events.filter(event => event.action === "channel-rune").length, 0);
  assert.equal(kernel.getObject("unbuffed").buffs, 0);
});

test("ogn-230-298 Albus Ferros: the merged effect.buff spends a counter through its target form", () => {
  // The declared pick form (args.pick) is not consumed by the merged effect.buff, so the
  // merged half is exercised through its supported TargetSpec form: the already-buffed
  // unit loses exactly one counter (702.2.b) and the spent count feeds the repeat.
  const kernel = world().unit("buffed", { controller: "A", buffs: 1 }).rune(["rune-1"]).build();
  kernel.setTargets("albus-ferros.buffs", [kernel.ref("buffed")]);
  const outcome = resolveChainBody(
    [
      {
        id: "albus-ferros.spend-buffs",
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "spend" },
          target: { kind: "constant", value: "albus-ferros.buffs" }
        }
      }
    ],
    kernel
  );

  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.spent.map(ref => ref.id), ["buffed"]);
  assert.equal(outcome.results[0].result.linkedValues.spentCount, 1);
  assert.equal(kernel.getObject("buffed").buffs, 0);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test.todo(
  "ogn-230-298 Albus Ferros: choose any number of friendly buff counters at resolution through a non-target effect.buff pick/choose entry (CR 704.1/742.1/745.1.a); use its actual spentCount for repeat/channel."
);
test.todo(
  "ogn-230-298 Albus Ferros: execute the full bound card-played trigger after the non-target counter choice exists; current tests only run the supported target-form spend and the original repeat/channel body."
);
