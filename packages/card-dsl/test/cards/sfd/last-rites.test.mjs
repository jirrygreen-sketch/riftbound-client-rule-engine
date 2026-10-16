import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/last-rites.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { buildCostPlan, CostPlanError } = await import(new URL("cost/index.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const CANONICAL = "card.hash-a94953e6e26ed3d9751a4dd5e4674a587232a894999224e5ce566be1f0895d89";
const SOURCE_TEXT =
  "[Equip] — :rb_rune_chaos:, Recycle 2 cards from your trash " +
  "(Pay the cost: Attach this to a unit you control.)";

const [equip] = program.abilities;
const [recycleAddition] = equip.costAdditions;
const constant = (value) => ({ kind: "constant", value });

/** Last Rites on the Board with two cards in its controller's Trash. */
function lastRitesWorld() {
  const base = world()
    .object("last-rites", {
      name: "Last Rites",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: 2
    })
    .unit("trashed-unit", { zone: "trash", types: ["unit"] })
    .unit("other-trashed-unit", { zone: "trash", types: ["unit"] })
    .unit("ally", { might: 2 })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("last-rites") });
}

test("sfd-150-221 Last Rites: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-150-221 Last Rites: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason names the mixed printed cost, the missing keyword carrier and the
  // blocked equip payment kind, each with its dependency.
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /costAdditions/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-150-221 Last Rites: the Equip keyword records the printed Power and the recycle addition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c.2: the printed Power half is one Chaos Power.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Chaos");
  // 818.1.c.3 / 417.6: the printed non-resource half is "Recycle 2 cards from
  // your trash" (a descriptive declaration; the KeywordAbility carrier has no
  // printed-cost field, see judgeReason).
  assert.deepEqual(equip.costAdditions, [
    { kind: "recycle", amount: 2, zone: "trash", owner: "controller" }
  ]);
  assert.equal(recycleAddition.amount, 2);
  assert.equal(recycleAddition.zone, "trash");
  assert.equal(recycleAddition.owner, "controller");
});

test("sfd-150-221 Last Rites: the printed reminder text generates no ability", () => {
  // "Pay the cost: Attach this to a unit you control." is reminder text
  // (CR 135.2.d.3); the program keeps it verbatim in sourceText only.
  assert.equal(program.abilities.length, 1);
  assert.match(program.sourceText, /Pay the cost: Attach this to a unit you control\./);
  assert.equal(program.sourceText.includes("\n"), false);
});

test("sfd-150-221 Last Rites golden: the printed recycle cost is really charged by the merged cost pipeline", () => {
  // The card's own printed declaration is turned into a concrete payment and
  // executed: cost/plan-values.ts builds the two recycle actions and
  // cost/payment.ts pays them (417.3/417.6). This shows the missing piece is
  // the keyword-side carrier and the equip payment kind, not recycle-as-cost.
  const context = lastRitesWorld();
  const trashed = context.zone("A", "trash");
  assert.equal(trashed.length, 2);

  context.setAnswers({
    "last-rites:equip-cost-additions:pick:last-rites.recycled-cards": trashed
  });
  const plan = buildCostPlan(context, {
    id: "last-rites:equip-cost-additions",
    cost: {
      kind: "activated",
      payments: [{
        kind: recycleAddition.kind,
        amount: constant(recycleAddition.amount),
        choice: {
          id: "last-rites.recycled-cards",
          options: trashed,
          min: recycleAddition.amount,
          max: recycleAddition.amount,
          selection: "one"
        }
      }]
    }
  });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.total.actions.map((action) => action.action.type), ["recycle", "recycle"]);
  // 417.1.a / 417.1.c: both cards went to the bottom of their owner's Main Deck.
  assert.deepEqual(context.zone("A", "trash"), []);
  assert.deepEqual(
    context.zone("A", "deck").map((ref) => ref.id).sort(),
    ["other-trashed-unit", "trashed-unit"]
  );
  // The receipt replays the whole payment: the resource payment action comes
  // first (zero Energy here, so it is a successful no-op), then both recycles.
  assert.deepEqual(receipt.events.map((event) => event.action), ["pay", "recycle", "recycle"]);
});

test("sfd-150-221 Last Rites golden: an empty Trash cannot pay the printed recycle cost (CR 417.3)", () => {
  const base = world()
    .object("last-rites", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: 2
    })
    .build();
  const context = base.clone({ sourceSnapshot: base.getObject("last-rites") });

  assert.throws(
    () => buildCostPlan(context, {
      id: "last-rites:empty-trash",
      cost: {
        kind: "activated",
        payments: [{
          kind: recycleAddition.kind,
          amount: constant(recycleAddition.amount),
          choice: {
            id: "last-rites.recycled-cards",
            options: [],
            min: recycleAddition.amount,
            max: recycleAddition.amount,
            selection: "one"
          }
        }]
      }
    }),
    (error) => error instanceof CostPlanError && error.reason === "invalid-cost-plan"
  );
});

test("sfd-150-221 Last Rites: the merged Equip expansion is valid EffectIR for this card", () => {
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
});

test.todo(
  "sfd-150-221 Last Rites: the printed mixed Equip cost (1 Chaos Power + Recycle 2 from your " +
    "trash, CR 818.1.c.2/818.1.c.3) needs a KeywordAbility cost carrier - contract 3.8 item 3's " +
    "ExpandInput params.cost - so the keyword expansion can declare both halves (RIFT-89 follow-up)."
);
test.todo(
  "sfd-150-221 Last Rites: paying the printed Equip cost needs the \"equip\" payment kind in " +
    "cost/plan-values.ts (RIFT-89 follow-up) plus the card-program -> keyword expansion -> chain " +
    "wiring (contract 3.5, RIFT-120 follow-up)."
);
