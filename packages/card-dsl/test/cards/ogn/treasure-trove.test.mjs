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
  assert.match(program.judgeReason, /383\.2\.c\.3/);
  assert.match(program.judgeReason, /detachSource/);
  assert.match(program.judgeReason, /object-left-zone/);
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
    event: "object-left-zone",
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

test("Treasure Trove: the own-leave filter matches actual action-producer emissions only for this source", async () => {
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const { matchesTriggerEvent } = await import("../../../../engine-core/dist/events/pipeline-match.js");
  const f = fixture({ cards: [{ id: "trove", cardId: program.canonicalCardId, types: ["gear"], power: ["Chaos"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("trove"), to: "board", location: { type: "base", player: "A" } });
  const filter = translateTriggerFilter(program.abilities[0].trigger.filter, "trove", "object-leaves-board");
  const own = f.host.execute({ type: "kill", object: f.kernel.ref("trove") }).emissions.find(event => event.timingPoint === "object-leaves-board");
  assert.equal(own.kind, "object-left-zone");
  assert.equal(matchesTriggerEvent(filter, own, "A"), true);
  assert.equal(own.object.zone, "board");
  const other = f.host.execute({ type: "kill", object: f.kernel.ref("enemy") }).emissions.find(event => event.timingPoint === "object-leaves-board");
  assert.equal(matchesTriggerEvent(filter, other, "A"), false);
});

test("Treasure Trove: the merged activated binding pays exhaust at Finalize before kill-this", async () => {
  const { fixture, resolveAll } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  // Bind only the supported activated ability, keeping the blocked leave
  // lifecycle outside this component test.
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined, abilities: [program.abilities[1]] }] });
  const f = fixture({ cards: [{ id: "trove", cardId: program.canonicalCardId, types: ["gear"], power: ["Chaos"] }] });
  f.kernel.addPlayer("A", { power: ["Chaos"] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("trove"), to: "board", location: { type: "base", player: "A" } });
  f.engine.advance();
  const draft = binding.describeActivate(f.kernel.getObject("trove"), "A");
  assert.deepEqual(draft.body, program.abilities[1].body);
  f.engine.execute(draft);
  assert.equal(f.kernel.getObject("trove").exhausted, true);
  assert.equal(f.kernel.getObject("trove").zone, "board");
  const [item] = f.engine.items;
  assert.equal(item.status, "finalized");
  assert.equal(item.payment.paid, true);
  assert.deepEqual(item.costPlan.total.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("trove").zone, "trash");
  const timings = f.engine.pipeline.events.map(event => event.timingPoint);
  assert.ok(timings.indexOf("object-exhausted") < timings.indexOf("object-killed"));
});

test("Treasure Trove: the original leave body draws and submits the exhausted-channel action through the interpreter", async () => {
  const { resolveChainBody } = await import("../../../../engine-core/dist/chain/interpreter-adapter.js");
  const base = world().unit("trove", { types: ["gear"] }).deck(["top"]).rune(["rune"]).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("trove") });
  const { bindResolveContext } = await import("../../../../engine-core/dist/events/action-adapter.js");
  const actions = [];
  const result = resolveChainBody(program.abilities[0].body, bindResolveContext(kernel, {
    perform: action => { actions.push(action); return kernel.perform(action); }
  }));
  assert.equal(result.status, "executed");
  assert.deepEqual(result.events.map(event => event.action), ["draw", "channel-rune"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.getObject("rune").zone, "rune-zone");
  assert.deepEqual(actions, [
    { type: "draw", player: "A", amount: 1 },
    { type: "channel-rune", player: "A", amount: 1, exhausted: true }
  ]);
});

test.todo("Treasure Trove: preserve the own-leave registration until deferred event scanning captures LKI, then detach it (CR 383.2.c.3/a/b; programs/lifecycle + events/pipeline.publish)", async () => {
  const { fixture, resolveAll } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  // Test the desired lifecycle with the authored IR; this TODO is not evidence
  // that the judge-required registry entry can be enabled in production.
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const f = fixture({ cards: [{ id: "trove", cardId: program.canonicalCardId, types: ["gear"] }] });
  const lifecycle = binding.attachLifecycle(f.engine);
  try {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref("trove"), to: "board", location: { type: "base", player: "A" } });
    f.engine.advance();
    f.engine.commit({ type: "kill", object: f.kernel.ref("trove") });
    assert.equal(f.kernel.getObject("trove").zone, "trash");
    assert.equal(f.engine.items.length, 1);
    assert.equal(f.engine.items[0].source.zone, "board");
    assert.deepEqual(f.engine.items[0].body, program.abilities[0].body);
    const handBefore = f.kernel.player("A").handSize;
    resolveAll(f.engine);
    assert.equal(f.kernel.player("A").handSize, handBefore + 1);
  } finally {
    lifecycle.detach();
  }
});

test.todo("Treasure Trove: channel-rune must consume exhausted:true as the rune entry state, without a later exhaust action (CR 431.2; effects/testing/test-kernel action consumer)", () => {
  const kernel = world().rune(["rune"]).build();
  const run = runInstruction(channel, program.abilities[0].body[1].args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("rune").zone, "rune-zone");
  assert.equal(kernel.getObject("rune").exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["channel-rune"]);
});
