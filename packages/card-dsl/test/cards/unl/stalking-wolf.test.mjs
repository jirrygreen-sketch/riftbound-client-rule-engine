// Partial execution evidence is consolidated in ../templates/keyword-static-647.test.mjs; this card remains judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/stalking-wolf.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { AwaitChoice, runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import ambush from "../../../../engine-core/dist/effects/keywords/Ambush.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-e0d6dea411202c84bc9da351b6c16a63eb618c96e03be8274b3ff5babc3419f8";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "As an additional cost to play me, kill a Bird, Cat, Dog, or Poro you control. " +
  "You may play me to its battlefield (even if you don't have other units there).";
const CREATURE_PICK = "stalking-wolf.creature";

const [ambushKeyword, additionalCost] = program.abilities;
const killPayment = additionalCost.effect.payments[0];
const creatureChoice = killPayment.choice;

test("unl-166-219 Stalking Wolf: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-166-219 Stalking Wolf: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822/);
  assert.match(program.judgeReason, /356\.2\.a/);
  assert.match(program.judgeReason, /Finalize/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-166-219 Stalking Wolf: [Ambush] is declared as a bare keyword (822.1.b / 822.1.c)", () => {
  assert.deepEqual(ambushKeyword, { kind: "keyword", keyword: "ambush" });
  // 822.1.d keeps the printed text verbatim; the card must not hand-roll the
  // location permission or the Reaction grant (cards/README.md section 5).
  assert.equal(program.abilities.some(ability => ability.kind === "static" && ability.effect.kind === "play-location-permission"), false);
  assert.equal(ambushKeyword.keyword, "ambush");
  // The declaration is the whole Ambush half of the card: no Reaction keyword
  // is smuggled in to stand in for 822.1.b's conditional grant.
  assert.equal(
    program.abilities.some(ability => ability.kind === "keyword" && ability.keyword === "reaction"),
    false
  );
});

test("unl-166-219 Stalking Wolf: the merged Ambush KeywordDef expands both printed permissions", () => {
  assert.equal(keywordDefinitionsById.get("Ambush"), ambush);
  const expanded = ambush.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].kind, "static");
  assert.equal(expanded[0].effect.kind, "play-location-permission");
  assert.equal(expanded[1].kind, "static");
  assert.equal(expanded[1].effect.kind, "continuous.timing");
  assert.deepEqual(expanded[1].effect.grants, ["showdown", "closed-state"]);
  const result = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "[Ambush]",
    abilities: expanded
  });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-166-219 Stalking Wolf: the additional kill is a mandatory cost component, not a target (355.10.c)", () => {
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "stalking-wolf.additional-cost");
  assert.equal(additionalCost.effect.optional, false);
  assert.equal(additionalCost.effect.stage, "mandatory-additional");

  assert.equal(killPayment.kind, "kill");
  assert.deepEqual(killPayment.amount, { kind: "constant", value: 1 });
  assert.equal(creatureChoice.id, CREATURE_PICK);
  assert.equal(creatureChoice.selection, "one");
  assert.equal(creatureChoice.min, 1);
  assert.equal(creatureChoice.max, 1);
  assert.equal(creatureChoice.type, "unit");
  assert.equal(creatureChoice.zone, "board");
  // 133.8 / "you control": the four creature tags are recorded as printed; the
  // disjunctive tag filter has no IR form (see judgeReason).
  assert.deepEqual(creatureChoice.tagsAny, ["Bird", "Cat", "Dog", "Poro"]);
  assert.equal(creatureChoice.controller, "self");
});

test("unl-166-219 Stalking Wolf golden: the mandatory kill cost really kills the chosen creature when the cost is paid (356.2.a.1)", () => {
  const kernel = world()
    .player("A", { energy: 4, power: ["Order"] })
    .unit("stalking-wolf", { controller: "A" })
    .unit("dog", { controller: "A", tags: ["Dog"] })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("stalking-wolf") });
  const creature = scoped.ref("dog");
  scoped.setPicks(CREATURE_PICK, [creature]);

  const plan = buildCostPlan(scoped, {
    id: "cost:stalking-wolf",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 4 },
      power: { kind: "constant", value: ["Order"] }
    },
    mandatoryAdditional: [
      {
        id: "stalking-wolf.additional-cost",
        cost: {
          kind: "explicit",
          payments: [
            {
              kind: "kill",
              amount: killPayment.amount,
              choice: {
                id: CREATURE_PICK,
                options: [creature],
                min: 1,
                max: 1,
                selection: "one"
              }
            }
          ]
        }
      }
    ]
  });

  assert.equal(plan.total.energy, 4);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Order"] }]);
  assert.deepEqual(
    plan.total.actions.map(action => [action.id, action.action.type]),
    [["stalking-wolf.additional-cost:payment:0:0", "kill"]]
  );

  const receipt = payCostPlan(scoped, plan, {
    nonstandardOrder: ["stalking-wolf.additional-cost:payment:0:0"]
  });
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "kill"]);
  // 429.1.a.1: the killed creature goes to its owner's Trash.
  assert.equal(scoped.getObject("dog").zone, "trash");
  assert.equal(scoped.getObject("enemy").zone, "board");
  assert.equal(scoped.player("A").energy, 0);
});

test("unl-166-219 Stalking Wolf golden: an unanswered cost choice suspends the whole transaction instead of guessing (355.10.c)", () => {
  const kernel = world()
    .player("A", { energy: 4, power: ["Order"] })
    .unit("stalking-wolf", { controller: "A" })
    .unit("dog", { controller: "A", tags: ["Dog"] })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("stalking-wolf") });
  const creature = scoped.ref("dog");

  // The cost component's object choice is a non-targeting choice made by the
  // paying player; leaving it unanswered must escape as AwaitChoice rather than
  // silently picking a creature.
  assert.throws(
    () => buildCostPlan(scoped, {
      id: "cost:stalking-wolf",
      cost: { kind: "explicit", energy: { kind: "constant", value: 4 }, power: { kind: "constant", value: ["Order"] } },
      mandatoryAdditional: [
        {
          id: "stalking-wolf.additional-cost",
          cost: {
            kind: "explicit",
            payments: [
              {
                kind: "kill",
                amount: killPayment.amount,
                choice: { id: CREATURE_PICK, options: [creature], min: 1, max: 1, selection: "one" }
              }
            ]
          }
        }
      ]
    }),
    error => error instanceof AwaitChoice && error.request.type === "select-objects"
  );

  assert.equal(scoped.getObject("dog").zone, "board");
  assert.equal(scoped.player("A").energy, 4);
});

test("unl-166-219 Stalking Wolf golden: the merged kill primitive consumes the chosen creature on the board", () => {
  const kernel = world()
    .unit("dog", { controller: "A", tags: ["Dog"] })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    kill,
    { picks: CREATURE_PICK },
    { world: kernel, picks: { [CREATURE_PICK]: [kernel.ref("dog")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("dog").zone, "trash");
  assert.deepEqual(run.linked.killed, [{ id: "dog", zoneEntryId: 1 }]);
});

test.todo(
  "unl-166-219 Stalking Wolf: consume Ambush's merged play-location permission and conditional Reaction grant " +
    "during Finalize/Chain legality (822.1.b / 822.1.c)"
);
test.todo(
  "unl-166-219 Stalking Wolf: disjunctive tag filtering for \"a Bird, Cat, Dog, or Poro\" (133.8; ObjectFilter.tags is an " +
    "AND over every tag) so the cost's candidate pool is not narrowed to one creature type"
);
test.todo(
  "unl-166-219 Stalking Wolf: the CardProgram -> CostPlan wiring that charges this mandatory additional cost during " +
    "Finalize, and the play-location permission referencing the killed creature's former battlefield (355.2.b)"
);
