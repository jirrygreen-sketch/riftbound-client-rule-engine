import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/pillaged-armory.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const buff = (await import(new URL("effects/instructions/effect.buff.js", ENGINE))).default;

const CARD_ID = "card.hash-c3300d4c2699318874a04e6169dc566f6c3e88300d3f2ccd920a1edf3352d84a";
const EXPECTED_SOURCE =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this or when you conquer here, [Buff] a friendly unit. " +
  "(Give it a +1 :rb_might: buff if it doesn't have one.)";

test("rad-073-167 Pillaged Armory: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /TriggerRegistration/);
});

test("rad-073-167 Pillaged Armory: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-073-167 Pillaged Armory: Deploy keyword plus two independent Buff triggers", () => {
  assert.equal(program.abilities.length, 3);
  const [deploy, onPlay, onConquer] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 383.4.a.1：Gear 的 Play Effect。
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(onPlay.optional, false);
  assert.deepEqual(onPlay.body.map((step) => [step.id, step.op]), [
    ["pillaged-armory.buff-on-play", "effect.buff"]
  ]);

  // 383.4.c.1："when you conquer here"。
  assert.equal(onConquer.kind, "triggered");
  assert.equal(onConquer.trigger.at, "conquer");
  assert.deepEqual(onConquer.trigger.filter, { event: "conquer", here: true, player: "self" });
  assert.equal(onConquer.optional, false);
  assert.deepEqual(onConquer.body.map((step) => [step.id, step.op]), [
    ["pillaged-armory.buff-on-conquer", "effect.buff"]
  ]);
});

test("rad-073-167 Pillaged Armory: each Buff instruction targets exactly one friendly board unit", () => {
  const [, onPlay, onConquer] = program.abilities;
  for (const [specId, ability] of [
    ["friendly-unit-on-play", onPlay],
    ["friendly-unit-on-conquer", onConquer]
  ]) {
    const [instruction] = ability.body;
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "buff" });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: specId });
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.picks, undefined);
    assert.deepEqual(instruction.targets, [{
      id: specId,
      filter: { type: "unit", controller: "self", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }]);
  }
});

test("rad-073-167 Pillaged Armory: the Buff body really places a Buff counter (CR 427.1.b)", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world()
    .unit("pillaged-armory", { types: ["gear"], might: null, energy: 1, power: null })
    .unit("friendly-unit", { might: 2, buffs: 0 })
    .build();
  const run = runInstruction(
    buff,
    { mode: instruction.args.mode.value, target: instruction.args.target.value },
    { world: kernel, targets: { "friendly-unit-on-play": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["buff"]);
});

test("rad-073-167 Pillaged Armory: a unit that already has a Buff is not buffed again (CR 702.3.a)", () => {
  const [instruction] = program.abilities[2].body;
  const kernel = world()
    .unit("pillaged-armory", { types: ["gear"], might: null, energy: 1, power: null })
    .unit("already-buffed", { might: 2, buffs: 1 })
    .build();
  const run = runInstruction(
    buff,
    { mode: instruction.args.mode.value, target: instruction.args.target.value },
    { world: kernel, targets: { "friendly-unit-on-conquer": [kernel.ref("already-buffed")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("already-buffed").buffs, 1);
  assert.deepEqual(run.events, []);
});

test("rad-073-167 Pillaged Armory: the Deploy keyword has no merged definition", () => {
  assert.equal(keywordDefinitionsById.get("Deploy"), undefined);
});

test.todo("rad-073-167 Pillaged Armory: Deploy expansion (CR 830.1.b) needs a keywords/Deploy.ts definition plus the continuous.location/continuous.restrict consumers (\"kw-deploy\" workstream).");
test.todo("rad-073-167 Pillaged Armory: both triggers need the program -> TriggerRegistration adapter (contract 3.5, RIFT-120 follow-up) and a conquer payload that carries \"here\" before they can fire for real.");
