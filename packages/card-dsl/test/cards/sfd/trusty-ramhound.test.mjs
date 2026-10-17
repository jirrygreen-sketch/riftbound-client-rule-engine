import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/trusty-ramhound.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f";
const [ability] = program.abilities;

// Card filters spell the ability controller "self"; the reference kernel matches
// filter values literally, so the production matcher runs with the resolved
// controller exactly as chain/engine.ts resolves it.
const productionContext = (kernel) => bindResolveContext(kernel, {
  source: kernel.getObject("ramhound"),
  sourceSnapshot: kernel.getObject("ramhound"),
  controller: "A",
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      (key === "controller" || key === "owner") && value === "self" ? "A" : value
    ])),
    object
  ))
});

test("sfd-159-221 Trusty Ramhound: program validates, is registered and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "While you have another unit here, I have +1 :rb_might:."
  );
});

test("sfd-159-221 Trusty Ramhound: one static arithmetic Might effect on self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 143.2.a / 475-478: Might is altered in the arithmetic layer, not via a
  // Buff counter (702).
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
});

test("sfd-159-221 Trusty Ramhound: 'another unit you control here' condition shape", () => {
  const condition = ability.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-units-here");
  // 355.9.c "another" excludes the source; 359.3.f "here" is its location. Both
  // are the contract 3.6 anchors, not descriptive keys.
  assert.deepEqual(condition.left.filter, {
    zone: "board",
    type: "unit",
    controller: "self",
    exclude: "self",
    sameLocationAs: "self"
  });
});

test("sfd-159-221 Trusty Ramhound golden: the declared gate evaluates true with another unit here", () => {
  // The interpreter's queryObjects implements both anchors, so the declared
  // condition is a real predicate: it sees the other unit at the same
  // battlefield and ignores the ally elsewhere and the enemy.
  const kernel = world().player("A")
    .unit("ramhound", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { might: 2, controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .unit("enemy-here", { might: 2, controller: "B", owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const outcome = resolveChainBody([
    { id: "probe", op: "condition.predicate", args: { condition: { kind: "constant", value: ability.condition } } }
  ], productionContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["probe.value"], true);

  // Removing the only other unit at this battlefield flips it to false; the ally
  // at the Base never counts ("here") and the enemy unit never counts ("you").
  const alone = world().player("A")
    .unit("ramhound", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { might: 2, controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .unit("enemy-here", { might: 2, controller: "B", owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const aloneOutcome = resolveChainBody([
    { id: "probe", op: "condition.predicate", args: { condition: { kind: "constant", value: ability.condition } } }
  ], productionContext(alone));
  assert.equal(aloneOutcome.linkedValues["probe.value"], false);
});

test("sfd-159-221 Trusty Ramhound golden: an instruction gated by the condition is skipped when alone", () => {
  // The same condition on a real instruction: with an ally here the gated
  // instruction executes, alone it is a skipped negation.
  const gated = { id: "gated", op: "condition.predicate", args: { condition: { kind: "constant", value: ability.condition } }, condition: ability.condition };
  const withAlly = world().player("A")
    .unit("ramhound", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const executed = resolveChainBody([gated], productionContext(withAlly));
  assert.equal(executed.results[0].result.status, "executed");
  assert.equal(executed.linkedValues["gated.value"], true);

  const alone = world().player("A")
    .unit("ramhound", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const skipped = resolveChainBody([gated], productionContext(alone));
  assert.equal(skipped.status, "partial");
  assert.equal(skipped.results[0].result.status, "negated");
  assert.equal(skipped.results[0].result.reason, "skipped");
});

test("sfd-159-221 Trusty Ramhound golden: the merged arithmetic layer applies the declared +1 Might", () => {
  // The layer engine consumes the declared continuous.might effect when a
  // caller registers it; this executes the real arithmetic path for the amount
  // this card declares.
  const kernel = world()
    .unit("ramhound", { zone: "board", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = kernel.getObject("ramhound");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "trusty-ramhound.might",
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "ramhound" },
        effect: { kind: "continuous.might", mode: "add", amount: { kind: "constant", value: 1 } }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 3);
});

test("sfd-159-221 Trusty Ramhound golden: the production static binder honors the relative condition", () => {
  const kernel = world().player("A")
    .unit("ramhound", { zone: "board", might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { zone: "board", might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { zone: "board", might: 2, controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .build();
  const decide = (request) => { throw new Error("Unexpected choice: " + request.id); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const handle = createEngineStaticBinder(engine).bindStatic(ability, kernel.getObject("ramhound"));

  assert.equal(engine.layers.evaluate(kernel.ref("ramhound")).might, 3);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-here")).might, 2);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-elsewhere")).might, 2);
  handle?.unbind();
});
