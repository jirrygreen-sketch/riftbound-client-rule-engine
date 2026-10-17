import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import spoilsOfWar from "../../../dist/cards/ogn/spoils-of-war.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const [speed, costModification, play] = spoilsOfWar.abilities;
const [drawInstruction] = play.body;

test("Spoils of War program is structurally valid and judge-required", () => {
  const result = validateCardProgram(spoilsOfWar);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(spoilsOfWar.status, "judge-required");
  assert.match(spoilsOfWar.judgeReason, /continuous\.cost-modification/);
  assert.match(spoilsOfWar.judgeReason, /history|历史/);
  assert.match(spoilsOfWar.judgeReason, /Finalize/);
  // 复核后写入的真实缺口证据：图层映射与生产运行时的占位实现。
  assert.match(spoilsOfWar.judgeReason, /has no layer mapping/);
  assert.match(spoilsOfWar.judgeReason, /engine-runtime\/host\.ts/);
  assert.equal(spoilsOfWar.rulesetVersion, "core-1.5");
  assert.equal(
    spoilsOfWar.canonicalCardId,
    "card.hash-f1f8b1ffd2a9dcbd2d052a21cda44bb88a2c34a60045e4a5b5059be0dfb97f83"
  );
  assert.equal(
    spoilsOfWar.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "If an enemy unit has died this turn, this costs :rb_energy_2: less.\n" +
      "Draw 2."
  );
});

test("Spoils of War structure: [Reaction] + Energy discount declaration + draw 2", () => {
  assert.equal(spoilsOfWar.abilities.length, 3);
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  // "this costs [2] less": a -2 Energy modification of this card's own cost,
  // floored at 0 (356.4.e/356.6).
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "continuous.cost-modification");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -2 });
  assert.deepEqual(costModification.effect.minimum, { kind: "constant", value: 0 });
  assert.equal(costModification.effect.appliesTo, "self");
  // "If an enemy unit has died this turn": the intended Finalize-time history
  // predicate, in the contract 3.8 HistoryQuery shape (objectFilter).
  assert.deepEqual(costModification.effect.when, {
    kind: "constant",
    value: {
      history: {
        scope: "turn",
        action: "kill",
        objectFilter: { type: "unit", controller: "opponent" }
      }
    }
  });

  // "Draw 2." is the merged effect.draw: a separate sentence with no link to
  // the discount, so it resolves whenever the spell resolves.
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("Spoils of War golden: Draw 2 moves the top two cards to hand", () => {
  const kernel = world().deck(["top-card", "middle-card", "bottom-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  // CR 414.1.a: drawn from the top of the Main Deck, in order.
  assert.deepEqual(
    kernel.zone("A", "hand").map((ref) => ref.id),
    ["top-card", "middle-card"]
  );
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.linked, { drawn: 2, drawnTo: "A" });
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("Spoils of War golden: a short deck draws as many as possible (CR 414.4)", () => {
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Spoils of War golden: an empty deck draws nothing but still resolves", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  // CR 414.4: the draw action still commits with an actual count of 0.
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("Spoils of War: the production static binder rejects the discount's ability kind (current gap)", () => {
  // programs/statics.ts layerFor 对 continuous.cost-modification 没有映射；用真实
  // attachLifecycle 证明静态折扣无法安装到 Finalize 的费用计划。
  // 以 executable 形态提交本体，才能走到 static binder（judge-required 会在 registry
  // 查找时先抛出 judgeReason，够不到图层映射这一步）。
  const forged = { ...spoilsOfWar, status: "executable" };
  delete forged.judgeReason;
  assert.equal(validateCardProgram(forged).ok, true);
  const state = fixture({
    cards: [{ id: "spoils", cardId: spoilsOfWar.canonicalCardId, types: ["spell"] }]
  });
  const errors = [];
  const binding = createProgramBinding({ cardPrograms: [forged] });
  binding.attachLifecycle(state.engine, (error) => errors.push(String(error && error.message)));

  // attachProgramLifecycle binds static abilities on Board entry only
  // (programs/lifecycle.ts), so a Spell's static ability never registers while
  // the card sits on the Chain where its discount would have to apply.
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("spoils"), to: "chain" });
  assert.deepEqual(errors, []);
  assert.deepEqual(state.engine.layers.registry.list(), []);

  // And even when the binder is reached, the kind has no layer mapping, so the
  // -2 Energy discount still cannot install itself into a Finalize cost plan.
  state.engine.commit({
    type: "move-zone",
    object: state.kernel.ref("spoils"),
    to: "board",
    location: { type: "base", player: "A" }
  });
  assert.equal(
    errors.includes("Static ability kind continuous.cost-modification has no layer mapping"),
    true,
    JSON.stringify(errors)
  );
  assert.deepEqual(state.engine.layers.registry.list(), []);
});

test("Spoils of War: the test kernel evaluates the declared history predicate, the production runtime cannot", () => {
  // 参照内核按可求值历史谓词计数（本卡声明的 when/history 形状的语义目标）：
  const kernel = world()
    .unit("fallen-enemy", { owner: "B", controller: "B", might: 2, zone: "board" })
    .unit("fallen-ally", { owner: "A", controller: "A", might: 2, zone: "board" })
    .build();
  kernel.perform({ type: "kill", object: kernel.ref("fallen-enemy") });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fallen-ally") });

  assert.equal(context.history({ action: "kill", scope: "turn" }), 1);
  // Object filters are compared against the exact recorded snapshot, so an
  // absolute opponent id works...
  assert.equal(
    context.history({
      action: "kill",
      scope: "turn",
      objectFilter: { type: "unit", controller: "B" }
    }),
    1
  );
  // ...but the relative "opponent"/"self" spellings the card's printed
  // condition needs are not resolved by any merged evaluator: they match
  // nothing. That is exactly the missing relative-opponent history adapter.
  for (const relative of ["opponent", "self"]) {
    assert.equal(
      context.history({
        action: "kill",
        scope: "turn",
        objectFilter: { type: "unit", controller: relative }
      }),
      0
    );
  }

  // 但服务端运行时把这两半都写成占位实现，所以同一条件在生产路径上无法门控折扣。
  // （sourceText 的 when/history 形状保持可审查，等求值器合入。）
  assert.deepEqual(spoilsOfWar.abilities[1].effect.when, {
    kind: "constant",
    value: {
      history: {
        scope: "turn",
        action: "kill",
        objectFilter: { type: "unit", controller: "opponent" }
      }
    }
  });
});

test.todo(
  "Spoils of War cast: pays the discounted 4-or-2 Energy plus 1 Body power and [Reaction] " +
    "closed-state timing is enforced after the Finalize discount is consumed"
);

