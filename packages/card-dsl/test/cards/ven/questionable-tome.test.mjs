import empowerKeyword from "../../../../engine-core/dist/effects/keywords/Empower.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/questionable-tome.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-a1ab154053bc70a80a473f0fd0410a73b87c97807d9efc4295ee589662fde3d3";
// "—" is followed by two spaces in the deck catalog; the text is verbatim.
const SOURCE_TEXT =
  "[Empower] —  :rb_exhaust: (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "Disempower this, :rb_energy_1:, :rb_exhaust:: Draw 1.";

const [empower, activated] = program.abilities;
const [drawInstruction] = activated.body;

/** The Gear on the Board with a stocked Main Deck and one Energy in the pool. */
function tomeWorld() {
  const base = world()
    .unit("questionable-tome", {
      types: ["gear"],
      energy: 3,
      power: null,
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .deck(["top-card", "next-card"])
    .build();
  base.addPlayer("A", { energy: 1 });
  return base.clone({
    source: base.ref("questionable-tome"),
    sourceSnapshot: base.getObject("questionable-tome")
  });
}

test("ven-054-166 Questionable Tome: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-054-166 Questionable Tome: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /disempower/);
  assert.match(program.judgeReason, /cost\/plan-values/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-054-166 Questionable Tome: [Empower] is declared with its exhaust cost left to the keyword registry", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // The exhaust payment is 827.1.c.1's expansion; the card must not write a
  // second, hand-rolled Empower ability.
  assert.equal(program.abilities.filter(ability => ability.kind === "keyword").length, 1);
});

test("ven-054-166 Questionable Tome: the activated ability costs Disempower + 1 Energy + Exhaust and draws 1", () => {
  // 151/151.2: a Gear activated ability, action timing.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.cost.kind, "activated");
  // 404.1.a / 415.5 / 443.2.a: everything printed before the ":" is the cost.
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(activated.cost.payments, [
    { kind: "disempower", object: "self" },
    { kind: "exhaust", object: "self" }
  ]);
  assert.equal(activated.restriction, undefined);

  // 414.3: "Draw 1" draws one card for the ability controller (190.6.d).
  assert.equal(activated.body.length, 1);
  assert.equal(drawInstruction.id, "questionable-tome.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("ven-054-166 Questionable Tome golden: the Energy + Exhaust halves of the activation cost really pay", () => {
  const kernel = tomeWorld();
  const plan = buildCostPlan(kernel, {
    id: "cost:questionable-tome",
    cost: {
      kind: "activated",
      energy: activated.cost.energy,
      // The merged cost pipeline has no disempower payment kind (see
      // judgeReason), so this check runs the two payable components; the third
      // one is the judged gap and stays in test.todo.
      payments: [{ kind: "exhaust", object: "self" }]
    }
  });
  assert.equal(plan.total.energy, 1);
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("questionable-tome").exhausted, true);
});

test("ven-054-166 Questionable Tome golden: the Draw 1 body really draws through the interpreter", () => {
  const kernel = tomeWorld();
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["questionable-tome.draw", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(kernel.zone("A", "hand")[0].id, "top-card");
  assert.equal(outcome.linkedValues["questionable-tome.draw.drawn"], 1);
});

test.todo(
  "ven-054-166 Questionable Tome: \"Disempower this\" as activation cost (404.1.a / 443.2.a) needs a disempower payment kind " +
    "in cost/plan-values.ts - readCost's supported kinds are energy/power/xp/exhaust/discard/recycle/kill/reveal/spend-buff (cost/plan-values.ts); " +
    "the resolve-time effect.empower disempower is an effect, not a Finalize cost (204.3)"
);
test.todo(
  "ven-054-166 Questionable Tome: [Empower] with the exhaust-only cost must expand to a \"use only if not Empowered\" activated " +
    "ability (827.1.c.1 / 415.5) - the registered Empower KeywordDef still needs KeywordAbility/programs/keywords.ts params.cost forwarding"
);

test("ven-054-166 Questionable Tome: the merged Empower expansion pays Exhaust and empowers through its original body", () => {
  const kernel = tomeWorld();
  // Exercise the registered keyword with the printed cost; this does not add
  // params to the CardProgram or bypass its judge-required binding guard.
  const [ability] = empowerKeyword.expand({ host: { canonicalCardId: CANONICAL },
    params: { cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] } } });
  const plan = buildCostPlan(kernel, { id: "tome:empower", cost: ability.cost });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  const result = resolveChainBody(ability.body, kernel);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(kernel.getObject("questionable-tome").exhausted, true);
  assert.equal(kernel.getObject("questionable-tome").empowered, 1);
  assert.equal(kernel.player("A").energy, 1, "the Empower cost contains no Energy");
  assert.equal(kernel.getObject("questionable-tome").power, null);
  const again = resolveChainBody(ability.body, kernel);
  assert.deepEqual(again.results[0].result, { status: "negated", reason: "skipped", events: [] },
    "the expansion rechecks not Empowered at Resolve");
  assert.equal(kernel.getObject("questionable-tome").empowered, 1);
});
