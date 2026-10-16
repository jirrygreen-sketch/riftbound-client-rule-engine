import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/thousand-tailed-watcher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [accelerate, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Thousand-Tailed Watcher program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Thousand-Tailed Watcher identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-0c45b29063c3531b9891e06fa06538c7ff50e7ecd9a1f6f1147e18ee33176c81"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /478\.1\.c/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
      "When you play me, give enemy units -3 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Accelerate] keyword plus the play-effect debuff", () => {
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  // 383.4.a："When you play me" 是 Play Effect（打出触发）。
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  const [debuff] = triggered.body;
  assert.equal(debuff.id, "watcher.debuff-enemy-units");
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, c(-3));
  assert.deepEqual(debuff.args.duration, c("this-turn"));
  assert.deepEqual(debuff.args.minimum, c(1));
  // 355.10.d："enemy units" 是按特征选择的集合，不是目标。
  assert.equal(debuff.targets, undefined);
  assert.equal(debuff.picks, undefined);
  assert.deepEqual(debuff.args.objects, c({
    kind: "query",
    filter: { zone: "board", type: "unit", controller: "opponent" }
  }));
});

test("golden: the debuff registers -3 Might this turn on the enemy units only, with the printed floor of 1", () => {
  const base = world()
    .unit("watcher", { owner: "A", controller: "A", might: 7 })
    .unit("enemy-3", { owner: "B", controller: "B", might: 3 })
    .unit("enemy-5", { owner: "B", controller: "B", might: 5 })
    .unit("ally", { owner: "A", controller: "A", might: 4 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("watcher") });

  // The chain's query wrapper binds the controller/opponent placeholders
  // (chain/engine.ts) and asks the layers filter; bind that production query
  // here rather than editing the card data.
  const chainController = kernel.controller;
  const query = (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = chainController;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === chainController) return false;
      }
      const resolved = { ...normalized };
      if (resolved.controller === "opponent") resolved.controller = "any";
      return matchesObjectFilter(resolved, object);
    });
  };

  const outcome = runAbilityBody(triggered.body, bindResolveContext(kernel, { query }));

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 355.10.d: the enemy set is selected by characteristics; no target/pick was
  // declared, and only the two enemy units are affected.
  assert.deepEqual(outcome.linkedValues["watcher.debuff-enemy-units.affected"].objects.map(ref => ref.id), [
    "enemy-3",
    "enemy-5"
  ]);
  assert.equal(kernel.continuousEffects.length, 2);
  assert.ok(kernel.continuousEffects.every(entry => entry.duration.type === "end-of-turn"));
  assert.ok(kernel.continuousEffects.every(entry => entry.effect.layer === "arithmetic"));
  assert.ok(kernel.continuousEffects.every(entry => entry.effect.effect.minimum === 1));
  // CR 478.1.c: the printed floor is applied per modification, so the amount
  // snapshots as -3 where 3 damage is available and clamps to -2 for the unit
  // whose Might is already 3 (3 - 3 would fall below the floor of 1).
  assert.deepEqual(
    kernel.continuousEffects.map(entry => [entry.effect.filter.objectId, entry.effect.effect.amount]),
    [
      ["enemy-3", -2],
      ["enemy-5", -3]
    ]
  );

  // The layers engine computes the merged Might: 3 - 3 clamps at the printed
  // floor of 1 (478.1.c), 5 - 3 = 2, and neither the ally nor the watcher moves.
  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("enemy-3")).might, 1);
  assert.equal(engine.evaluate(kernel.ref("enemy-5")).might, 2);
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 4);
  assert.equal(engine.evaluate(kernel.ref("watcher")).might, 7);

  // "this turn" expires at the end of the turn, not at combat end.
  assert.equal(engine.evaluate(kernel.ref("enemy-3")).might, 1);
  engine.advance({ id: "turn-end" });
  assert.equal(engine.evaluate(kernel.ref("enemy-3")).might, 3);
  assert.equal(engine.evaluate(kernel.ref("enemy-5")).might, 5);
});

test.todo(
  "Thousand-Tailed Watcher: bind the card-played CardProgram trigger through the complete program " +
    "adapter (RIFT-257), including the filter { role: 'self' } self anchor"
);

test.todo(
  "Thousand-Tailed Watcher: [Accelerate] expansion — consume effects/keywords/Accelerate.ts " +
    "(optional {1 energy + 1 Mind power} additional cost, RIFT-261, plus the 805.6 enter-ready " +
    "replacement) through the production program binding"
);
