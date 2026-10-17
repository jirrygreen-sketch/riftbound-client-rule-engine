import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/treasure-trove.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("ogn-186-298 Treasure Trove: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-186-298 Treasure Trove: identity, version and verbatim multiline source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-42b87e27f1b0c57a6160fc790e9257e741e6d8ec2e0f7a846d8aa0f6bcbe04f2"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /pipeline-match/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "When this leaves the board, draw 1 and channel 1 rune exhausted.\n" +
      ":rb_rune_chaos:, :rb_exhaust:: Kill this."
  );
});

test("ogn-186-298 Treasure Trove: leave-board trigger draws 1 and channels 1 exhausted (independent instructions)", () => {
  assert.equal(program.abilities.length, 2);
  const [leaveTrigger, killSelf] = program.abilities;

  assert.equal(leaveTrigger.kind, "triggered");
  assert.equal(leaveTrigger.trigger.at, "object-leaves-board");
  assert.deepEqual(leaveTrigger.trigger.filter, {
    event: "object-leaves-board",
    filter: { role: "self" }
  });
  assert.equal(leaveTrigger.optional, false);
  assert.equal(leaveTrigger.trigger.once, undefined);
  assert.deepEqual(leaveTrigger.body.map(instruction => instruction.id), [
    "treasure-trove.draw",
    "treasure-trove.channel"
  ]);
  const [drawInstruction, channelInstruction] = leaveTrigger.body;
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.linkedTo, undefined);

  assert.equal(killSelf.kind, "activated");
  assert.equal(killSelf.timing, "action");
  assert.deepEqual(killSelf.cost.power, { kind: "constant", value: ["Chaos"] });
  assert.equal(killSelf.cost.energy, undefined);
  assert.deepEqual(killSelf.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(killSelf.body.length, 1);
  assert.equal(killSelf.body[0].op, "effect.kill");
  assert.deepEqual(killSelf.body[0].args.self, { kind: "constant", value: true });
});

test("ogn-186-298 Treasure Trove: draw 1 half executes through effect.draw", () => {
  const [leaveTrigger] = program.abilities;
  const [drawInstruction] = leaveTrigger.body;
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test("ogn-186-298 Treasure Trove: channel 1 rune exhausted half executes through effect.channel", () => {
  const [leaveTrigger] = program.abilities;
  const [, channelInstruction] = leaveTrigger.body;
  const kernel = world().rune(["r1", "r2"]).build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
});

test("ogn-186-298 Treasure Trove: kill-this half kills the source gear through effect.kill self", () => {
  const [, killSelf] = program.abilities;
  const [instruction] = killSelf.body;
  const kernel = world()
    .unit("treasure-trove", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("treasure-trove") });
  const run = runInstruction(kill, { self: true, reason: "kill-this" }, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.getObject("treasure-trove").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
  assert.equal(instruction.args.self.value, true);
});

test.todo(
  "Treasure Trove: production object-leaves-board trigger registration with last-known source information " +
    "(383.2.c.3 / card-program trigger adapter, RIFT-257 programs/triggers.ts, whose " +
    "translateTriggerFilter normalizes the role/self anchor the merged matcher ignores)"
);
test.todo(
  "Treasure Trove: pay 1 Chaos Power plus exhaust-this at Finalize before the kill-self ability resolves " +
    "(chain cost plan + the activated-ability program binding, RIFT-257/RIFT-261)"
);
