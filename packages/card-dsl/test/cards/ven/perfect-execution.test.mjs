import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/perfect-execution.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import flow from "../../../../engine-core/dist/effects/keywords/Flow.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-9b9d80a33d320406e0f8cd8f3d1302432ecb3631b32fe7d448639224c253e235";
const SOURCE_TEXT =
  "Ready a unit and give it [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)\n" +
  "[Flow] :rb_energy_3::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [readyInstruction, grantInstruction] = play.body;
const [unitSpec] = readyInstruction.targets;

test("ven-012-166 Perfect Execution: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-012-166 Perfect Execution: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // continuous.grant-keyword is merged; the current gaps are the Assault layer
  // consumer (designation predicate) and Flow.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /807\.1\.c/);
  assert.match(program.judgeReason, /combatRole|designation/);
  assert.match(program.judgeReason, /programs\/lifecycle\.ts/);
  assert.match(program.judgeReason, /params\.cost|3\.8\.3/);
  assert.ok(!/RIFT-9 清单|没有已合入原语/.test(program.judgeReason));
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ven-012-166 Perfect Execution: [Flow] declared, printed cost, and the Assault grant is not a Might hack", () => {
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });

  // "Ready a unit": the merged reset half (416.1-416.3).
  assert.equal(readyInstruction.id, "perfect-execution.ready-unit");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "perfect-execution.unit" }
  });
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 1 });

  // "give it [Assault 3] this turn": a keyword grant with an end-of-turn
  // duration (807.1.c / 801.3.a.2), not a +3 Might modification (807.2 sums
  // Assault instances, and Assault only applies while attacking).
  assert.equal(grantInstruction.id, "perfect-execution.grant-assault");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args, {
    keyword: { kind: "constant", value: "Assault" },
    value: { kind: "constant", value: 3 },
    duration: { kind: "constant", value: "end-of-turn" },
    objects: { kind: "constant", value: { kind: "target", id: "perfect-execution.unit" } }
  });
  // "it" refers to the same unit, so both instructions name the same target.
  assert.deepEqual(grantInstruction.targets, readyInstruction.targets);
  assert.deepEqual(unitSpec, {
    id: "perfect-execution.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-012-166 Perfect Execution golden: effect.ready readies an exhausted unit", () => {
  const kernel = world().unit("ally", { exhausted: true, might: 2 }).build();
  const locked = kernel.ref("ally");

  const run = runInstruction(
    ready,
    {
      objects: readyInstruction.args.objects,
      amount: readyInstruction.args.amount,
      linkKey: readyInstruction.args.linkKey
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.equal(run.linked.readied.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
});

test("ven-012-166 Perfect Execution golden: an already-ready unit is not readied again (416.1.b)", () => {
  const kernel = world().unit("ally", { exhausted: false }).build();
  const locked = kernel.ref("ally");

  const run = runInstruction(
    ready,
    { objects: readyInstruction.args.objects, amount: readyInstruction.args.amount },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test("ven-012-166 Perfect Execution boundary: a unit that left the Board ignores the ready (359.3.e)", () => {
  const kernel = world().unit("ally", { exhausted: true }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });

  const run = runInstruction(
    ready,
    { objects: readyInstruction.args.objects, amount: readyInstruction.args.amount },
    { world: kernel, targets: { [unitSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});

test("ven-012-166 Perfect Execution golden: the grant instruction registers an ability-layer Assault 3 (RIFT-258)", () => {
  const kernel = world().unit("ally", { owner: "A", controller: "A", might: 2 }).build();
  const locked = kernel.ref("ally");

  const run = runInstruction(
    grantKeyword,
    {
      keyword: grantInstruction.args.keyword.value,
      value: grantInstruction.args.value.value,
      duration: grantInstruction.args.duration.value,
      objects: { kind: "target", id: "perfect-execution.unit" }
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  // 478.1.a: the grant is an ability-layer registration with the printed
  // keyword value (807.1.a's Assault 3), not a Might arithmetic change.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registered] = kernel.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Assault");
  assert.equal(registered.effect.effect.keywordValue, 3);
  assert.deepEqual(registered.effect.filter.objectId, "ally");

  // The ability layer consumes the registered grant: the target really holds
  // [Assault 3]. The attacker-designation expansion of that keyword (807.1.c)
  // is the remaining judged gap and stays out of this execution.
  const layers = createLayerEngine(kernel.objects, [{ effect: registered.effect, duration: registered.duration, timestamp: 1 }]);
  const evaluated = layers.evaluate(locked);
  assert.deepEqual(evaluated.keywords.map((keyword) => [keyword.id, keyword.value]), [["Assault", 3]]);
  assert.equal(evaluated.might, 2);
  assert.equal(layers.advance({ id: "turn-end" }).length, 1);
  assert.deepEqual(layers.evaluate(locked).keywords, []);
  assert.equal(layers.evaluate(locked).might, 2);
});

test("ven-012-166 Perfect Execution golden: the original body uses its locked unit target for both effects", () => {
  // The spell is the source object; the selected unit is a different object.
  // Running the unmodified CardProgram body catches a missing `objects` target
  // selector on the grant (which would otherwise report mistargeted and register
  // no ability-layer effect).
  const kernel = world()
    .object("perfect-execution", { owner: "A", controller: "A", types: ["spell"], zone: "chain" })
    .unit("ally", { owner: "A", controller: "A", exhausted: true, might: 2 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("perfect-execution") });
  scoped.setTargets(unitSpec.id, [kernel.ref("ally")]);

  const outcome = runAbilityBody(play.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [
      ["perfect-execution.ready-unit", "executed"],
      ["perfect-execution.grant-assault", "executed"]
    ]
  );
  assert.equal(scoped.getObject("ally").exhausted, false);
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.filter.objectId, "ally");
});

test.todo(
  "ven-012-166 Perfect Execution: [Assault 3] actually adds +3 Might while the granted unit is an attacker " +
    "(807.1.c / 807.2) — keywords/Assault.ts expands to a designation-eq-attacker condition, but the " +
    "combatRole-to-designation predicate mapping is not wired into the layer consumer (dynamic keyword rebinding and the designation mapping remain unconnected)"
);

test.todo(
  "ven-012-166 Perfect Execution: play from trash for the printed Flow cost (3 energy + 1 Fury power) then " +
    "banish it — the printed cost cannot reach KeywordDef.expand (contract 3.8.3), and the Flow alternate-cost " +
    "and delayed replacement consumers are not wired"
);

// The refreshed gaps are pinned against the real production seam.
test("ven-012-166 Perfect Execution: the printed Flow cost cannot reach the keyword expansion", () => {
  // programs/keywords.ts calls def.expand({ value, host }) and KeywordAbility has
  // no params carrier (contract 3.8.3), so Flow.ts expands a flow.cost static
  // with no cost at all. Its replacement body (effect.banish) is also rejected
  // by the replacement planner, so 829.1.b.1 has no consumer path.
  const [expandedStatic, expandedReplacement] = flow.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expandedStatic.effect, {
    kind: "flow.cost",
    appliesTo: "self",
    host: "self",
    sourceZone: "trash"
  });
  const f = fixture();
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(expandedStatic, f.kernel.getObject("source")),
    error => error.code === "judge-required" && /Static ability kind flow\.cost has no layer mapping/.test(error.message)
  );
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindReplacement(expandedReplacement, f.kernel.getObject("source")),
    error => error.name === "BlockedReplacementError" && /Unsupported replacement opcode: effect\.banish/.test(error.message)
  );
});

test("ven-012-166 Perfect Execution: the granted Assault never changes Might without a designation mapping", () => {
  // Assault.ts gates the arithmetic layer on object-property "designation"; the
  // frozen ObjectSnapshot exposes only combatRole, so an attacker has no
  // readable designation and the granted +3 Might never lands (807.1.c).
  const kernel = world().unit("ally", { might: 2, combatRole: "attacker" }).build();
  const locked = kernel.ref("ally");
  const run = runInstruction(
    grantKeyword,
    {
      keyword: grantInstruction.args.keyword.value,
      value: grantInstruction.args.value.value,
      duration: grantInstruction.args.duration.value,
      objects: { kind: "target", id: "perfect-execution.unit" }
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );
  assert.equal(run.result.status, "executed");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects, { timingPoint: "combat-start" });
  const evaluated = layers.evaluate(locked);
  assert.deepEqual(evaluated.keywords.map(keyword => [keyword.id, keyword.value]), [["Assault", 3]]);
  assert.equal(evaluated.combatRole, "attacker");
  assert.equal(Object.hasOwn(evaluated, "designation"), false);
  assert.equal(evaluated.might, 2);
});
