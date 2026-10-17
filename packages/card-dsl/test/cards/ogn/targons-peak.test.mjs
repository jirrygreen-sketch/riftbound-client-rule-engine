import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/targons-peak.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
const pipelineModule = await import("../../../../engine-core/dist/events/pipeline.js");

const CANONICAL = "card.hash-443bbd81ca54ffdeed5341da932702bf2c62ea4d20d8be07b4fbfc36c4340493";
const [ability] = program.abilities;
const [delay] = ability.body;
const [readyInstruction] = delay.args.body.value;

/** A minimal board host snapshot for the direct pipeline registration test. */
const battlefieldSource = {
  ref: { id: "targons-peak", zoneEntryId: 1 },
  cardId: CANONICAL,
  name: "Targon's Peak",
  types: ["battlefield"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "battlefield-1" },
  might: null,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
};

test("ogn-289-298 Targon's Peak: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /RIFT-257/);
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

test("ogn-289-298: the merged ready primitive supports the printed sub-instruction while delay remains pending", () => {
  assert.equal(instructionDefinitionsById.has("effect.ready"), true);
});

test("ogn-289-298: the conquer timing point is emitted by the merged TurnFlow Score wave", () => {
  // turn/flow.ts emits the structured conquer/hold/score wave from the Score
  // action (docs/rules/timing-point-producers.md row `conquer` = 已有). The
  // remaining trigger-side gap is the battlefield-relative `here` anchor and the
  // CardProgram binding, not the emission itself.
  const { EventPipeline } = pipelineModule;
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [battlefieldSource],
    choose: () => { throw new Error("unexpected choose"); }
  };
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const seen = [];
  pipeline.onTrigger = (snapshot) => seen.push(snapshot);
  pipeline.registerTrigger({
    id: "test.conquer.plain",
    source: battlefieldSource,
    controller: "A",
    spec: { at: "conquer", filter: { event: "conquered", player: "self" } },
    body: []
  });
  pipeline.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "battlefield-1" } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "battlefield-1");
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
  "ogn-289-298: binding the here-anchored conquer filter and the card program's triggered ability into " +
    "the pipeline (RIFT-257) remains pending; the conquer emission itself is merged"
);
