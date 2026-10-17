import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/platewyrm-egg.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-5d0ab54108afb25c366527426f6c46a04e21256d6701bc128d66dd9ce8860f37";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  "[Empower] — :rb_energy_1:, :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)\n" +
  "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. If this is [Empowered], [Add] :rb_energy_2: instead.";

const [enterReplacement, empower, activated] = program.abilities;
const [branch, addOne, addTwo] = activated.body;

const eggWorld = () => {
  const base = world()
  .unit("platewyrm-egg", {
    types: ["gear"],
    might: null,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .player("A")
  .player("B")
  .build();
  return base.clone({ sourceSnapshot: base.getObject("platewyrm-egg") });
};

/**
 * The same minimal chain fixture shape engine-core's replacement tests use:
 * a real ChainEngine over the reference kernel, so the bound replacement runs
 * through the production entry pipeline instead of a hand-driven apply call.
 */
function chainFixture({ cards = [] } = {}) {
  const builder = world().player("A", { energy: 5 }).player("B", { energy: 5 });
  for (const card of cards) builder.hand(card.id, { energy: 1, power: [], ...card });
  const kernel = builder.build();
  const decide = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "mode") return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: () => false
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const card = (id, options = {}) => ({
    id: `card:${id}`,
    controller: "A",
    source: kernel.getObject(id),
    kind: "spell",
    speed: "normal",
    body: [],
    cost: { id: `cost:${id}`, cost: { energy: { kind: "constant", value: 0 }, power: { kind: "constant", value: [] } } },
    ...options
  });
  const resolveAll = () => {
    let count = 0;
    while (engine.items.length) {
      if (++count > 50) throw new Error("Nonterminating test chain");
      engine.pass(engine.priority);
    }
  };
  return { engine, kernel, card, resolveAll };
}

test("ven-075-166 Platewyrm Egg: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-075-166 Platewyrm Egg: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /828\.1\.c|Empowered/);
  assert.match(program.judgeReason, /KeywordAbility/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /ChainDraft\.kind=activated/);
  assert.match(program.judgeReason, /430\.2\.a|430\.3/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-075-166 Platewyrm Egg: enter-exhausted replacement, Empower keyword and the Reaction Add ability", () => {
  assert.equal(program.abilities.length, 3);

  // "This enters exhausted." — an entry state rewrite (149.1 / 359.2.d), never a
  // later exhaust action; the consumer is the board-entry replacement pipeline.
  assert.equal(enterReplacement.kind, "replacement");
  assert.deepEqual(enterReplacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterReplacement.with.length, 1);
  assert.equal(enterReplacement.with[0].op, "replacement.enter");
  assert.deepEqual(enterReplacement.with[0].args.state, { kind: "constant", value: "exhausted" });

  // 827.1.c: the printed Empower cost is 1 Energy + exhaust the source; the card
  // only declares the non-valued keyword (expansion belongs to the keyword registry).
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });

  // 813.1.c.2 / 813.1.d: "[Reaction][>]" rewrites the activation timing.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "reaction");
  // 415.3.a / 415.5: the Exhaust symbol is the activation cost "Exhaust this".
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });

  // 430.5: "[Add] :rb_energy_1:" is one Energy; the printed "instead" branch is
  // declared with one saved Empowered predicate and mutually exclusive branches.
  assert.equal(activated.body.length, 3);
  assert.equal(branch.op, "condition.predicate");
  assert.deepEqual(branch.args.condition.value, {
    kind: "compare", left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte", right: { kind: "constant", value: 1 }
  });
  assert.equal(addOne.id, "platewyrm-egg.add-1");
  assert.deepEqual(addOne.args, { energy: { kind: "constant", value: 1 } });
  assert.deepEqual(addOne.condition, { kind: "not", condition: addTwo.condition });
  assert.equal(addOne.linkedTo, branch.id);
  assert.equal(addOne.targets, undefined);
  assert.equal(addOne.picks, undefined);

  assert.equal(addTwo.id, "platewyrm-egg.add-2-instead");
  assert.deepEqual(addTwo.args, { energy: { kind: "constant", value: 2 } });
  assert.deepEqual(addTwo.condition, {
    kind: "expression",
    value: { kind: "linked-value", instructionId: branch.id, key: "value" }
  });
  assert.equal(addTwo.linkedTo, branch.id);
});

test("ven-075-166 Platewyrm Egg golden: the exhaust cost really exhausts the Gear (415.3.a/415.5)", () => {
  const kernel = eggWorld();
  const bound = kernel.clone({
    source: kernel.ref("platewyrm-egg"),
    sourceSnapshot: kernel.getObject("platewyrm-egg")
  });
  const plan = buildCostPlan(bound, {
    id: "cost:platewyrm-egg",
    cost: activated.cost
  });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["exhaust"]);

  const receipt = payCostPlan(bound, plan);
  assert.equal(receipt.paid, true);
  assert.equal(bound.getObject("platewyrm-egg").exhausted, true);
});

test("ven-075-166 Platewyrm Egg golden: the Not-Empowered branch Adds exactly 1 Energy", () => {
  const kernel = eggWorld();
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    [branch.id, "executed"], ["platewyrm-egg.add-1", "executed"], [addTwo.id, "negated"]
  ]);
  // 430.1/430.5: exactly 1 Energy, no Power.
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(kernel.events.map((event) => event.action), ["gain-energy"]);
  assert.deepEqual(outcome.results.find(result => result.id === addOne.id).result.linkedValues.resources, {
    player: "A",
    energy: 1,
    power: []
  });
});

test("ven-075-166 Platewyrm Egg golden: the Empowered branch Adds exactly 2 Energy", () => {
  const kernel = eggWorld();
  assert.equal(kernel.perform({ type: "empower", object: kernel.ref("platewyrm-egg") }).status, "done");
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    [branch.id, "executed"], [addOne.id, "negated"], [addTwo.id, "executed"]
  ]);
  assert.deepEqual(outcome.results.find(result => result.id === addOne.id).result, {
    status: "negated", reason: "skipped", events: []
  });
  assert.equal(kernel.player("A").energy, 2);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(outcome.results.find(result => result.id === addTwo.id).result.linkedValues.resources, {
    player: "A",
    energy: 2,
    power: []
  });
});

test("ven-075-166 Platewyrm Egg: the 'instead' branch consumes one shared state snapshot", () => {
  assert.equal(activated.body.length, 3);
  assert.deepEqual(addOne.condition, { kind: "not", condition: addTwo.condition });
  assert.deepEqual(addTwo.condition, {
    kind: "expression", value: { kind: "linked-value", instructionId: branch.id, key: "value" }
  });
  assert.equal(addTwo.args.energy.value, 2);
  assert.notEqual(addTwo.args.energy.value, addOne.args.energy.value);
});

test("ven-075-166 Platewyrm Egg golden: \"This enters exhausted.\" really rewrites the entry through the merged replacement binding", () => {
  // The merged replacement layer (RIFT-257 batch) owns card IR bindings:
  // replacement.enter accepts the declared ready|exhausted state and intercepts
  // the chain → board entry move (CR 369.3 / 805.6). This golden binds the
  // card's own replacement ability to the Egg while it is on the Chain and
  // then plays it through the same chain machinery engine-core uses.
  const f = chainFixture({ cards: [{ id: "platewyrm-egg", types: ["gear"] }] });
  const eggRef = f.kernel.ref("platewyrm-egg");
  bindReplacement(
    {
      replaces: enterReplacement.replaces,
      with: enterReplacement.with
    },
    eggRef,
    {
      host: {
        object: (ref) => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: () => f.kernel
      },
      pipeline: f.engine.pipeline
    }
  );

  f.engine.execute(f.card("platewyrm-egg", { kind: "gear", body: [] }));
  f.resolveAll();

  // The entry orientation is exhausted (149.1 / 359.2.d), and the replacement
  // did not also emit a later "became ready" style event for this card.
  assert.equal(f.kernel.getObject("platewyrm-egg").zone, "board");
  assert.equal(f.kernel.getObject("platewyrm-egg").exhausted, true);
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-readied"), false);
});

test("ven-075-166 Platewyrm Egg golden: a Gear enters ready without the replacement", () => {
  // Gear is the printed card type. The reference chain defaults a Gear to ready
  // on entry; using a Unit here would exercise the Unit entry default instead of
  // the replacement under review.
  const f = chainFixture({ cards: [{ id: "platewyrm-egg", types: ["gear"] }] });

  f.engine.execute(f.card("platewyrm-egg", { kind: "gear", body: [] }));
  f.resolveAll();

  assert.equal(f.kernel.getObject("platewyrm-egg").zone, "board");
  assert.equal(f.kernel.getObject("platewyrm-egg").exhausted, false);
});

test("ven-075-166 Platewyrm Egg: the merged activation adapter exposes Reaction Add as ordinary activated", () => {
  // The card remains judge-required, so use an executable copy only to inspect
  // the production adapter's current classification. Empower expansion is
  // present, but the declared Reaction Add is still returned as activated.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = world()
    .unit("platewyrm-egg", {
      cardId: CARD_ID,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: null
    })
    .build()
    .getObject("platewyrm-egg");

  assert.equal(binding.activationAbilities(source).length, 2);
  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(draft.cost.cost, activated.cost);
  assert.deepEqual(draft.body, activated.body);
});

test.todo(
  "ven-075-166 Platewyrm Egg: carry the printed Empower 1 Energy + exhaust through KeywordAbility / " +
    "programs/keywords.ts params.cost (827.1.c.1/415.5), and expose empowered on the production ObjectSnapshot"
);
test.todo(
  "ven-075-166 Platewyrm Egg: classify the Reaction Add as ChainDraft.kind=add so " +
    "430.2.a/430.3 immediate resolution and activation during payment use the real Add path"
);
