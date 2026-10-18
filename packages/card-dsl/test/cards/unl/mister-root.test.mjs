import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mister-root.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-2f32c6395b7dc0bd6975c6b7bb280cc4c1c63da74289ee612c41dd38e92b8074";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "When I move to a battlefield, gain 2 XP.";

const [keyword, triggered] = program.abilities;
const [gainXp] = triggered.body;

test("unl-127-219 Mister Root: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-127-219 Mister Root: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /move-location/);
  assert.match(program.judgeReason, /449\.1/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /validateTriggerSpec/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
});

test("unl-127-219 Mister Root: unvalued Accelerate keyword plus the move-to-battlefield trigger", () => {
  assert.equal(program.abilities.length, 2);
  // 805.1.b: the printed cost is fixed at [1][C], so the keyword carries no value.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  // 421.1 / 449.1 / 449.2 / 458: a Move, not a Recall.
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
});

test("unl-127-219 Mister Root: the effect is a plain gain 2 XP (730.1 / 190.6.d)", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(gainXp.id, "mister-root.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-127-219 Mister Root: the declared keyword id matches the merged Accelerate KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated keyword registry");
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.ok(registered.ruleRefs.includes("805.1.b"));
});

test("unl-127-219 Mister Root golden: the trigger body really gains 2 XP for the ability controller", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["mister-root.gain-xp", "executed"]
  ]);
  // 730.1 / 733: XP is marked on the gaining player and has no cap.
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(outcome.linkedValues["mister-root.gain-xp.gained"], 2);
  assert.equal(outcome.linkedValues["mister-root.gain-xp.gainedTo"], "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-127-219 Mister Root golden: a replaced gain-xp is reported as negated, never as XP", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
});

test.todo(
  "unl-127-219 Mister Root: [Accelerate] (CR 805.1.b additional cost + 805.6 enter-ready replacement) — the " +
    "KeywordDef and replacement binding are merged, but the additional-cost Finalize consumer and the pay-before-entry " +
    "delay are still missing"
);
test.todo(
  "unl-127-219 Mister Root: subscribe 'When I move to a battlefield' for real (CR 449.1/449.2 targets and " +
    "458/458.1 Recall exclusion) — the closed EVENT_PATTERN_TYPES has no object-moved entry (validateTriggerSpec rejects " +
    "every spelling) and action-adapter.ts leaves fromZone/toZone unset on move-location"
);

test("unl-127-219 Mister Root: the move trigger cannot be registered through the merged closed vocabulary", async () => {
  // 421.1 / 449.1/449.2 / 458/458.1 need a real Move trigger, but the closed
  // EVENT_PATTERN_TYPES vocabulary has no object-moved entry: the card's own
  // filter is rejected and so is every equivalent spelling, so this cannot be
  // approximated by subscribing to a neighbouring event.
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const { validateTriggerSpec, EVENT_PATTERN_TYPES } = await import("../../../../engine-core/dist/events/trigger-spec.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

  assert.equal(EVENT_PATTERN_TYPES.includes("object-moved"), false);
  const spec = validateTriggerSpec({ at: "object-moved", filter: triggered.trigger.filter });
  assert.equal(spec.ok, false);
  assert.ok(spec.issues.some(issue => issue.code === "invalid-event-type"));
  // The nested self anchor is unrepresentable too: the closed EventPattern has
  // no filter field.
  assert.ok(spec.issues.some(issue => issue.code === "unknown-field"));

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "root", cardId: CARD_ID, types: ["unit"], energy: 2, power: [], might: 1 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("root"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = { ...f.kernel.getObject("root"), cardId: CARD_ID, zone: "board" };
  // registerTrigger validates the spec and throws before any subscription is
  // stored; the message lists the closed vocabulary the card's event is absent
  // from.
  assert.throws(
    () => binding.registerProgramTriggers(f.engine, source),
    /trigger\.filter\.event: 值必须属于 zone-entered/
  );
  assert.equal(f.engine.pipeline.triggers.size ?? 0, 0);
});

test("unl-127-219 Mister Root golden: a real move-location carries no from/to zone payload", async () => {
  // events/action-adapter.ts maps move-location onto the object-moved timing
  // point but publishes neither fromZone nor toZone (timing-points.ts declares
  // them as payloadFields), so 449.1/449.2 cannot be evaluated.
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const f = fixture({ cards: [{ id: "root", types: ["unit"], energy: 2, power: [], might: 1 }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("root"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  f.engine.commit({
    type: "move-location",
    object: f.kernel.ref("root"),
    to: { type: "battlefield", id: "bf-2" }
  });
  const [moved] = f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved");
  assert.ok(moved, "move-location must publish the object-moved timing point");
  assert.equal(moved.fromZone, undefined);
  assert.equal(moved.toZone, undefined);
  assert.equal(f.kernel.getObject("root").location.id, "bf-2");
});

test("unl-127-219 Mister Root: the Accelerate static declaration cannot enter the production layer path", async () => {
  // 805.1.b: the merged KeywordDef publishes a static accelerate.cost
  // declaration, but programs/statics.ts's layerFor has no mapping for it, and
  // the play draft the merged describePlay builds carries no cost at all.
  const { createProgramBinding, createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "root", cardId: CARD_ID, types: ["unit"], energy: 2, power: [], might: 1 }],
    describePlay: binding.describePlay
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("root"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = { ...f.kernel.getObject("root"), cardId: CARD_ID, zone: "board" };
  const [accelerate] = binding.inspect(source).abilities.filter(ability => ability.kind === "static");
  assert.equal(accelerate.effect.kind, "accelerate.cost");
  assert.equal(accelerate.effect.cost.optional, true);
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(accelerate, source),
    /Static ability kind accelerate\.cost has no layer mapping/
  );

  const draft = binding.describePlay(
    { type: "play", player: "A", object: f.kernel.ref("root") },
    f.kernel.getObject("root")
  );
  assert.equal(draft.cost, undefined);
  assert.equal(draft.body.length, 0);
});
