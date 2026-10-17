// RIFT-654 template execution evidence: ../templates/activated-activated-effect-resources-654.test.mjs
// (printed [Reaction] + Exhaust cost and the real [Add] 1 Energy body, plus the exhausted-source
// boundary). The card stays judge-required for the pre-cost Legion history gate, the kind=add
// activation bridge and the Legend Zone asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/hand-of-noxus.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-c65f6bc670e670cfb9086db63e2e7e090e36f226d4eb71005c0460c57fe89b49";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that add resources " +
  "can't be reacted to. Get the effect if you've played a card this turn.)";

// cards README section 5: [Legion] is declared as a keyword ability; the
// dependent activated [Add] ability follows it.
const [legionKeyword, ability] = program.abilities;
const [addEnergy] = ability.body;

test("ogn-253-298 Hand of Noxus: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-253-298 Hand of Noxus: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /cards-finalized-this-turn/);
  assert.match(program.judgeReason, /translateRestriction/);
  assert.match(program.judgeReason, /describeActivate/);
  assert.match(program.judgeReason, /430\.2\.a/);
  assert.match(program.judgeReason, /107\.4/);
  assert.ok(!/RIFT-\d+/.test(program.judgeReason));
});

test("ogn-253-298 Hand of Noxus: Reaction activation with the printed Exhaust cost", () => {
  // 812.1 / 812.1.a / 812.3: the printed [Legion] is a declared keyword; its
  // expansion belongs to effects/keywords/Legion.ts (contract 3.7).
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(legionKeyword, { kind: "keyword", keyword: "legion" });
  assert.equal(legionKeyword.value, undefined);
  assert.equal(ability.kind, "activated");
  // 813.1.c/813.1.d + 430.3: [Reaction] Add ability activation permission.
  assert.equal(ability.timing, "reaction");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
});

test("ogn-253-298 Hand of Noxus: [Legion] gate preserved as a restriction shape", () => {
  // 812.1 / 812.1.b.1 / 812.1.c: Legion gates the dependent ability on having
  // played another card this turn, excluding the Legion card itself. The gate
  // expands to a condition.predicate static carrying the history payload, but
  // ActivatedAbility has no condition slot, so the printed gate is additionally
  // kept as a restriction; its activation binder must consume a Finalize-history
  // query before paying costs.
  assert.equal(ability.restriction.kind, "legion");
  assert.deepEqual(ability.restriction.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ogn-253-298 Hand of Noxus: the [Add] 1 Energy body executes", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(addEnergy.id, "hand-of-noxus.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  // 430.1 / 430.5: "[Add] :rb_energy_1:" adds 1 Energy to the controller.
  assert.deepEqual(addEnergy.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(addEnergy.linkedTo, undefined);

  const kernel = world().player("A", { energy: 0 }).build();
  const run = runInstruction(resources, addEnergy.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy"]);
});

test("ogn-253-298 Hand of Noxus: the Exhaust cost is payable and the body runs the card's own args", () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .unit("noxus", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("noxus")) });
  const plan = buildCostPlan(ctx, { id: "hand-of-noxus", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  // The printed cost is only :rb_exhaust: (no Energy); the Add 1 Energy is the
  // effect, so payment itself must not change the pool.
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.object(ctx.ref("noxus")).exhausted, true);
  assert.equal(ctx.player("A").energy, 1);

  // The production chain adapter preserves the primitive Expr arguments.
  const run = resolveChainBody(ability.body, ctx);
  assert.equal(run.status, "executed");
  assert.equal(ctx.player("A").energy, 2, "the [Add] 1 Energy lands after the exhaust cost");
  assert.deepEqual(run.linkedValues["hand-of-noxus.add-energy.resources"], { player: "A", energy: 1, power: [] });
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy"]);
});

test.todo(
  "ogn-253-298: evaluate the Legion gate (812.1.b.1 / 812.1.c “another card this turn”) at activation Finalize before costs; " +
    "condition.history / condition.predicate are instruction-level primitives and HistoryQuery.exclude works, but the restriction binder cannot run the history gate"
);

test.todo(
  "ogn-253-298: describeActivate must classify the ability as Add so the merged 430.2.a immediate " +
    "finalize/resolve and 430.3 Reaction-Add payment window are reachable from this card"
);

test("Hand of Noxus supported history primitive excludes self but counts another physical copy", () => {
  // A synthetic pair of playable units isolates HistoryQuery.exclude; the
  // actual Legend activation still needs a pre-cost Finalize-history binder.
  const initial = world().hand("noxus", { cardId: "card:history-unit" })
    .hand("copy", { cardId: "card:history-unit" }).hand("enemy", { owner: "B" }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("noxus") });
  kernel.perform({ type: "play", object: kernel.ref("noxus"), player: "A" });
  kernel.perform({ type: "play", object: kernel.ref("enemy"), player: "B" });
  const body = [{
    id: "legion-history", op: "condition.history", args: {
      query: { kind: "constant", value: { scope: "turn", action: "play", player: "A", exclude: "self" } },
      operator: { kind: "constant", value: "gte" }, right: { kind: "constant", value: 1 }
    }
  }];
  const before = resolveChainBody(body, kernel);
  assert.equal(before.linkedValues["legion-history.count"], 0);
  assert.equal(before.linkedValues["legion-history.value"], false);
  kernel.perform({ type: "play", object: kernel.ref("copy"), player: "A" });
  const after = resolveChainBody(body, kernel);
  assert.equal(after.linkedValues["legion-history.count"], 1);
  assert.equal(after.linkedValues["legion-history.value"], true);
  // This is history execution evidence, not an activation restriction adapter.
});
