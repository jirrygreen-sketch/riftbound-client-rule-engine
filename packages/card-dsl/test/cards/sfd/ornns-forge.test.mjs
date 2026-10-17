// RIFT-643: static|| execution evidence is consolidated in ../templates/static-643.test.mjs.
// This file retains the card's identity, status, sourceText, and key IR guards.

import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornns-forge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL = "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad";
const SOURCE_TEXT =
  "While you control this battlefield, the first friendly non-token gear played each turn costs :rb_energy_1: less.";

test("ornns-forge: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ornns-forge: static cost-modify structure", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /Finalize/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  assert.equal(ability.effect.duration, "per-turn-first-play");
  assert.equal(ability.effect.appliesTo, "play-cost");
  assert.deepEqual(ability.effect.filter, { type: "gear", controller: "controller", isToken: false });
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "objects",
      filter: { object: "self", controller: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ornns-forge golden: the merged cost.modify primitive applies the authored -1 Energy to a real plan", () => {
  // The primitive itself is executable: given a locked base cost it applies the
  // declared energy reduction through the merged cost plan (356.4 / 356.4.f).
  const kernel = world().player("A", { energy: 20 }).unit("source", { might: 2 }).build();
  const bound = kernel.clone({ source: kernel.getObject("source") });
  const run = runInstruction(costModify, {
    id: "cost:ornns-forge",
    cost: { kind: "explicit", energy: { kind: "constant", value: 3 } },
    modifier: { kind: "reduce", resource: "energy", amount: { kind: "constant", value: 1 } }
  }, { world: bound });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.cost.total.energy, 2);
  assert.deepEqual(run.linked.cost.total.power, []);
});

test("ornns-forge: the production static binder refuses this cost-plan shape", () => {
  // The declared ability never reaches the Finalize cost plan. Two independent
  // rejections are verified here: this exact shape fails on its appliesTo
  // anchor, and the kind itself has no layer mapping even when the anchor is
  // omitted (see judgeReason).
  const kernel = world().player("A").player("B").unit("source", { might: 2 }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(program.abilities[0], kernel.getObject("source")),
    (error) => {
      assert.equal(error.name, "ProgramBindingError");
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /Unsupported static appliesTo "play-cost"/);
      return true;
    }
  );
  assert.throws(
    () => binder.bindStatic(
      { kind: "static", effect: { kind: "cost.modify", value: { kind: "constant", value: { energy: -1 } } } },
      kernel.getObject("source")
    ),
    (error) => {
      assert.equal(error.name, "ProgramBindingError");
      assert.match(error.message, /no layer mapping/);
      return true;
    }
  );
});

test.todo(
  "ornns-forge: card-static cost binding into Finalize plus the per-turn first-play window " +
    "(per-turn reset and history-gated expiry after the first qualifying play)"
);

