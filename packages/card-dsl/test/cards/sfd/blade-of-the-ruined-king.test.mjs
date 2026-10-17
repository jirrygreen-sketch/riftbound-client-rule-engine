import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blade-of-the-ruined-king.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { buildCostPlan, CostPlanError } = await import(new URL("cost/index.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const CANONICAL = "card.hash-f9c6d6052ec4552cfcfc53a0e584e07cb232189ed89b277126630202cc188050";
const SOURCE_TEXT =
  "[Equip] — :rb_rune_order:, Kill a friendly unit " +
  "(Pay the cost: Attach this to a unit you control.)";

const [equip] = program.abilities;
const [killAddition] = equip.costAdditions;
const constant = (value) => ({ kind: "constant", value });

/** Blade of the Ruined King on the Board with one friendly unit to kill. */
function bladeWorld() {
  const base = world()
    .object("blade-of-the-ruined-king", {
      name: "Blade of the Ruined King",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: ["Order"],
      might: 4
    })
    .unit("ally", { might: 2 })
    .unit("second-ally", { might: 3 })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("blade-of-the-ruined-king") });
}

test("sfd-178-221 Blade of the Ruined King: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-178-221 Blade of the Ruined King: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason names the mixed printed cost, the missing keyword carrier, the
  // blocked equip payment kind and what is already executable.
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /costAdditions/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /programs\/keywords\.ts/);
  assert.match(program.judgeReason, /ProgramRegistry/);
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|261)/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-178-221 Blade of the Ruined King: the Equip keyword records the printed Power and the kill addition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c.2: the printed Power half is one Order Power.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Order");
  // 818.1.c.3 / 355.10.c.1: "Kill a friendly unit" is the printed non-resource
  // cost half; the choice inside a cost is not a target.
  assert.deepEqual(equip.costAdditions, [
    { kind: "kill", target: "friendly-unit", selection: "pick" }
  ]);
  assert.equal(killAddition.kind, "kill");
  assert.equal(killAddition.selection, "pick");
});

test("sfd-178-221 Blade of the Ruined King: the printed reminder text generates no ability", () => {
  // "Pay the cost: Attach this to a unit you control." is reminder text
  // (CR 135.2.d.3); it stays verbatim in sourceText only.
  assert.equal(program.abilities.length, 1);
  assert.match(program.sourceText, /Pay the cost: Attach this to a unit you control\./);
  assert.equal(program.sourceText.includes("\n"), false);
});

test("sfd-178-221 Blade of the Ruined King golden: the printed kill cost is really charged and kills the chosen unit", () => {
  // The card's own printed declaration is turned into a concrete payment and
  // executed (429.2.a: a cost kill sends the permanent to Trash). This shows the
  // missing piece is the keyword-side carrier and the equip payment kind, not
  // kill-as-cost.
  const context = bladeWorld();
  const victim = [context.ref("ally")];
  context.setAnswers({
    "blade-of-the-ruined-king:equip-cost-additions:pick:blade.fodder": victim
  });

  const plan = buildCostPlan(context, {
    id: "blade-of-the-ruined-king:equip-cost-additions",
    cost: {
      kind: "activated",
      payments: [{
        kind: killAddition.kind,
        choice: {
          id: "blade.fodder",
          options: victim,
          min: 1,
          max: 1,
          selection: "one"
        }
      }]
    }
  });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "kill"]);
  assert.deepEqual(context.zone("A", "trash").map((ref) => ref.id), ["ally"]);
  assert.deepEqual(
    context.query({ zone: "board", type: "unit" }).map((object) => object.ref.id),
    ["second-ally"]
  );
  assert.deepEqual(receipt.events.map((event) => event.action), ["pay", "kill"]);
});

test("sfd-178-221 Blade of the Ruined King golden: with no friendly unit the kill cost cannot be paid (CR 355.10.c.1)", () => {
  const base = world()
    .object("blade-of-the-ruined-king", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: ["Order"],
      might: 4
    })
    .build();
  const context = base.clone({ sourceSnapshot: base.getObject("blade-of-the-ruined-king") });

  assert.throws(
    () => buildCostPlan(context, {
      id: "blade-of-the-ruined-king:no-fodder",
      cost: {
        kind: "activated",
        payments: [{
          kind: killAddition.kind,
          choice: {
            id: "blade.fodder",
            options: [],
            min: 1,
            max: 1,
            selection: "one"
          }
        }]
      }
    }),
    (error) => error instanceof CostPlanError && error.reason === "invalid-cost-plan"
  );
});

test("sfd-178-221 Blade of the Ruined King: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const expansion = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL } });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: "core-1.5",
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.deepEqual(expansion[0].body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  assert.deepEqual(expansion[0].body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.equal(expansion[0].timing, "action");
});

test("sfd-178-221 Blade of the Ruined King: the merged Equip cost fails closed on the unsupported payment kind", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition);
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL } });
  const context = bladeWorld();

  assert.throws(
    () => buildCostPlan(context, { id: "blade-of-the-ruined-king:equip", cost: activation.cost }),
    (error) =>
      error instanceof CostPlanError &&
      error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
  assert.equal(context.getObject("blade-of-the-ruined-king").attachedTo, null);
});

test.todo(
  "sfd-178-221 Blade of the Ruined King: the printed mixed Equip cost (1 Order Power + Kill a " +
    "friendly unit, CR 818.1.c.2/818.1.c.3) needs the card's cost passed through KeywordDef.expand " +
    "params.cost and consumed by Equip.expand so both halves survive activation."
);
test.todo(
  "sfd-178-221 Blade of the Ruined King: add an Equip payment kind to cost/plan-values.ts and consume the " +
    "result in activation Finalize; the current merged activation binding intentionally fails closed."
);
