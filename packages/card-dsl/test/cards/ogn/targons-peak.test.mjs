import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/targons-peak.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-33|RIFT-31/);
  assert.equal(program.sourceText, "When you conquer here, ready 2 runes at the end of this turn.");
});

test("ogn-289-298: conquer trigger registering an end-of-turn ready-2-runes delayed effect", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
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

test("ogn-289-298: merged code has no delayed-registration primitive and the placeholder is unregistered", () => {
  // Evidence for the judgeReason: the readying must not happen during the
  // conquer resolution (355.5.b), and no registered opcode can defer it.
  assert.equal(instructionDefinitionsById.has("effect.delay"), false);
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), false);
  assert.equal(instructionDefinitionsById.has("effect.ready"), true);
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
    "（依赖 RIFT-33 延迟窗口契约变更请求 3 与解释器生命周期契约变更请求 2）"
);
test.todo(
  "ogn-289-298: conquer 由 scoring 发出并进链（RIFT-31 scenarios-scoring）"
);
