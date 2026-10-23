import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/zephyr-sage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { evaluateExtendedExpression } from "../../../../engine-core/dist/effects/interpreter/expr-ext/index.js";
import { MissingInformation } from "../../../../engine-core/dist/effects/interpreter/values.js";

const CANONICAL_ID =
  "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6";
const SOURCE_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";
const HOST = { canonicalCardId: CANONICAL_ID };

/** A real ChainEngine harness used for the production lifecycle proofs.
 * The canonical combat snapshot exposes combatRole; this card's Shield
 * expansion still reads designation, so the positive combat case remains
 * judge-required until the merged expr-ext mapping reaches the production
 * condition path (see judgeReason). `objects()` is the raw view the layer
 * engine consumes; feeding an already-layered view back would double-apply the
 * arithmetic modification, so the control test below uses this raw view.
 */
function fixture() {
  let combat = null;
  const kernel = world()
    .player("A", { energy: 20, power: ["Calm"] })
    .player("B", { energy: 20 })
    .hand("zephyr", { cardId: CANONICAL_ID, types: ["unit"], energy: 6, power: ["Calm"], might: 6 })
    .build();
  const viewObjects = () => combat === null
    ? kernel.objects
    : kernel.objects.map(object => object.ref.id === "zephyr"
      ? { ...object, combatRole: combat }
      : object);
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: viewObjects,
    perform: action => kernel.perform(action),
    choose: () => {
      throw new Error("Unexpected choice");
    },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  return { engine, kernel, setCombat: value => { combat = value; }, viewObjects };
}

function play(f, id = "zephyr", draftId = "play-zephyr") {
  f.engine.execute({
    id: draftId,
    controller: "A",
    source: f.kernel.getObject(id),
    kind: "unit",
    speed: "normal",
    body: []
  });
  f.engine.advance();
  let guard = 0;
  while (f.engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    f.engine.pass(f.engine.priority);
  }
}

test("ogs-005-024 Zephyr Sage: program passes validateCardProgram as judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-005-024 Zephyr Sage: identity, verbatim sourceText and the merged registry entry", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  // The printed Shield keyword expands through the merged KeywordDef; its
  // production combat condition remains judge-required (see the todo below).
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /designation/);
  // Re-probed 2026-10-18: the two live blockers are the merged-but-unwired
  // expr-ext dispatch boundary (RIFT-711) and the absent combat-role producer.
  assert.match(program.judgeReason, /RIFT-711/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /466\.2/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-005-024 Zephyr Sage: exactly one unvalued Shield keyword ability", () => {
  // CR 814.1.b.3: the omitted X is presumed to be 1; the default lives in
  // effects/keywords/Shield.ts, not in the card program.
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(program.abilities, [{ kind: "keyword", keyword: "shield" }]);
  assert.equal(program.abilities[0].value, undefined);
});

test("ogs-005-024 Zephyr Sage: the keyword id resolves to the merged Shield KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Shield");
  assert.ok(registered, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(registered, shield);
  assert.equal(registered.keyword, "Shield");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, true);
  // CR 814.2: Shield from several sources sums into a single value.
  assert.equal(registered.stacking, "sum");
  assert.ok(registered.ruleRefs.includes("814.1.c"));
  assert.ok(registered.ruleRefs.includes("814.1.d.1"));
});

test("ogs-005-024 Zephyr Sage: the expansion is +1 Might gated on the Defender designation", () => {
  const expansion = shield.expand({ host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  // CR 814.1.b.3 + 814.1.c: the omitted value is 1, only while the Unit holds
  // the Defender designation (814.1.d / 814.1.d.1).
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "defender" });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: shield.expand({ host: HOST }),
    sourceText: program.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("ogs-005-024 Zephyr Sage golden: the production lifecycle refuses the judge-required Shield program", () => {
  const f = fixture();
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.throws(() => binding.registry.get(CANONICAL_ID), error => {
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /combatRole/);
    return true;
  });
  const errors = [];
  const handle = binding.attachLifecycle(f.engine, (error, source) => {
    errors.push({ error, source });
  });

  play(f);
  const onBoard = f.kernel.getObject("zephyr");
  assert.equal(onBoard.zone, "board");
  assert.equal(onBoard.might, 6);

  assert.equal(f.engine.layers.registry.list().length, 0);
  assert.ok(errors.some(({ error }) => error?.code === "judge-required"));
  handle.detach();
});

test("ogs-005-024 Zephyr Sage golden: designation maps to a real Defender combatRole and grants Shield", () => {
  const f = fixture();
  play(f);
  const source = f.kernel.getObject("zephyr");
  const [ability] = shield.expand({ host: HOST });
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);

  f.setCombat("defender");
  f.engine.layers.setObjects(f.viewObjects());
  const ref = f.kernel.ref("zephyr");
  const snapshot = f.engine.layers.snapshot(ref);
  assert.equal(snapshot.combatRole, "defender");
  assert.equal(snapshot.designation, undefined);
  const [entry] = f.engine.layers.registry.list();
  assert.equal(entry.effect.effect.condition(snapshot), true);
  assert.equal(f.engine.layers.evaluate(ref).might, 7);
  handle.unbind();
});

test("ogs-005-024 Zephyr Sage golden control: pointing the expansion at combatRole grants exactly +1 while defending", () => {
  // Control for the only changed input: the Shield expansion's condition
  // property is re-pointed from the absent "designation" to the merged
  // ObjectSnapshot characteristic "combatRole" (contract 3.8). The amount (1),
  // the production static binder, the real ChainEngine pipeline and the raw
  // layer input all stay untouched. CR 814.1.c/814.1.d.1: +1 exactly while the
  // Unit holds the Defender designation, nothing while attacking or outside
  // Combat.
  const [ability] = shield.expand({ host: HOST });
  const aligned = {
    ...ability,
    condition: { ...ability.condition, left: { ...ability.condition.left, property: "combatRole" } }
  };
  const measured = {};
  for (const role of ["defender", "attacker", null]) {
    const f = fixture();
    play(f);
    const handle = createEngineStaticBinder(f.engine).bindStatic(aligned, f.kernel.getObject("zephyr"));
    f.setCombat(role);
    // The raw view is asserted first: the modification is applied by the layer
    // engine exactly once (6 -> 7), never by re-feeding a layered snapshot.
    assert.equal(f.viewObjects().find(object => object.ref.id === "zephyr").might, 6);
    f.engine.layers.setObjects(f.viewObjects());
    measured[String(role)] = f.engine.layers.evaluate(f.kernel.ref("zephyr")).might;
    assert.equal(f.kernel.getObject("zephyr").might, 6, "the kernel keeps the printed Might; only the layer view changes");
    handle.unbind();
  }
  assert.deepEqual(measured, { defender: 7, attacker: 6, null: 6 });
});

test("ogs-005-024 Zephyr Sage: designation resolves to combatRole in the production expression evaluator", () => {
  // RIFT-711 merged evaluateExtendedExpression, which maps both
  // object-property("designation") and object-designation to combatRole. Its
  // README records the integration boundary explicitly: the default
  // interpreter (effects/interpreter/expr.ts) and programs/statics.ts do not
  // dispatch the extension yet. Both evaluators run here against the same live
  // defender snapshot, so the remaining dependency is measured, not assumed.
  const kernel = world().unit("zephyr", { cardId: CANONICAL_ID, types: ["unit"], might: 6, combatRole: "defender" }).build();
  const context = kernel.clone({ source: kernel.ref("zephyr"), sourceSnapshot: kernel.getObject("zephyr") });
  const environment = {
    context,
    linked: (id, key) => context.linked(key === undefined ? id : `${id}.${key}`),
    canLookBack: () => false,
    isIgnored: () => false
  };
  const designation = { kind: "object-property", object: "self", property: "designation" };
  assert.equal(evaluateExpression(designation, environment), "defender");
  assert.equal(context.object(kernel.ref("zephyr")).combatRole, "defender");
  assert.equal(evaluateExtendedExpression(designation, environment), "defender");
  assert.equal(evaluateExtendedExpression({ kind: "object-designation", object: "self" }, environment), "defender");
});

test("ogs-005-024 Zephyr Sage golden: CR 814.2 sums a granted Shield into the declared instance", () => {
  // 814.2: Shield granted by an additional source sums into a single Shield
  // Value. expandProgram merges the declared instance with the printed keyword
  // entry and calls the KeywordDef once with the summed value, so exactly one
  // static remains for this identity.
  const kernel = world().unit("zephyr", { cardId: CANONICAL_ID, types: ["unit"], might: 6 }).build();
  const source = { ...kernel.getObject("zephyr"), keywords: [{ id: "Shield", value: 1 }] };
  const expanded = expandProgram({ ...program, status: "executable", judgeReason: undefined }, source);
  const statics = expanded.abilities.filter(ability => ability.kind === "static");
  assert.equal(statics.length, 1);
  assert.deepEqual(statics[0].effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(
    statics[0].condition.right,
    { kind: "constant", value: "defender" }
  );
});

test.todo(
  "ogs-005-024 Zephyr Sage: the production combat snapshot's combatRole must satisfy " +
    "Shield's Defender designation condition and grant exactly +1 Might (CR 814.1.c/814.1.d.1) — " +
    "blocked by two merged-yet-unwired paths, both measured by the goldens above: RIFT-711's " +
    "evaluateExtendedExpression maps designation -> combatRole but the default interpreter and " +
    "programs/statics.ts do not dispatch it, and no combat transaction produces a designation " +
    "(combat/flow.ts throws combat-start-transaction, CR 466.2 / RIFT-124 follow-up)"
);

test("ogs-005-024 Zephyr Sage: the inspected lifecycle expansion retains one summed Shield static (CR 814.2)", () => {
  const f = fixture();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const expanded = binding.inspect(f.kernel.getObject("zephyr")).abilities.filter(
    ability => ability.kind === "static"
  );
  // Expansion happens once with the summed value, while the registry still
  // refuses to execute this judge-required card until combatRole is mapped.
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].effect.amount.value, 1);
  assert.equal(f.engine.layers.registry.list().length, 0);
});
