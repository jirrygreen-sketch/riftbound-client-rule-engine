import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/stalwart-goatherd.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-7f7a5adb7ade7c414e4fe27dffeabdf651e620759800bc7ab9794451ca9952a9";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "When you play me, you may kill a gear with Energy cost :rb_energy_4: or less.";

const gearKernel = () =>
  world()
    .unit("stalwart-goatherd", { might: 2, zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-gear", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();

test("rad-083-167 Stalwart Goatherd: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /energyLte/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-083-167 Stalwart Goatherd: [Shield 2] keyword and the may-kill trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "shield", value: 2 });

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["stalwart-goatherd.may"]);
});

test("rad-083-167 Stalwart Goatherd: 'you may kill a gear' is a choice.optional body (contract 3.9)", () => {
  const [may] = program.abilities[1].body;
  assert.equal(may.op, "choice.optional");
  assert.equal(may.linkedTo, undefined);
  assert.equal(may.args.body.kind, "constant");

  const [killInstruction] = may.args.body.value;
  assert.equal(killInstruction.id, "stalwart-goatherd.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: "stalwart-goatherd.gear" });
  assert.equal(killInstruction.linkedTo, undefined);
  assert.deepEqual(killInstruction.targets, [
    {
      id: "stalwart-goatherd.gear",
      filter: { type: "gear", zone: "board", energyLte: 4 },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-083-167 Stalwart Goatherd: accepting the optional kills the locked gear through effect.kill", () => {
  const [may] = program.abilities[1].body;
  const kernel = gearKernel();
  // Finalize already resolved the gear choice; the kernel receives it as the
  // locked target set for the declared TargetSpec id.
  kernel.setTargets("stalwart-goatherd.gear", [kernel.ref("friendly-gear")]);
  kernel.setAnswers({ "stalwart-goatherd.may/optional": true });
  const outcome = runAbilityBody([may], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => `${result.id}:${result.result.status}`), [
    "stalwart-goatherd.kill:executed",
    "stalwart-goatherd.may:executed"
  ]);
  // 429.1: a killed permanent goes to the trash from the board.
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(outcome.events.filter(event => event.action === "kill").length, 1);
});

test("rad-083-167 Stalwart Goatherd: declining the optional leaves the gear alone", () => {
  const [may] = program.abilities[1].body;
  const kernel = gearKernel();
  kernel.setTargets("stalwart-goatherd.gear", [kernel.ref("friendly-gear")]);
  kernel.setAnswers({ "stalwart-goatherd.may/optional": false });
  const outcome = runAbilityBody([may], kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["stalwart-goatherd.may"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test("rad-083-167 Stalwart Goatherd: effect.kill ignores a gear that left its zone (CR 359.3.e.7)", () => {
  const kernel = gearKernel();
  const stale = kernel.ref("friendly-gear");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    kill,
    { target: "stalwart-goatherd.gear" },
    { world: kernel, targets: { "stalwart-goatherd.gear": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "stalwart-goatherd: 'gear with Energy cost 4 or less' target restriction (CR 163.1 / 356.x printed Energy)" +
    " needs the target pipeline to evaluate an energyLte filter (RIFT-90 batch3-target-plan);" +
    " energy:null means no printed value and must never be treated as 0"
);
test.todo(
  "stalwart-goatherd: [Shield 2] expansion (+2 Might while defending, stacking sum) through the Shield" +
    " KeywordDef and the layers continuous.might consumer (RIFT-81 / RIFT-91)"
);
