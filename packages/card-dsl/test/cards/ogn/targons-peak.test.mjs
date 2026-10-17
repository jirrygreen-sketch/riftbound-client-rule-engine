import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/targons-peak.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, trigger, settle, move } from "../../../../engine-core/test/turn/helpers.mjs";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-443bbd81ca54ffdeed5341da932702bf2c62ea4d20d8be07b4fbfc36c4340493";
const [ability] = program.abilities;
const [delay] = ability.body;
const [readyInstruction] = delay.args.body.value;


test("ogn-289-298 Targon's Peak: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /registerDelayedTrigger/);
  assert.match(program.judgeReason, /here/);
  assert.equal(program.sourceText, "When you conquer here, ready 2 runes at the end of this turn.");
});

test("ogn-289-298: conquer trigger registering an end-of-turn ready-2-runes delayed effect", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquered",
    here: true,
    player: "controller"
  });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(delay.id, "targons-peak.ready-2-runes");
  // The printed timing ("at the end of this turn", CR 391.2 / 355.5.b) and the
  // printed count (2 runes) are recorded; the registration primitive itself is
  // not merged (see judgeReason).
  assert.deepEqual(delay.args.at, { kind: "constant", value: "turn-end" });
  assert.deepEqual(delay.args.window, { kind: "constant", value: "this-turn" });
  assert.equal(delay.args.body.kind, "constant");

  assert.equal(readyInstruction.id, "targons-peak.ready");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "pick", id: "targons-peak.runes" }
  });
  // The choice of runes belongs to the delayed trigger's finalize (355.5.b),
  // so it is a non-target pick, never a TargetSpec.
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(readyInstruction.picks.length, 1);
  const [runes] = readyInstruction.picks;
  assert.equal(runes.id, "targons-peak.runes");
  assert.deepEqual(runes.filter, { type: "rune", zone: "rune-zone", controller: "self" });
  assert.equal(runes.min, 1);
  assert.equal(runes.max, 2);
  assert.equal(runes.selection, "up-to");
});

test("ogn-289-298: the merged ready primitive supports the printed sub-instruction while delay remains pending", () => {
  assert.equal(instructionDefinitionsById.has("effect.ready"), true);
});

test("ogn-289-298: real TurnFlow movement and showdown produce the conquer wave and trigger", () => {
  const f = fixture({ fields: [{ id: "battlefield-1", controller: null }, { id: "battlefield-2", controller: null }] });
  // A separate draw observer checks routing, without pretending the card's
  // delayed-ready instruction has an implementation.
  trigger(f, "conquer-observer", "conquer", {
    spec: { at: "conquer", filter: { event: "conquered", player: "self" } }
  });
  const seen = [];
  const enqueue = f.flow.chain.pipeline.onTrigger;
  f.flow.chain.pipeline.onTrigger = snapshot => { seen.push(snapshot); enqueue(snapshot); };
  f.flow.start();
  f.flow.execute(f.draft("move-to-peak", [move("move", { type: "battlefield", id: "battlefield-1" })]));
  settle(f.flow);
  assert.equal(f.flow.chain.turnState, "showdown-open");
  f.flow.pass("A");
  f.flow.pass("B");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "battlefield-1");
  const filter = translateTriggerFilter({
    event: ability.trigger.filter.event, player: ability.trigger.filter.player
  }, "peak", ability.trigger.at);
  assert.equal(filter.event, "conquered");
  assert.equal(matchesTriggerEvent(filter, seen[0].event, "A"), true);
  assert.equal(matchesTriggerEvent(filter, seen[0].event, "B"), false);
  assert.equal(f.kernel.getObject("source").location.id, "battlefield-1");
  assert.equal(f.flow.battlefields[0].controller, "A");
  assert.equal(f.kernel.player("A").score, 1);
  settle(f.flow);
  assert.equal(f.kernel.player("A").handCount, 2);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer").length, 1);
});

test("ogn-289-298: the printed ready-2-runes sub-instruction readies the chosen runes (416.1)", () => {
  // Only the printed sub-effect is exercised here, with its up-to pick supplied
  // through the non-target pick channel, as the delayed trigger's finalize
  // would: the primitive still performs real ready actions.
  const kernel = world()
    .card("rune-a", { zone: "rune-zone", types: ["rune"], exhausted: true })
    .card("rune-b", { zone: "rune-zone", types: ["rune"], exhausted: true })
    .card("rune-c", { zone: "rune-zone", types: ["rune"], exhausted: true })
    .build();
  const ran = runInstruction(
    ready,
    {
      objects: { kind: "constant", value: { kind: "pick", id: "targons-peak.runes" } },
      amount: readyInstruction.args.amount
    },
    {
      world: kernel,
      picks: { "targons-peak.runes": [kernel.ref("rune-a"), kernel.ref("rune-c")] }
    }
  );
  assert.equal(ran.result.status, "executed");
  assert.deepEqual(ran.events.map(event => event.action), ["ready", "ready"]);
  assert.equal(ran.linked.readied.count, 2);
  assert.equal(kernel.getObject("rune-a").exhausted, false);
  assert.equal(kernel.getObject("rune-b").exhausted, true);
  assert.equal(kernel.getObject("rune-c").exhausted, false);
});

test.todo(
  "ogn-289-298: 带到期窗口的延迟触发注册原语（at: turn-end / this-turn 窗口）落地，" +
    "conquer 结算时不做出符文选择，改由延迟触发 Finalize 选择（CR 391.2/355.5.b）" +
    "；内部已支持触发频度及 expiresAt，仍需卡牌指令接入 registerDelayedTrigger 与非目标选择计划"
);
test.todo(
  "ogn-289-298: binding the here-anchored conquer filter and the card program's triggered ability into " +
    "the pipeline still needs the here anchor; conquered already matches the real conquer emission"
);

test("Targon's Peak: the authored ready sub-body executes through the chain adapter on non-target picks", () => {
  const kernel = world()
    .card("rune-a", { zone: "rune-zone", types: ["rune"], exhausted: true })
    .card("rune-b", { zone: "rune-zone", types: ["rune"], exhausted: true })
    .card("rune-c", { zone: "rune-zone", types: ["rune"], exhausted: true })
    .build();
  kernel.setPicks("targons-peak.runes", [kernel.ref("rune-b"), kernel.ref("rune-c")]);
  const outcome = resolveChainBody(delay.args.body.value, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["targons-peak.ready.readied"].count, 2);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready", "ready"]);
  assert.equal(kernel.getObject("rune-a").exhausted, true);
  assert.equal(kernel.getObject("rune-b").exhausted, false);
  assert.equal(kernel.getObject("rune-c").exhausted, false);
});
