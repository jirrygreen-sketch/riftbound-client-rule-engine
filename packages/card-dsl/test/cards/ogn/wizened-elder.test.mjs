import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wizened-elder.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL =
  "card.hash-16335e499c8dc3283d678e27bfe613e02ef16a6babfe209f953b1959c52fd375";
const SOURCE_TEXT = "While I'm buffed, I have an additional +1 :rb_might:.";
const literal = value => ({ kind: "constant", value });

const [staticAbility] = program.abilities;

/**
 * The equivalent instruction path uses the merged continuous.might op with the
 * card's amount and the 702.2.a buffed predicate. The kernel is bound to the
 * elder so "I" resolves to the ability host, and the production layer matcher
 * evaluates the characteristics predicate.
 */
function elderKernel({ buffs }) {
  const base = world()
    .unit("wizened-elder", { might: 4, buffs, owner: "A", controller: "A" })
    .unit("plain-ally", { might: 4, buffs: 0, owner: "A", controller: "A" })
    .build();
  return bindResolveContext(base, {
    source: base.getObject("wizened-elder"),
    sourceSnapshot: base.getObject("wizened-elder"),
    query: filter => base.objects.filter(object => matchesObjectFilter(filter, object))
  });
}

const grantInstruction = {
  id: "wizened-elder.additional-might",
  op: "continuous.might",
  args: {
    amount: staticAbility.effect.amount,
    duration: literal("permanent"),
    // "I": the ability host; the production matcher re-checks the buffed
    // predicate on every layer evaluation.
    objects: literal({
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        objectId: "wizened-elder",
        characteristics: { buffs: 1 }
      }
    })
  }
};

test("ogn-065-298 Wizened Elder: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ogn-065-298 Wizened Elder: identity, ruleset, executable status and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-065-298 Wizened Elder: the additional +1 is a static arithmetic effect", () => {
  // 364.3/364.3.a: Conditional Passive Ability; 365.1: active while on Board.
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.deepEqual(staticAbility.effect.amount, literal(1));
});

test("ogn-065-298 Wizened Elder: the condition is the 702.2.a buffed predicate", () => {
  // 702.2.a: a unit is Buffed for as long as the buff remains on it. 702.3
  // caps a unit at one Buff, so characteristics { buffs: 1 } is exact.
  assert.deepEqual(staticAbility.effect.filter, {
    object: "self",
    type: "unit",
    zone: "board",
    characteristics: { buffs: 1 }
  });
  // The printed +1 is a separate Might increase on top of the Buff's own +1
  // (703), never a second Buff counter (702.3).
  assert.equal("buffs" in staticAbility.effect, false);
});

test("ogn-065-298 Wizened Elder: the production static binder keeps the host and Buff predicate", () => {
  const kernel = world()
    .unit("wizened-elder", {
      cardId: CANONICAL,
      owner: "A",
      controller: "A",
      zone: "board",
      might: 4,
      buffs: 1
    })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("unexpected choice"); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const registry = new ProgramRegistry([program]);
  const lifecycle = attachProgramLifecycle(engine, registry);
  try {
    const source = kernel.getObject("wizened-elder");
    engine.pipeline.emit({ timingPoint: "object-enters-board", object: source });
    assert.equal(engine.layers.evaluate(kernel.ref("wizened-elder")).might, 6);

    const spend = runInstruction(
      buff,
      { mode: "spend", target: "wizened-elder" },
      { world: kernel, targets: { "wizened-elder": [kernel.ref("wizened-elder")] } }
    );
    assert.equal(spend.result.status, "executed");
    engine.layers.setObjects(kernel.objects);
    assert.equal(engine.layers.evaluate(kernel.ref("wizened-elder")).might, 4);
  } finally {
    lifecycle.detach();
  }
});

test("ogn-065-298 Wizened Elder golden: a buffed unit really gets the additional +1 Might", () => {
  const kernel = elderKernel({ buffs: 1 });
  const outcome = runAbilityBody([grantInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.affected.objects, [
    { id: "wizened-elder", zoneEntryId: 1 }
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 1);

  // CR 703 gives the Buff its own +1 and the printed ability adds another +1,
  // so the effective Might is printed 4 + Buff 1 + ability 1 = 6.
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("wizened-elder")).might, 6);
  assert.equal(layers.evaluate(kernel.ref("plain-ally")).might, 4);
});

test("ogn-065-298 Wizened Elder golden: without a Buff the +1 registers nothing (702.2.a)", () => {
  const kernel = elderKernel({ buffs: 0 });
  const outcome = runAbilityBody([grantInstruction], kernel);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.continuousEffects.length, 0);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("wizened-elder")).might, 4);
});

test("ogn-065-298 Wizened Elder golden: the predicate tracks Buff gain and spend (while, 364.3)", () => {
  // The binder-shaped registration (per-object identity filter plus the merged
  // characteristics predicate) re-evaluates on every layer pass, so the +1
  // appears and disappears with the Buff.
  const kernel = world().unit("wizened-elder", { might: 4, buffs: 1 }).build();
  const registration = {
    effect: {
      id: "wizened-elder.live",
      layer: "arithmetic",
      source: kernel.ref("wizened-elder"),
      filter: {
        objectId: "wizened-elder",
        zone: "board",
        zoneEntryId: 1,
        characteristics: { buffs: 1 }
      },
      effect: { kind: "continuous.might", amount: 1 }
    },
    duration: { type: "permanent" }
  };
  const layers = createLayerEngine(kernel.objects, [registration]);
  assert.equal(layers.evaluate(kernel.ref("wizened-elder")).might, 6);

  // Spending the Buff through the real primitive closes the gate (702.2.b).
  const spend = runInstruction(
    buff,
    { mode: "spend", target: "wizened-elder" },
    { world: kernel, targets: { "wizened-elder": [kernel.ref("wizened-elder")] } }
  );
  assert.equal(spend.result.status, "executed");
  layers.setObjects(kernel.objects);
  assert.equal(layers.evaluate(kernel.ref("wizened-elder")).might, 4);

  // Buffing again re-opens it (702.2.a).
  const grant = runInstruction(
    buff,
    { mode: "buff", target: "wizened-elder" },
    { world: kernel, targets: { "wizened-elder": [kernel.ref("wizened-elder")] } }
  );
  assert.equal(grant.result.status, "executed");
  layers.setObjects(kernel.objects);
  assert.equal(layers.evaluate(kernel.ref("wizened-elder")).might, 6);
});
