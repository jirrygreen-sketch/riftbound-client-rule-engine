// Golden test for Storm Raptor (rad-036-167).
//
// judge-required (see the program's judgeReason): the death trigger's "here"
// condition cannot be matched truthfully - trigger binding rejects the
// sameLocationAs anchor and the pipeline matcher does not implement it, while
// the interpreter's set query does. The runnable evidence is the Deflect keyword
// declaration with its merged KeywordDef expansion, and the Draw 1 the trigger
// body performs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/storm-raptor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesTriggerObject } from "../../../../engine-core/dist/events/pipeline-match.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";

const CANONICAL =
  "card.hash-f595b4941f399b2ac63a4066a8805f35b600f3bf7ad4bf6a5b2c66ac8e4d9a21";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When a stunned enemy unit dies here, draw 1.";

const [deflectKeyword, triggered] = program.abilities;
const [drawInstruction] = triggered.body;

test("rad-036-167 Storm Raptor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-036-167 Storm Raptor: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README section 2: name the unmatched condition, the rule and the task.
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /053\.3/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /layerFor/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-036-167 Storm Raptor: [Deflect] is declared and the merged KeywordDef owns its expansion", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  // CR 809.1.b.3: a printed [Deflect] with no number is Deflect 1.
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
  // CR 809.1.c: the tax is paid in Power of any Domain.
  assert.ok(deflect.ruleRefs.includes("809.1.c.1"));
});

test("rad-036-167 Storm Raptor: the death trigger declares the Stunned enemy unit dying at this location", () => {
  assert.equal(triggered.kind, "triggered");
  // CR 429.1: the timing point is the kill.
  assert.equal(triggered.trigger.at, "object-killed");
  assert.equal(triggered.trigger.filter.event, "object-killed");
  // CR 424.1.a: Stunned is a binary state on the dying unit.
  assert.equal(triggered.trigger.filter.filter.states, "stunned");
  // 053.3 restricts "here" to Battlefields; this card is a Unit, so it means
  // "the location this unit is at" (421.1), declared with the location anchor.
  assert.equal(triggered.trigger.filter.filter.sameLocationAs, "source");
  assert.equal(triggered.trigger.filter.filter.controller, "opponent");
  assert.equal(triggered.trigger.filter.filter.type, "unit");
  assert.equal(triggered.optional, false);
});

test("rad-036-167 Storm Raptor: the trigger body is a plain controller Draw 1", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(drawInstruction.id, "storm-raptor.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  // CR 414.3 / 190.6.d: the triggering ability's controller draws the card.
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-036-167 Storm Raptor: the Draw 1 really draws for the controller", () => {
  const kernel = world().unit("storm-raptor", { might: 6 }).deck(["top-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.getObject("storm-raptor").zone, "board");
});

test("rad-036-167 Storm Raptor: the Stunned enemy clause really matches through the merged trigger matcher (424.1.a)", () => {
  const stunnedEnemy = {
    ref: { id: "enemy", zoneEntryId: 1 },
    cardId: "enemy",
    name: "enemy",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: true,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesTriggerObject({ states: "stunned" }, stunnedEnemy, "A"), true);
  assert.equal(
    matchesTriggerObject({ states: "stunned" }, { ...stunnedEnemy, stunned: false }, "A"),
    false
  );
  // The same matcher resolves the enemy-unit and Stunned clauses of the
  // declared filter; the location anchor is the remaining gap.
  assert.equal(
    matchesTriggerObject(triggered.trigger.filter.filter, stunnedEnemy, "A"),
    true
  );
});

test("rad-036-167 Storm Raptor: the real trigger registration really rejects the 'here' anchor", () => {
  // 053.3 / 421.1: "dies here" is a location condition. The production trigger
  // binder refuses the sameLocationAs field, so the trigger never registers.
  const kernel = world().player("A").player("B")
    .unit("storm-raptor", { controller: "A", owner: "A", zone: "board", might: 6, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = { ...kernel.getObject("storm-raptor"), cardId: CANONICAL };
  assert.throws(
    () => triggerRegistrations(new Map([[CANONICAL, program]]), snapshot),
    /Unsupported filter field sameLocationAs/
  );
});

test("rad-036-167 Storm Raptor: the merged matcher passes unknown location anchors, so wiring would misfire", () => {
  // events/pipeline-match.ts matchesTriggerObject implements no location anchor
  // and silently ignores unrecognized filter keys: a stunned enemy that died at
  // a different Battlefield still matches, which is why the card must not be
  // wired without the anchor.
  const elsewhere = {
    ref: { id: "enemy-elsewhere", zoneEntryId: 4 },
    cardId: "enemy",
    name: "enemy-elsewhere",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "bf-2" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: true,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(
    matchesTriggerObject({ states: "stunned", sameLocationAs: "source" }, elsewhere, "A"),
    true,
    "the unimplemented sameLocationAs key is ignored, not rejected"
  );
  assert.equal(
    matchesTriggerObject({ states: "stunned", location: "bf-2" }, elsewhere, "A"),
    true,
    "comparison against bf-2 is what the matcher actually evaluates"
  );
});

test("rad-036-167 Storm Raptor: the target-side source-location selector cannot replace the death-event anchor", () => {
  // RIFT-357's TargetSpec.location { kind: "source-location" } is a target
  // binding: it compares the locked target's location with the source's. A
  // trigger event object is never a target, so the death-event anchor still
  // needs its own implementation.
  const kernel = world().player("A").player("B")
    .unit("storm-raptor", { controller: "A", owner: "A", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const snapshot = kernel.getObject("storm-raptor");
  const context = bindResolveContext(kernel, { source: snapshot, controller: "A", timingPoint: "chain-item-resolve" });
  const plan = finalizeTargetPlan(context, {
    id: "storm-raptor.here",
    filter: { type: "unit", controller: "B" },
    location: { kind: "source-location" },
    selection: "all"
  }, {});
  assert.deepEqual(plan.selected, [kernel.ref("enemy-here")]);
});

test.todo(
  "Storm Raptor: 'a stunned enemy unit' completes on its own (the object-killed emission takes the pre-zone-change " +
    "snapshot and matchesTriggerObject implements the stunned predicate) - the blocker is the 'here' half below"
);

test.todo(
  "Storm Raptor: 'dies here' - the production trigger binding rejects the sameLocationAs anchor " +
    "(translateTriggerFilter/translateObjectFilter: unsupported filter field), and events/pipeline-match.ts " +
    "matchesTriggerObject has no location anchor while silently passing unknown filter keys (a stunned enemy at " +
    "another Battlefield still matches), so any wiring " +
    "would count enemy deaths anywhere on the board (053.3 / 421.1)"
);

test.todo(
  "Storm Raptor: [Deflect] expansion - RIFT-360's deflectCost planner already builds the any-Domain Power " +
    "requirement, but production statics binding fails because layerFor has no target.tax mapping; after that " +
    "mapping exists, chain/engine.ts finalize must consume TargetTaxCostAdapter's CostPlan instead of writing " +
    "mandatoryAdditional { energy: amount } (809.1.c.1)"
);
