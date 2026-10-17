import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/thousand-tailed-watcher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
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
  assert.match(program.judgeReason, /Accelerate/);
  // Re-probed 2026-10-17: the gap is the production path from the expanded
  // accelerate.cost static to CostPlan.optionalAdditional, plus the unpaid-entry
  // rewrite, not the cost planner itself.
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /describePlay/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /805\.6\.a/);
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

test("Thousand-Tailed Watcher: merged binding normalizes the own-play anchor and expands Accelerate", async () => {
  const { translateTriggerFilter, expandProgram } = await import("../../../../engine-core/dist/programs/index.js");
  const kernel = world().unit("watcher", { cardId: program.canonicalCardId }).build();
  assert.deepEqual(translateTriggerFilter(triggered.trigger.filter, "watcher", "card-played"), {
    event: "card-played", object: { objectId: "watcher" }
  });
  const expanded = expandProgram(program, kernel.getObject("watcher"));
  assert.deepEqual(expanded.expanded.map(ability => ability.kind), ["static", "replacement"]);
  assert.equal(expanded.expanded[0].effect.kind, "accelerate.cost");
  assert.deepEqual(expanded.expanded[0].effect.cost.payments.map(payment => payment.kind), ["energy", "power"]);
  assert.equal(expanded.expanded[1].with[0].op, "effect.ready");
});

test("Thousand-Tailed Watcher golden: the merged play trigger debuffs enemy units through the real pipeline", () => {
  // Executed end to end through the production trigger registration and the
  // real ChainEngine: the authored body is not re-staged here, the card-played
  // wave itself drives it. CR 478.1.c clamps per modification (3 - 3 would fall
  // below the floor of 1, so enemy-3 snapshots as -2).
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const f = fixture({ cards: [
    { id: "watcher", cardId: program.canonicalCardId, types: ["unit"], energy: 1, power: ["Mind"], might: 7 },
    { id: "enemy-3", owner: "B", controller: "B", types: ["unit"], might: 3 },
    { id: "enemy-5", owner: "B", controller: "B", types: ["unit"], might: 5 },
    { id: "ally", owner: "A", controller: "A", types: ["unit"], might: 4 }
  ] });
  for (const id of ["watcher", "enemy-3", "enemy-5", "ally"]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "board", location: { type: "base", player: f.kernel.getObject(id).owner } });
  }
  assert.deepEqual(registerProgramTriggers(registry, f.engine, f.kernel.getObject("watcher")), [
    "program:watcher:2:1"
  ]);

  f.engine.pipeline.emit({
    timingPoint: "card-played", object: f.kernel.getObject("watcher"), source: f.kernel.getObject("watcher"),
    player: "A", fromZone: "hand"
  });
  assert.equal(f.engine.items.length, 1);
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.items.length, 0);

  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("enemy-3")).might, 1);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("enemy-5")).might, 2);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("ally")).might, 4);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("watcher")).might, 7);
  // 355.10.d: the enemy set was selected by characteristics, so no
  // became-target timing point may appear for it.
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "became-target"), false);
});

test("Thousand-Tailed Watcher boundary: the expanded accelerate.cost has no production binder (CR 805.1.b)", () => {
  // Re-probed 2026-10-17: the keyword expansion is dense (a static cost
  // declaration plus the delayed replacement), but the production static binder
  // used by attachProgramLifecycle refuses the cost declaration, so the plan can
  // never contain an accelerate component.
  const kernel = world().unit("watcher", { cardId: program.canonicalCardId }).build();
  const expanded = expandProgram(program, kernel.getObject("watcher"));
  const [costDeclaration] = expanded.expanded;
  assert.equal(costDeclaration.kind, "static");
  assert.equal(costDeclaration.effect.kind, "accelerate.cost");

  const f = fixture({ cards: [{ id: "watcher", cardId: program.canonicalCardId, types: ["unit"], energy: 1, power: ["Mind"], might: 3 }] });
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(costDeclaration, f.kernel.getObject("watcher")),
    (error) => error.code === "judge-required" && /accelerate\.cost/.test(error.message) && /no layer mapping/.test(error.message)
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("Thousand-Tailed Watcher boundary: describePlay forwards no optional additional cost, so Finalize never offers Accelerate (CR 805.2)", () => {
  // The play draft carries only the ability's own cost field; the expanded
  // static declaration is not consulted, so a ChainItem never receives a
  // CostPlan and its selectedAdditional stays empty.
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const f = fixture({ cards: [{ id: "watcher", cardId: program.canonicalCardId, types: ["unit"], energy: 1, power: ["Mind"], might: 3 }] });
  f.kernel.addPlayer("A", { power: ["Mind"] });
  binding.attachLifecycle(f.engine, () => {});
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("watcher"), to: "chain" });
  f.engine.advance();
  const draft = binding.describePlay({ type: "play", object: f.kernel.ref("watcher"), player: "A" }, f.kernel.getObject("watcher"));
  assert.equal(draft.cost, undefined);
});

test("Thousand-Tailed Watcher boundary: the delayed enter-ready replacement readies an UNPAID unit, so it cannot be bound as written (CR 805.2.b / 805.6.a)", () => {
  // Re-probed 2026-10-17: binding the expanded replacement straight to the
  // pipeline makes the unit enter ready although no Accelerate fee was ever
  // collected. That is exactly why 805.2.b's "only after paying" decision has to
  // exist before this shape can ship; the assertion is the wrong behaviour, not
  // a licence to ship it.
  const f = fixture({ cards: [{ id: "watcher", cardId: program.canonicalCardId, types: ["unit"], energy: 1, power: ["Mind"], might: 3 }] });
  const kernel = world().unit("watcher", { cardId: program.canonicalCardId }).build();
  const [, replacement] = expandProgram(program, kernel.getObject("watcher")).expanded;
  createEngineStaticBinder(f.engine).bindReplacement(replacement, f.kernel.getObject("watcher"));
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("watcher"), to: "chain" });
  f.engine.advance();
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("watcher"), to: "board", location: { type: "base", player: "A" } });
  assert.equal(f.kernel.getObject("watcher").zone, "board");
  assert.equal(f.kernel.getObject("watcher").exhausted, false, "unpaid Accelerate must not ready the unit");
  // Control: a unit without any Accelerate declaration goes through the very
  // same ChainEngine resolve path and really does enter exhausted (CR 359.2.c),
  // so the false above is the replacement's doing rather than a permissive host.
  const control = { canonicalCardId: "card.hash-ogn-watcher-control", rulesetVersion: "core-1.5", status: "executable",
    sourceText: "[test control] no Accelerate", abilities: [{ kind: "play", body: [] }] };
  const controlBinding = createProgramBinding({ cardPrograms: [control] });
  const cf = fixture({ cards: [{ id: "control", cardId: control.canonicalCardId, types: ["unit"], energy: 1, power: ["Mind"], might: 3 }] });
  cf.kernel.addPlayer("A", { power: ["Mind"] });
  cf.engine.commit({ type: "move-zone", object: cf.kernel.ref("control"), to: "chain" });
  cf.engine.advance();
  cf.engine.execute(controlBinding.describePlay({ type: "play", object: cf.kernel.ref("control"), player: "A" }, cf.kernel.getObject("control")));
  resolveAll(cf.engine);
  assert.equal(cf.kernel.getObject("control").zone, "board");
  assert.equal(cf.kernel.getObject("control").exhausted, true);
});
