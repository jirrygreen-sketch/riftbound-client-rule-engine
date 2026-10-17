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

const CARD_ID = "card.hash-5d0ab54108afb25c366527426f6c46a04e21256d6701bc128d66dd9ce8860f37";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  "[Empower] — :rb_energy_1:, :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)\n" +
  "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. If this is [Empowered], [Add] :rb_energy_2: instead.";

const [enterReplacement, empower, activated] = program.abilities;
const [addOne, addTwo] = activated.body;

const eggWorld = () => world()
  .unit("platewyrm-egg", {
    types: ["gear"],
    might: null,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .player("A")
  .player("B")
  .build();

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
  return { engine, kernel, card };
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
  // only declares the keyword (expansion belongs to the keyword registry).
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 1 });

  // 813.1.c.2 / 813.1.d: "[Reaction][>]" rewrites the activation timing.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "reaction");
  // 415.3.a / 415.5: the Exhaust symbol is the activation cost "Exhaust this".
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });

  // 430.5: "[Add] :rb_energy_1:" is one Energy; the printed "instead" branch is
  // declared with the (unmerged) Empowered gate.
  assert.equal(activated.body.length, 2);
  assert.equal(addOne.id, "platewyrm-egg.add-1");
  assert.deepEqual(addOne.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(addOne.condition, undefined);
  assert.equal(addOne.targets, undefined);
  assert.equal(addOne.picks, undefined);

  assert.equal(addTwo.id, "platewyrm-egg.add-2-instead");
  assert.deepEqual(addTwo.args, { energy: { kind: "constant", value: 2 } });
  assert.deepEqual(addTwo.condition, {
    kind: "expression",
    value: { kind: "constant", value: "is-empowered" }
  });
  assert.equal(addTwo.linkedTo, undefined);
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
  // The as-printed Empowered gate is not merged; removing the descriptive gate
  // executes the printed Not-Empowered branch (1 Energy) without inventing one.
  const notEmpowered = [{ ...addOne, args: { energy: { kind: "constant", value: 1 } } }];

  const outcome = resolveChainBody(notEmpowered, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["platewyrm-egg.add-1", "executed"]
  ]);
  // 430.1/430.5: exactly 1 Energy, no Power.
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(kernel.events.map((event) => event.action), ["gain-energy"]);
  assert.deepEqual(outcome.results[0].result.linkedValues.resources, {
    player: "A",
    energy: 1,
    power: []
  });
});

test("ven-075-166 Platewyrm Egg golden: the Empowered branch Adds exactly 2 Energy", () => {
  const kernel = eggWorld();
  // Once the Empowered predicate lands, the gate selects this branch; the golden
  // proves the printed amount (2 Energy, no Power) is what the card declares.
  const empowered = [{ ...addTwo, condition: { kind: "always" } }];

  const outcome = resolveChainBody(empowered, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 2);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(outcome.results[0].result.linkedValues.resources, {
    player: "A",
    energy: 2,
    power: []
  });
});

test("ven-075-166 Platewyrm Egg: the 'instead' branch stays gated and is never evaluated as a real predicate", () => {
  // The printed branch is exclusive. The gate is a descriptive placeholder: the
  // merged interpreter evaluates constant strings as Truthy, so running the body
  // verbatim would fire BOTH Adds. That is why the executable scenarios above
  // strip the placeholder and run one branch at a time, and why this test asserts
  // the structure instead of asserting a made-up total.
  assert.equal(activated.body.length, 2);
  assert.equal(addOne.condition, undefined);
  assert.deepEqual(addTwo.condition, {
    kind: "expression",
    value: { kind: "constant", value: "is-empowered" }
  });
  // No merged predicate provides "is-empowered" (see judgeReason 3); the branch
  // must not be silently dropped, and it must not be run unconditionally either.
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

  f.engine.execute(f.card("platewyrm-egg", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  // The entry orientation is exhausted (149.1 / 359.2.d), and the replacement
  // did not also emit a later "became ready" style event for this card.
  assert.equal(f.kernel.getObject("platewyrm-egg").zone, "board");
  assert.equal(f.kernel.getObject("platewyrm-egg").exhausted, true);
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-readied"), false);
});
test.todo(
  "ven-075-166 Platewyrm Egg: [Empower] (1 Energy + exhaust, CR 827.1.c.1/415.5) and the Empowered gate for " +
    "\"If this is [Empowered], [Add] :rb_energy_2: instead\" (CR 828.1.c) need an Empower/Empowered KeywordDef " +
    "(the RIFT-81~88 batch does not include them) plus the 828.1.b.1 dependent-ability wiring"
);
test.todo(
  "ven-075-166 Platewyrm Egg: the printed either/or branch has no merged runtime form — contract 3.4 conditions " +
    "scope to one instruction and choice.mode is blocked by chain/engine.ts assertFinalizationSurface " +
    "(\"Mode choices require a Finalize/Resolve choice-plan adapter\"), so no branch may be silently dropped (RIFT-89/90)"
);
