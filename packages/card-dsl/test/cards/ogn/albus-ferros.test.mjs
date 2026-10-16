import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/albus-ferros.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ef48253b8c94c8b28932090e3ba51b03bd2a1b1ea8a5465de707daabf2bb92c5";
const ability = program.abilities[0];
const [spendInstruction, channelInstruction] = ability.body;
const [buffPick] = spendInstruction.picks;

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
  assert.deepEqual(ability.trigger.filter, { role: "self" });
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
  const kernel = world().rune(["rune-1", "rune-2", "rune-3"]).build();
  // The linked count is the value effect.buff publishes after spending; supplying it directly
  // isolates the repeat-driven channel that this card declares.
  kernel.link("albus-ferros.spend-buffs.spentCount", 2);
  const outcome = resolveChainBody([channelInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["rune-1", "rune-2"]);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  const channeled = outcome.results.filter(result => result.op === "effect.channel");
  assert.equal(channeled.length, 2);
  assert.equal(channeled.every(result => result.result.status === "executed"), true);
  assert.equal(
    outcome.events.filter(event => event.action === "channel-rune").length,
    2
  );
});

test("ogn-230-298 Albus Ferros: spending zero buffs channels nothing", () => {
  const kernel = world().rune(["rune-1"]).build();
  kernel.link("albus-ferros.spend-buffs.spentCount", 0);
  const outcome = resolveChainBody([channelInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(outcome.events.filter(event => event.action === "channel-rune").length, 0);
});

test("ogn-230-298 Albus Ferros: the merged effect.buff rejects the declared pick form (fails closed)", () => {
  // The declared pick form (args.pick) is not consumed by the merged effect.buff, so the
  // declared instruction fails closed: no counter is spent and no rune is channeled.
  const kernel = world().unit("buffed", { buffs: 1 }).rune(["rune-1"]).build();
  kernel.setPicks(buffPick.id, [kernel.ref("buffed")]);
  assert.throws(
    () => resolveChainBody([spendInstruction], kernel),
    error => /effect\.buff args: target must be a non-empty TargetSpec id/.test(error.message)
  );
  assert.equal(kernel.getObject("buffed").buffs, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test.todo(
  "ogn-230-298 Albus Ferros: the non-target counter pick (CR 704.1/742.1/745.1.a, any number per " +
    "CR 355.13) needs effect.buff's pick form; the golden tests supply the spend count directly " +
    "because the merged primitive only accepts args.target (TargetSpec)"
);
