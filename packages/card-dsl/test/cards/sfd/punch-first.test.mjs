// Golden test for Punch First (sfd-097-221).
//
// The whole printed ability executes on merged paths: the card's own body runs
// through the production chain adapter (resolveChainBody) and registers the
// arithmetic-layer Might modification through ctx.addContinuous; the merged
// layer engine then shows the +5 on the chosen unit only. The printed [Action]
// keyword and the printed 1 energy + 2 Body power cost are asserted as data.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/punch-first.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CANONICAL =
  "card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a unit +5 :rb_might: this turn.";

const [speed, play] = program.abilities;
const [buff] = play.body;
const targetSpec = buff.targets[0];

/**
 * A Board with two units at the same battlefield. The production chain resolves
 * the target spec itself; the reference kernel compares filter values literally,
 * so the golden locks the already-chosen unit through setTargets — the same
 * convention the merged smoke-screen / spirits-refuge goldens use.
 */
function punchWorld() {
  const base = world()
    .player("A", { energy: 4, power: ["Body", "Body"] })
    .player("B", { energy: 4 })
    .object("punch-first", {
      name: "Punch First",
      cardId: CANONICAL,
      types: ["spell"],
      zone: "hand",
      energy: 1,
      power: ["Body", "Body"],
      might: null,
      owner: "A",
      controller: "A"
    })
    .unit("friendly-unit", {
      owner: "A",
      controller: "A",
      might: 3,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      might: 3,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("punch-first") });
  kernel.setTargets(targetSpec.id, [kernel.ref("friendly-unit")]);
  return kernel;
}

const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: 1
  }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

test("sfd-097-221 Punch First: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-097-221 Punch First: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-097-221 Punch First: the printed [Action] keyword is declared (806.1.b/806.1.c)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(speed.value, undefined);
});

test("sfd-097-221 Punch First: the printed 1 energy + 2 Body Power cost is carried verbatim", () => {
  assert.equal(play.kind, "play");
  // 356.1.c: the printed cost is bound from the card identity at Finalize; the
  // declared shape carries the printed 1 energy + 2 Power and never coerces it.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 2 }
  });
});

test("sfd-097-221 Punch First structure: one arithmetic-layer Might modification on the chosen unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(buff.id, "punch-first.give-plus-5-might");
  assert.equal(buff.op, "continuous.might");
  assert.equal(buff.linkedTo, undefined);
  assert.equal(buff.condition, undefined);
  assert.deepEqual(buff.args.amount, { kind: "constant", value: 5 });
  // 317.1.a / 468.7.c: "this turn" is the end-of-turn duration alias.
  assert.deepEqual(buff.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(buff.args.minimum, undefined);
  // The chosen unit travels as a target selector, not as a runtime ObjectRef
  // and not as a Buff counter (702).
  assert.deepEqual(buff.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "punch-first.unit" }
  });
  assert.deepEqual(targetSpec, {
    id: "punch-first.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-097-221 Punch First golden: the card body registers the +5 Might for this turn", () => {
  const kernel = punchWorld();
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["punch-first.give-plus-5-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478.1.a: the modification lands in the arithmetic layer.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 5);
  // 317.1.a / 468.7.c: "this turn" expires at the end of the turn.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  // Only the finalized target is affected.
  assert.equal(registration.effect.filter.objectId, "friendly-unit");
  // The primitive writes its receipt under the instruction-scoped link key.
  assert.deepEqual(
    outcome.linkedValues["punch-first.give-plus-5-might.affected.objects"],
    [kernel.ref("friendly-unit")]
  );
  assert.equal(outcome.linkedValues["punch-first.give-plus-5-might.affected.count"], 1);
});

test("sfd-097-221 Punch First golden: the +5 applies to the chosen unit only", () => {
  const kernel = punchWorld();
  resolveChainBody(play.body, kernel);

  assert.equal(effectiveMight(kernel, "friendly-unit"), 8);
  assert.equal(effectiveMight(kernel, "enemy-unit"), 3);
});

test("sfd-097-221 Punch First golden: a target that left the Board is ignored, not rebuffed (359.3.e.6)", () => {
  const kernel = punchWorld();
  const stale = kernel.ref("friendly-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("sfd-097-221 Punch First golden: the printed cost is really paid by the cost pipeline", () => {
  const kernel = punchWorld();
  const plan = buildCostPlan(kernel, {
    id: "cost:punch-first",
    cost: { kind: "explicit", energy: { kind: "constant", value: 1 }, power: { kind: "constant", value: 2 } },
    domains: ["Body"]
  });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [{ amount: 2, allowedDomains: ["Body"] }]);

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  // 1 energy plus the two Power requirements are allocated from the paying
  // player's Body Power; the reference kernel only models the energy half of
  // the `pay` action, so the allocation is asserted from the receipt.
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: "Body", amount: 2 }]);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay"]);
});

test.todo(
  "sfd-097-221 Punch First: the printed [Action] Showdown admission (806.1.b/806.1.c) needs the chain's " +
    "canAct check to read the merged continuous.timing grant (CR 806 / 159.2.a) — RIFT-259 query + RIFT-257 binding"
);
test.todo(
  "sfd-097-221 Punch First: the end-of-turn expiry in the real turn flow (317.1.a / 468.7.c) is applied by " +
    "layers/duration at the turn-end timing point; the golden asserts the registered end-of-turn duration"
);


// --- Production goldens: original registry program, real describePlay,
// ChainEngine speed/target/cost/pass/Resolve (test/fixtures/production-play.mjs).
// Printed: Spell, Body, 1 Energy + 2 Body Power. A card's `power` lists its
// distinct printed domains; the amount comes from the program's cost.
import { productionPlay } from "../../fixtures/production-play.mjs";

const pfTable = ({ power = ["Body", "Body"], target = "ally" } = {}) => productionPlay({
  programs: [program],
  answers: { "target:punch-first.unit": [target] },
  build: w => w.player("A", { energy: 1, power }).player("B")
    .object("pf", { owner: "A", controller: "A", cardId: CANONICAL, types: ["spell"], zone: "hand", energy: 1, power: ["Body"] })
    .base("ally", { might: 2 }).base("ally-2", { might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "base", player: "B" } }),
});

test("sfd-097-221 Punch First production: Action speed, +5 Might only on the chosen unit, pays 1 Energy + 2 Body", () => {
  const f = pfTable();
  const draft = f.play("pf");
  assert.equal(draft.speed, "action");
  assert.equal(f.might("ally"), 7);
  assert.equal(f.might("ally-2"), 2);
  assert.equal(f.might("enemy"), 3);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("pf").zone, "trash");
});

test("sfd-097-221 Punch First production: \"a unit\" includes an opposing unit", () => {
  const f = pfTable({ target: "enemy" });
  f.play("pf");
  assert.equal(f.might("enemy"), 8);
  assert.equal(f.might("ally"), 2);
});

for (const [why, power] of [["only one Body Power", ["Body"]], ["off-domain Power", ["Fury", "Fury"]]]) {
  test(`sfd-097-221 Punch First production: with ${why} the play is rejected before anything moves`, () => {
    const f = pfTable({ power });
    const before = f.kernel.snapshot();
    assert.throws(() => f.play("pf"), /insufficient matching Power/);
    assert.deepEqual(f.kernel.snapshot(), before);
  });
}
