import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/zephyr-sage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6";
const SOURCE_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";
const HOST = { canonicalCardId: CANONICAL_ID };

/** A real ChainEngine harness whose object read backs onto the layer snapshot.
 *
 * The combat switch stands in for the canonical combat designation bit: the
 * production condition resolves objects through this host view, so setting it
 * to "defender"/"attacker" models the designation the board grants during
 * combat without touching the card IR or the generated condition closure.
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
        ? { ...object, designation: combat, combatRole: combat }
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

test("ogs-005-024 Zephyr Sage: program passes validateCardProgram as executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-005-024 Zephyr Sage: identity, verbatim sourceText and the merged registry entry", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  // The printed Shield keyword is fully executable through the merged keyword
  // expansion, production static binding and layer engine (see the goldens below).
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
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

test("ogs-005-024 Zephyr Sage golden: the production lifecycle binds the Shield static to the layers", () => {
  const f = fixture();
  // A real ProgramRegistry over this card's executable program; the lifecycle
  // is the merged RIFT-257 path that expands the keyword and binds statics.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const handle = binding.attachLifecycle(f.engine);

  play(f);
  const onBoard = f.kernel.getObject("zephyr");
  assert.equal(onBoard.zone, "board");
  assert.equal(onBoard.might, 6);

  // The expanded static is registered exactly once in the layer registry.
  const engine = f.engine;
  const entries = engine.layers.registry.list();
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.effect.layer, "arithmetic");
  assert.equal(entry.effect.effect.kind, "continuous.might");
  assert.equal(entry.effect.effect.amount, 1);
  assert.equal(typeof entry.effect.effect.condition, "function");
  assert.deepEqual(entry.effect.filter, {
    objectId: "zephyr",
    zone: "board",
    zoneEntryId: onBoard.ref.zoneEntryId
  });

  // CR 814.1.d.1 fail-closed: the production condition evaluates against the
  // layer snapshot, which carries no designation characteristic outside the
  // Defender designation, so no +1 is granted during this plain entry.
  assert.equal(engine.layers.evaluate(f.kernel.ref("zephyr")).might, 6);

  handle.detach();
  assert.equal(engine.layers.registry.list().length, 0);
});

test("ogs-005-024 Zephyr Sage golden: the Defender condition grants exactly +1 while it holds (CR 814.1.c/814.1.d.1)", () => {
  // The merged production path is the lifecycle above; this scenario evaluates
  // the same condition closure with the combat designation attached to the
  // evaluated snapshot, standing in for the combat designation bit that the
  // canonical engine owns. The bridge changes only the designation reading,
  // never the card IR or the condition.
  const f = fixture();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const lifecycle = binding.attachLifecycle(f.engine);
  play(f);

  const engine = f.engine;
  const [entry] = engine.layers.registry.list();
  const condition = entry.effect.effect.condition;
  assert.equal(typeof condition, "function");

  const ref = f.kernel.ref("zephyr");

  const designate = (objects, value) => objects.map(
    object => object.ref.id === "zephyr"
      ? { ...object, designation: value, combatRole: value }
      : object
  );

  // CR 814.1.d.1 fail-closed before the Defender designation is acquired.
  // The production closure resolves objects through the ability environment,
  // so each scenario reads the condition through that same production path
  // and then lets the arithmetic layer apply to the matching designation view.
  const conditionThroughProductionPath = () => {
    const snapshot = engine.layers.snapshot(ref);
    assert.ok(snapshot, "the unit must be visible to the layer engine");
    return condition(snapshot);
  };
  assert.equal(conditionThroughProductionPath(), false);
  assert.equal(engine.layers.evaluate(ref).might, 6);

  // The arithmetic layer grants the +1 while the Defender designation holds.
  f.setCombat("defender");
  assert.equal(conditionThroughProductionPath(), true);
  engine.layers.setObjects(designate(f.kernel.objects, "defender"));
  assert.equal(engine.layers.evaluate(ref).might, 7);

  // An attacker designation is not the Defender designation.
  f.setCombat("attacker");
  assert.equal(conditionThroughProductionPath(), false);
  engine.layers.setObjects(designate(f.kernel.objects, "attacker"));
  assert.equal(engine.layers.evaluate(ref).might, 6);

  // The printed 6 Might returns once the designation is gone.
  f.setCombat(null);
  assert.equal(conditionThroughProductionPath(), false);
  engine.layers.setObjects(f.kernel.objects);
  assert.equal(engine.layers.evaluate(ref).might, 6);
  lifecycle.detach();
});

test("ogs-005-024 Zephyr Sage: the lifecycle's expanded keyword sums repeated Shield sources (CR 814.2)", () => {
  const f = fixture();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const handle = binding.attachLifecycle(f.engine);
  play(f);
  const engine = f.engine;
  const [entry] = engine.layers.registry.list();
  const expanded = binding.inspect(f.kernel.getObject("zephyr")).abilities.filter(
    ability => ability.kind === "static"
  );
  // The printed keyword plus the expanded static: expansion happens once with
  // the summed value, so the registry holds one +1 entry, not two.
  assert.equal(expanded.length, 1);
  assert.equal(entry.effect.effect.amount, 1);
  handle.detach();
});
