import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/consuming-curse.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-eccd412b01dd63e0ce45a6b2789921b93b875f0321bcb6cea756edf8d23c9a71";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash.";

const [actionKeyword, play] = program.abilities;
const [dealInstruction] = play.body;
const [unitSpec] = dealInstruction.targets;

const CARD_NAME = "Consuming Curse";

/** The full card through the real ProgramBinding, Chain and EventPipeline. */
const runScenario = (trashCount) =>
  runCardScenario(program, {
    players: { A: { energy: 10 } },
    objects: [
      { id: "spell", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: null },
      { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 12 },
      // CR 132.1: same printed name. The kernel baseline exposes the name
      // characteristic, and 132.3 makes different printings/languages share it.
      ...Array.from({ length: trashCount }, (_, index) => ({
        id: `curse-${index}`,
        owner: "A",
        name: CARD_NAME,
        types: ["spell"],
        zone: "trash"
      })),
      // Same name on the wrong controller's trash: must not be counted (190.6.d).
      { id: "enemy-curse", owner: "B", name: CARD_NAME, types: ["spell"], zone: "trash" },
      // A different name in the controller's own trash: must not be counted.
      { id: "other-name", owner: "A", name: "Some Other Card", types: ["spell"], zone: "trash" }
    ],
    answers: { [`target:${unitSpec.id}`]: ["enemy"] },
    operations: [
      { type: "play", object: "spell", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });

test("ven-010-166 Consuming Curse: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-010-166 Consuming Curse: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  // README section 2: an executable program carries no judgeReason.
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(CANONICAL), program);
});

// The former "judgeReason names the name predicate and missing grant consumer"
// test was deleted with the gap itself: the characteristics.name predicate and
// effect.damage's own bonus argument now provide both halves in production.

test("ven-010-166 Consuming Curse: [Action] keyword, energy-only cost and one 2-damage instruction", () => {
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
  assert.equal(dealInstruction.id, "consuming-curse.deal-2");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 2 });
  // 418.4/418.5/713/714/715.1: 1 Bonus Damage per card with this name in the
  // controller's trash. 132.1/132.3 count by printed name, so the filter uses
  // characteristics.name rather than canonicalCardId.
  assert.deepEqual(dealInstruction.args.bonus, {
    kind: "count",
    subject: "objects",
    filter: {
      zone: "trash",
      owner: "self",
      characteristics: { name: CARD_NAME }
    }
  });
  // The card is on the Chain while resolving, so no separate self-exclusion is
  // needed for "your trash"; the count cannot include the spell itself.
  assert.equal(Object.hasOwn(dealInstruction.args.bonus.filter, "exclude"), false);
  assert.deepEqual(unitSpec, {
    id: "consuming-curse.battlefield-unit",
    filter: { type: "unit", location: "battlefield", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-010-166 Consuming Curse golden: the base deal marks 2 damage", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 5 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: unitSpec.id },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 2);
  assert.equal(kernel.getObject("enemy").damage, 2);
});

test("ven-010-166 Consuming Curse golden: the merged primitive adds the granted Bonus Damage per target (714/715.1)", () => {
  // effect.damage consumes args.bonus (CR 714 sums the instances, 715.1 adds them
  // to the single target). The card does not author that grant (it has no
  // consumer); this pins the arithmetic the future grant must feed.
  const kernel = world().unit("enemy", { owner: "B", might: 8 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    {
      amount: dealInstruction.args.amount,
      bonus: { kind: "constant", value: 3 },
      target: unitSpec.id
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 5);
  assert.equal(kernel.getObject("enemy").damage, 5);
});

test("ven-010-166 Consuming Curse boundary: a replaced deal grants no Bonus Damage (715.4)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 8 }).build();
  kernel.addReplacement(() => "replaced");
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    {
      amount: dealInstruction.args.amount,
      bonus: { kind: "constant", value: 3 },
      target: unitSpec.id
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test("ven-010-166 Consuming Curse golden: the full card deals 2 plus 1 Bonus Damage per same-named card in your trash", () => {
  const result = runScenario(3);

  const enemy = result.state.objects.find(object => object.ref.id === "enemy");
  // 418.1 base 2 + 714/715.1: three same-named cards in the controller's trash.
  assert.equal(enemy.damage, 5);
  assert.equal(result.links["consuming-curse.deal-2.dealt"], 5);
  assert.deepEqual(result.state.objects.find(object => object.ref.id === "spell").zone, "trash");
});

test("ven-010-166 Consuming Curse golden: an empty or unrelated trash leaves only the printed 2", () => {
  const result = runScenario(0);

  const enemy = result.state.objects.find(object => object.ref.id === "enemy");
  // The controller's trash holds the other-name card and the opponent's trash
  // holds a same-named card; neither is "with this name in YOUR trash".
  assert.equal(enemy.damage, 2);
  assert.equal(result.links["consuming-curse.deal-2.dealt"], 2);
  assert.deepEqual(
    ["other-name", "enemy-curse"].map(id => result.state.objects.find(object => object.ref.id === id).name),
    ["Some Other Card", CARD_NAME]
  );
});

test("ven-010-166 Consuming Curse golden: the count really follows the trash name count", () => {
  const damage = [0, 1, 4].map(count => {
    const result = runScenario(count);
    return result.links["consuming-curse.deal-2.dealt"];
  });

  // +1 per matching card, never a fixed bonus and never affected by the
  // opponent's trash or by other card names.
  assert.deepEqual(damage, [2, 3, 6]);
});
