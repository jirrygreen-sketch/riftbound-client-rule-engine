import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/zephyr-sage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6";
const SOURCE_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";
const HOST = { canonicalCardId: CANONICAL_ID };

/** A real ChainEngine harness used for the production lifecycle negative proof.
 * The canonical combat snapshot exposes combatRole; this card's Shield
 * expansion still reads designation, so the positive combat case remains
 * judge-required until that mapping exists in production.
 */
function fixture() {
  let combat = null;
  const kernel = world()
    .player("A", { energy: 20, power: ["Calm"] })
    .player("B", { energy: 20 })
    .hand("zephyr", { cardId: CANONICAL_ID, types: ["unit"], energy: 6, power: ["Calm"], might: 6 })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => combat === null
      ? kernel.objects
      : kernel.objects.map(object => object.ref.id === "zephyr"
        ? { ...object, combatRole: combat }
        : object),
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
  return { engine, kernel, setCombat: value => { combat = value; } };
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

test("ogs-005-024 Zephyr Sage regression: a real combatRole snapshot remains unmapped and grants no Shield bonus", () => {
  const f = fixture();
  play(f);
  const source = f.kernel.getObject("zephyr");
  const [ability] = shield.expand({ host: HOST });
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);

  f.setCombat("defender");
  f.engine.layers.setObjects(f.engine.pipeline.host.objects());
  const ref = f.kernel.ref("zephyr");
  const snapshot = f.engine.layers.snapshot(ref);
  assert.equal(snapshot.combatRole, "defender");
  assert.equal(snapshot.designation, undefined);
  const [entry] = f.engine.layers.registry.list();
  assert.equal(entry.effect.effect.condition(snapshot), false);
  assert.equal(f.engine.layers.evaluate(ref).might, 6);
  handle.unbind();
});

test.todo(
  "ogs-005-024 Zephyr Sage: the production combat snapshot's combatRole must satisfy " +
    "Shield's Defender designation condition and grant exactly +1 Might (CR 814.1.c/814.1.d.1) — " +
    "blocked because the merged Shield expansion reads designation while ObjectSnapshot exposes " +
    "combatRole; a positive test must use the production snapshot without manually injecting designation"
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
