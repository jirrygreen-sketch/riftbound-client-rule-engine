import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dredge-up.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import flowDefinition from "../../../../engine-core/dist/effects/keywords/Flow.js";

const CANONICAL = "card.hash-ee8db3ab5ed40e3950cf84297f9cb4b2438324dd0f733d2bd1a1332f6c24124c";
const SOURCE_TEXT =
  "Draw 1.\n[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flow, play] = program.abilities;
const [drawInstruction] = play.body;

test("ven-049-166 Dredge Up: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-049-166 Dredge Up: judgeReason names the Flow cost, banish replacement and cost-plan gaps", () => {
  assert.match(program.judgeReason, /829\.1\.c\.1/);
  assert.match(program.judgeReason, /829\.1\.c\.3/);
  assert.match(program.judgeReason, /829\.1\.b\.1/);
  assert.match(program.judgeReason, /KeywordDef\.expand\.params\.cost/);
  assert.match(program.judgeReason, /实付实例回执/);
  assert.match(program.judgeReason, /object-leaves-chain/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-049-166 Dredge Up: the printed [Flow] keyword is declared without inventing a value", () => {
  assert.deepEqual(flow, { kind: "keyword", keyword: "flow" });
  // 829.1.c is "Flow [Cost]": the printed 2 Energy is a keyword parameter, not
  // a numeric value. KeywordDef.expand supports params.cost, but KeywordAbility
  // and expandProgram still cannot pass it, so the cost lives in the judgeReason — never in value, and
  // never as a second ordinary play cost.
  assert.equal(Object.hasOwn(flow, "value"), false);
  assert.equal(Object.hasOwn(flow, "cost"), false);
});

test("ven-049-166 Dredge Up golden: an explicitly supplied Flow parameter expands and plans the printed 2 Energy alternate cost", () => {
  // This proves the generic expansion/planner support, not production parameter passing or Flow selection receipts.
  const cost = { energy: { kind: "constant", value: 2 } };
  const expanded = flowDefinition.expand({ host: { canonicalCardId: CANONICAL }, params: { cost } });
  const flowCost = expanded.find(ability => ability.kind === "static").effect;
  assert.equal(flowCost.kind, "flow.cost");
  assert.equal(flowCost.sourceZone, "trash");
  assert.deepEqual(flowCost.cost, cost);
  const kernel = world()
    .player("A", { energy: 3 })
    .card("dredge-up", { zone: "trash", types: ["spell"], energy: 2, power: null })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("dredge-up") });
  const plan = buildCostPlan(context, {
    id: "dredge-up.flow",
    cost: { kind: "printed" },
    baseModifications: [{ kind: "flow", id: "dredge-up.flow-instance", cost: flowCost.cost }]
  });
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, []);
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(context.player("A").energy, 1);
});

test("ven-049-166 Dredge Up: structure — printed energy 2, absent power, one unlinked Draw 1", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  // power: null in the catalog means no printed power; the field is absent,
  // never rewritten as 0.
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.id, "dredge-up.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("ven-049-166 Dredge Up golden: the Draw 1 body really draws the top card", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["dredge-up.draw", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.equal(outcome.linkedValues["dredge-up.draw.drawn"], 1);
  // 414.1.a: an unspecified drawer is the ability's controller (190.6.d).
  assert.equal(outcome.linkedValues["dredge-up.draw.drawnTo"], "A");
});

test("ven-049-166 Dredge Up golden: an empty Main Deck draws 0 without inventing a card", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  // 414.4 / contract 3.6: the primitive links the real drawn count; Burn Out is
  // the kernel's business, and no card is produced out of nothing.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "ven-049-166 Dredge Up: play from Trash for the 2 Energy Flow cost (829.1.c.1 alternate cost, " +
    "829.1.c.3 instance tracking) — the planner supports Flow, but printed parameter passing, flow.cost-to-Finalize " +
    "input, a selected-instance receipt and the Trash-play permission still need integration"
);

test.todo(
  "ven-049-166 Dredge Up: the delayed replacement that banishes the spell after it leaves the Chain " +
    "(829.1.b.1, distinguishing a normal Chain exit from one instructed by the spell itself) — needs " +
    "object-leaves-chain matching plus finalized/selected-instance/leavingInstruction checks; generic replacement binding exists"
);
