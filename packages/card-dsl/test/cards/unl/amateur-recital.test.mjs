import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/amateur-recital.js";
// effect.move declares Expr-typed arguments, so the body runs through the
// production chain adapter, which preserves the Expr nodes for the primitive's
// own schema validation (engine-core/src/chain/interpreter-adapter.ts).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-16deedb0db72d0ab2151c19d3fe3648037a218f76385c1a46853b273e5671102";
const SOURCE_TEXT = "When you hold here, you may move a unit at a battlefield to its base.";
const HERE = { type: "battlefield", id: "battlefield-1" };
const ELSEWHERE = { type: "battlefield", id: "battlefield-2" };
const BASE = { type: "base", player: "A" };

const [ability] = program.abilities;
const [optional] = ability.body;
const [moveInstruction] = optional.args.body.value;
const [targetSpec] = moveInstruction.targets;

/** Drop the nested TargetSpec: the reference kernel compares filters literally. */
const bodyWithoutTargets = () => [
  {
    ...optional,
    args: {
      ...optional.args,
      body: {
        ...optional.args.body,
        value: [(({ targets, ...rest }) => rest)(moveInstruction)]
      }
    }
  }
];

test("unl-207-219 Amateur Recital: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-207-219 Amateur Recital: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("unl-207-219 Amateur Recital: a hold trigger with an optional move wrapped in choice.optional", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d.1/383.4.d.2.b: "When you hold here" is a Hold Effect; the point is
  // the Beginning Phase scoring step's hold.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, {
    event: "hold",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a: "you may" as the first part of the effect is the finalize
  // decision, and contract 3.9 wraps the chosen instruction.
  assert.equal(ability.optional, true);

  assert.equal(ability.body.length, 1);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Move a unit at a battlefield to its base?"
  });
  assert.equal(optional.args.body.value.length, 1);
});

test("unl-207-219 Amateur Recital: the move is an effect Move to its own controller's Base", () => {
  assert.equal(moveInstruction.id, "amateur-recital.move");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "amateur-recital.unit-at-battlefield" }
  });
  // 421/451: an effect Move, not the Standard Move; 107.1.c makes "its base"
  // the moved unit's controller's Base, exactly "controller-base".
  assert.deepEqual(moveInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveInstruction.args.mode, undefined);
  assert.equal(moveInstruction.linkedTo, undefined);

  // 355.9.a.1/355.9.b/355.10.b: "a unit at a battlefield" targets one public
  // Board unit; "at a battlefield" is a targeting restriction, not a target.
  assert.equal(moveInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "amateur-recital.unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    zone: "board",
    location: "battlefield"
  });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("unl-207-219 Amateur Recital: accepting the option moves the locked unit to its Base", () => {
  // The reference kernel is value-based, so the Finalize-locked target set is
  // supplied directly and the printed TargetSpec is dropped for execution
  // (ogn/reavers-row, ogn/pit-rookie precedent). effect.move still performs the
  // real move-location action and the interpreter still runs choice.optional.
  const kernel = world()
    .unit("recital", { types: ["battlefield"], location: HERE })
    .unit("battle-unit", { location: HERE, might: 2 })
    .build();
  kernel.setTargets("amateur-recital.unit-at-battlefield", [kernel.ref("battle-unit")]);
  kernel.setAnswers({ "amateur-recital.opt-in/optional": true });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("recital") });

  const ran = resolveChainBody(bodyWithoutTargets(), scoped);
  assert.equal(ran.status, "executed");
  const accepted = ran.results.find(entry => entry.id === "amateur-recital.opt-in");
  assert.equal(accepted.result.status, "executed");
  assert.deepEqual(ran.events.map(event => event.action), ["move-location"]);
  assert.deepEqual(scoped.getObject("battle-unit").location, BASE);
  assert.equal(moveInstruction.args.to.value, "controller-base");

  // The printed ability allows any unit at any battlefield, so a unit at a
  // different battlefield is a legal lock too; it moves to its own Base.
  const other = world()
    .unit("recital", { types: ["battlefield"], location: { type: "battlefield", id: "bf-other" } })
    .unit("there-unit", { location: ELSEWHERE, might: 2 })
    .build();
  other.setTargets("amateur-recital.unit-at-battlefield", [other.ref("there-unit")]);
  other.setAnswers({ "amateur-recital.opt-in/optional": true });
  const scopedOther = other.clone({ sourceSnapshot: other.getObject("recital") });
  const second = resolveChainBody(bodyWithoutTargets(), scopedOther);
  assert.equal(second.status, "executed");
  assert.deepEqual(scopedOther.getObject("there-unit").location, BASE);
});

test("unl-207-219 Amateur Recital: declining the option moves nothing", () => {
  const kernel = world()
    .unit("recital", { types: ["battlefield"], location: HERE })
    .unit("battle-unit", { location: HERE, might: 2 })
    .build();
  kernel.setTargets("amateur-recital.unit-at-battlefield", [kernel.ref("battle-unit")]);
  kernel.setAnswers({ "amateur-recital.opt-in/optional": false });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("recital") });

  const ran = resolveChainBody(bodyWithoutTargets(), scoped);
  const declined = ran.results.find(entry => entry.id === "amateur-recital.opt-in");
  assert.equal(declined.result.status, "negated");
  assert.equal(declined.result.reason, "skipped");
  assert.deepEqual(ran.events, []);
  assert.deepEqual(scoped.getObject("battle-unit").location, HERE);
});

test("unl-207-219 Amateur Recital: the merged hold emission reaches a plain hold registration", () => {
  // turn/flow.ts publishes the Beginning Scoring Step's hold through the Score
  // wave into the single event pipeline (471.2 / 473.2.b), carrying the held
  // battlefield as details.battlefieldId. The card-side gap is the here anchor,
  // not the producer (same assertion as ogn/startipped-peak).
  const source = {
    ref: { id: "recital", zoneEntryId: 1 }, cardId: CANONICAL, name: "Amateur Recital",
    types: ["battlefield"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: HERE, might: null, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const pipeline = new EventPipeline({
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [source],
    choose: () => { throw new Error("unexpected choose"); }
  }, ["A", "B"], "A");
  const seen = [];
  pipeline.onTrigger = snapshot => seen.push(snapshot);
  pipeline.registerTrigger({
    id: "test.hold.plain",
    source,
    controller: "A",
    spec: { at: "hold", filter: { event: "held", player: "self" } },
    body: []
  });

  pipeline.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "battlefield-1" } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "battlefield-1");
});

test("unl-207-219 Amateur Recital: the here placeholder is rejected by the merged trigger translator", () => {
  // The frozen EventPattern vocabulary has no battlefield-relative anchor: the
  // RIFT-257 adapter fails closed on the placeholder key instead of binding a
  // filter that would match holds at every battlefield.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = {
    ref: { id: "recital", zoneEntryId: 1 }, cardId: CANONICAL, name: "Amateur Recital",
    types: ["battlefield"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: HERE, might: null, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  assert.throws(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: () => {} } }, source),
    error => error.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
});
