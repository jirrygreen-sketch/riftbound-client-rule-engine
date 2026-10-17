import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/pillaged-armory.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const buff = (await import(new URL("effects/instructions/effect.buff.js", ENGINE))).default;
const deploy = (await import(new URL("effects/keywords/Deploy.js", ENGINE))).default;
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));

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
  assert.match(program.judgeReason, /RIFT-267/);
  assert.match(program.judgeReason, /RIFT-120/);
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

test("rad-073-167 Pillaged Armory: the merged Deploy expansion and its kill body", () => {
  // RIFT-267's KeywordDef is merged (contract 3.7): it expands to the
  // continuous.location declaration plus the "opponent holds here" kill
  // trigger. The kill body really executes; the consumers that would wire the
  // declaration and the trigger are the open RIFT-120 gaps in judgeReason.
  assert.equal(deploy.keyword, "Deploy");
  const expansion = deploy.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(expansion.map((ability) => ability.kind), ["static", "triggered"]);
  assert.equal(expansion[0].effect.kind, "continuous.location");
  assert.equal(expansion[1].trigger.at, "hold");

  const kill = expansion[1].body[0];
  assert.equal(kill.op, "effect.kill");
  assert.deepEqual(kill.args.self, { kind: "constant", value: true });
  const base = world().object("pillaged-armory", {
    owner: "A", types: ["gear"], might: null, energy: 1, power: null,
    zone: "board", location: { type: "battlefield", id: "bf-1" }
  }).build();
  // effect.kill self acts on the ability source; bind it explicitly like the
  // merged Deploy keyword golden does.
  const kernel = base.clone({ sourceSnapshot: base.getObject("pillaged-armory") });
  const outcome = runAbilityBody(expansion[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("pillaged-armory").zone, "trash");
});

test.todo("rad-073-167 Pillaged Armory: the Deploy expansion's continuous.location play-location permission, the non-Unit cleanup recall exemption and the opponent-Hold kill trigger still need consumers (CR 830.1.b, RIFT-120).");
test.todo("rad-073-167 Pillaged Armory: both triggers need the program -> TriggerRegistration adapter (contract 3.5, RIFT-120 follow-up) and a conquer payload that carries \"here\" before they can fire for real.");
