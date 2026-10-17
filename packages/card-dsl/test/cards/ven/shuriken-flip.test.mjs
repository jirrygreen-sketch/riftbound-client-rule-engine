import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shuriken-flip.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/candidates.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/ref.js";
import { finalizeTargetPlan, queryTargetCandidates, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-eead7ad848e8aa64f2ca544f7174c4bc3764b8eb661c26cfd050804e8ce278e5";
const SOURCE_TEXT =
  "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n" +
  "[Flow] :rb_energy_3::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)";
const ENEMY_ID = "shuriken-flip.enemy-unit";
const FRIENDLY_ID = "shuriken-flip.friendly-unit";
const DESTINATION_ID = "shuriken-flip.move-unit/shuriken-flip.destination";

const [flowKeyword, play] = program.abilities;
const [dealTwo, moveUnit] = play.body;
const enemySpec = dealTwo.targets[0];
const friendlySpec = moveUnit.targets[0];

const stripTargets = (instruction) => {
  const { targets, ...rest } = instruction;
  return rest;
};

// The target plans consume the card's original filters. As in chain/engine.ts,
// bind relative controllers before matching the reference world's snapshots.
const targetContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => {
    const normalized = { ...filter };
    if (normalized.controller === "self" || normalized.controller === "controller") normalized.controller = kernel.controller;
    if (normalized.controller === "opponent") return object.controller !== kernel.controller && matchesObjectFilter({ ...normalized, controller: "any" }, object);
    return matchesObjectFilter(normalized, object);
  })
});

test("ven-140-166 Shuriken Flip: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-140-166 Shuriken Flip: judgeReason names only the current Flow cost gap", () => {
  assert.match(program.judgeReason, /829\.1\.c/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /KeywordAbility/);
  assert.match(program.judgeReason, /契约变更请求/);
  assert.match(program.judgeReason, /不近似实现/);
  // RIFT-357's LocationExpr is merged and must be named as landed, never as a gap.
  assert.doesNotMatch(program.judgeReason, /依赖：RIFT-357/);
  assert.doesNotMatch(program.judgeReason, /描述性目的地标记/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-140-166 Shuriken Flip: damage with an up-to-one target and an independent Move", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["shuriken-flip.deal-2", "effect.damage"],
    ["shuriken-flip.move-unit", "effect.move"]
  ]);

  // "Deal 2 to up to one enemy unit at a battlefield": 418.1.c non-combat damage,
  // 355.13 up-to allows zero targets, 355.10.b keeps "at a battlefield" a restriction.
  assert.deepEqual(dealTwo.args, {
    amount: { kind: "constant", value: 2 },
    target: { kind: "constant", value: ENEMY_ID }
  });
  assert.deepEqual(enemySpec, {
    id: ENEMY_ID,
    filter: { type: "unit", zone: "board", controller: "opponent", location: "battlefield" },
    min: 0,
    max: 1,
    selection: "up-to"
  });
  assert.equal(dealTwo.linkedTo, undefined);

  // "then move a friendly unit": 158.1 order, not a result reference. Since
  // RIFT-357 the printed no-destination Move is the merged runtime LocationExpr.
  assert.deepEqual(moveUnit.args.to, {
    kind: "location",
    value: { kind: "choose", id: "shuriken-flip.destination", filter: { type: "any" } }
  });
  assert.deepEqual(moveUnit.args.objects, { kind: "constant", value: { target: FRIENDLY_ID } });
  assert.deepEqual(moveUnit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(friendlySpec, {
    id: FRIENDLY_ID,
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(moveUnit.linkedTo, undefined);

  assert.equal(instructionDefinitionsById.get("effect.damage"), damage);
  assert.equal(instructionDefinitionsById.get("effect.move"), move);
  assert.equal(keywordDefinitionsById.has("Flow"), true);
});

test("ven-140-166 Shuriken Flip golden: the whole declared body executes against locked targets", () => {
  for (const destination of [
    { type: "base", player: "A" },
    { type: "battlefield", id: "bf-1" }
  ]) {
    const kernel = world()
      .unit("enemy", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
      .unit("friendly", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-2" } })
      .build();
    kernel.setTargets(ENEMY_ID, [kernel.ref("enemy")]);
    kernel.setTargets(FRIENDLY_ID, [kernel.ref("friendly")]);
    // The destination choice id is scoped by the interpreter's move boundary.
    kernel.setAnswers({ [DESTINATION_ID]: destination });

    const outcome = resolveChainBody(play.body, targetContext(kernel));

    assert.equal(outcome.status, "executed", JSON.stringify(destination));
    assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
      ["shuriken-flip.deal-2", "executed"],
      ["shuriken-flip.move-unit", "executed"]
    ]);
    assert.deepEqual(outcome.events.map((event) => event.action), ["damage", "move-location"]);
    assert.equal(kernel.getObject("enemy").damage, 2);
    assert.deepEqual(kernel.getObject("friendly").location, destination);
    assert.deepEqual(outcome.linkedValues["shuriken-flip.move-unit.moved"].objects, [kernel.ref("friendly")]);
    assert.equal(outcome.linkedValues["shuriken-flip.move-unit.moved"].count, 1);
  }
});

test("ven-140-166 Shuriken Flip golden: choosing zero damage targets still moves (355.13/158.1)", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(ENEMY_ID, []);
  kernel.setTargets(FRIENDLY_ID, [kernel.ref("friendly")]);
  kernel.setAnswers({ [DESTINATION_ID]: { type: "base", player: "A" } });

  const outcome = resolveChainBody(play.body, targetContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["shuriken-flip.deal-2", "ignored"],
    ["shuriken-flip.move-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.getObject("friendly").location, { type: "base", player: "A" });
});

for (const chooseEnemy of [false, true]) {
  test(`ven-140-166 Shuriken Flip golden: Finalize locks ${chooseEnemy ? 1 : 0} enemy and one friendly target`, () => {
    const kernel = world()
      .unit("enemy", { owner: "B", might: 3 })
      .base("enemy-at-base", { owner: "B", might: 3 })
      .unit("friendly", { owner: "A", might: 2 })
      .build();
    const context = targetContext(kernel);
    assert.deepEqual(queryTargetCandidates(context, enemySpec), [kernel.ref("enemy")]);
    assert.deepEqual(queryTargetCandidates(context, friendlySpec), [kernel.ref("friendly")]);
    const selectedEnemy = chooseEnemy ? [kernel.ref("enemy")] : [];
    kernel.setAnswers({
      [`target:${enemySpec.id}`]: selectedEnemy,
      [`target:${friendlySpec.id}`]: [kernel.ref("friendly")]
    });
    const enemyPlan = finalizeTargetPlan(context, enemySpec);
    const friendlyPlan = finalizeTargetPlan(context, friendlySpec);
    assert.deepEqual(enemyPlan.selected, selectedEnemy);
    assert.deepEqual(friendlyPlan.selected, [kernel.ref("friendly")]);
    assert.equal(resolveTargetPlan(context, friendlyPlan).status, "resolved");
    kernel.setTargets(enemySpec.id, resolveTargetPlan(context, enemyPlan).selected);

    const outcome = resolveChainBody([dealTwo], context);
    assert.equal(outcome.status, chooseEnemy ? "executed" : "partial");
    if (!chooseEnemy) {
      assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
    }
    assert.deepEqual(outcome.events.map(event => event.action), chooseEnemy ? ["damage"] : []);
    assert.equal(kernel.getObject("enemy").damage, chooseEnemy ? 2 : 0);
    assert.equal(kernel.getObject("enemy-at-base").damage, 0);
  });
}

test("ven-140-166 Shuriken Flip golden: Resolve rechecks the locked enemy without retargeting", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 3 })
    .unit("unchosen", { owner: "B", might: 3 })
    .build();
  const context = targetContext(kernel);
  const stale = kernel.ref("enemy");
  kernel.setAnswers({ [`target:${enemySpec.id}`]: [stale] });
  const plan = finalizeTargetPlan(context, enemySpec);
  assert.equal(kernel.perform({ type: "banish", object: stale }).status, "done");
  const resolution = resolveTargetPlan(context, plan);
  assert.equal(resolution.status, "ignored");
  assert.deepEqual(resolution.invalid, [stale]);
  kernel.setTargets(enemySpec.id, resolution.selected);

  const outcome = resolveChainBody([dealTwo], context);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("unchosen").damage, 0);
});

test("ven-140-166 Shuriken Flip golden: the merged LocationExpr resolves a real destination and its candidates", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const context = targetContext(kernel);
  // 355.4.a: the candidate set the controller picks from is a real read of the Board.
  assert.deepEqual(queryLocationCandidates(context, { type: "any" }), [
    { type: "battlefield", id: "bf-1" },
    { type: "battlefield", id: "bf-2" },
    { type: "base", player: "A" }
  ]);
  assert.deepEqual(queryLocationCandidates(context, { type: "any" }, { players: ["A", "B"] }).slice(-1), [
    { type: "base", player: "B" }
  ]);
  assert.deepEqual(queryLocationCandidates(context, { type: "battlefield" }), [
    { type: "battlefield", id: "bf-1" },
    { type: "battlefield", id: "bf-2" }
  ]);
  kernel.setAnswers({ "shuriken-flip.destination": { type: "battlefield", id: "bf-1" } });
  assert.deepEqual(
    resolveLocationSelector(moveUnit.args.to.value, { context, players: ["A", "B"], opponent: "B" }),
    { type: "battlefield", id: "bf-1" }
  );
});

test("ven-140-166 Shuriken Flip fail-closed: an out-of-band destination answer is rejected", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(ENEMY_ID, [kernel.ref("enemy")]);
  kernel.setTargets(FRIENDLY_ID, [kernel.ref("friendly")]);
  const before = kernel.getObject("friendly").location;
  // The interpreter's LocationSelector only accepts an answer drawn from the
  // real candidate set; a made-up Battlefield is rejected rather than guessed.
  kernel.setAnswers({ [DESTINATION_ID]: { type: "battlefield", id: "bf-not-on-board" } });
  assert.throws(
    () => resolveChainBody(play.body, targetContext(kernel)),
    /Invalid location choice answer/
  );
  assert.deepEqual(kernel.getObject("friendly").location, before);
});

test("ven-140-166 Shuriken Flip: the 'at a battlefield' restriction matches battlefields only", () => {
  const { controller: _controller, ...locationOnly } = enemySpec.filter;
  void _controller;
  const snapshot = (location) => ({
    ref: { id: "unit", zoneEntryId: 1 },
    cardId: "card:unit",
    name: "unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location,
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "battlefield", id: "battlefield-1" })), true);
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "base", player: "B" })), false);
  assert.equal(matchesObjectFilter(locationOnly, snapshot(null)), false);
});

test.todo(
  "ven-140-166 Shuriken Flip: play from Trash for the printed Flow cost (3 energy + 1 rainbow rune) " +
    "and banish the spell when it leaves the Chain by 829.1.b — carry params.cost into the expansion, " +
    "consume flow.cost in CostPlanInput.modifications, record the selected Flow instance, and exclude " +
    "leaves instructed by the spell itself (829.1.b.1); KeywordAbility (contract 3.1) has no params field " +
    "and programs/keywords.ts still calls def.expand({ value, host }) (contract change request)"
);

test.todo(
  "ven-140-166 Shuriken Flip: an illegal destination answer must leave the locked enemy damage committed " +
    "and report the Move as ignored without retargeting — needs the chain's real Finalize/Resolve move " +
    "lifecycle around the LocationExpr (the reference-kernel golden above throws at the argument boundary)"
);
