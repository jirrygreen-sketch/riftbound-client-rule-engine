import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cannon-barrage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e73ab11687356c6a1a4425ed546ea0a9d32acf12452fea98985aa7f9ba011d35";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Deal 2 to all enemy units in combat.";

const speed = program.abilities[0];
const play = program.abilities[1];
const [dealTwo] = play.body;

test("Cannon Barrage program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gaps (contract 3.1 / README §2).
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /740\.2\.c/);
});

test("Cannon Barrage identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Cannon Barrage structure: [Reaction] and a described set-damage instruction", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["deal-2-in-combat", "effect.damage"]
  ]);
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  // The printed amount is fixed per unit, so this is not 355.14 split damage.
  assert.equal(dealTwo.args.divide, undefined);
  // Non-combat Deal: the card deals 2 to units that are in combat, it is not
  // combat-step damage (418.6.c).
  assert.equal(dealTwo.args.combat, undefined);
});

test("Cannon Barrage structure: 'all enemy units in combat' is not declared as a target", () => {
  // 355.10.d: an object mentioned only as a programmatic selection is not
  // Targeted ("Kill all units at battlefields" doesn't target anything), so
  // declaring a TargetSpec would wrongly report became-target events.
  assert.equal(dealTwo.targets, undefined);
  assert.equal(dealTwo.picks, undefined);
  // The described set carries the 740.2.c combat designation it needs.
  assert.deepEqual(dealTwo.args.target, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        controller: "opponent",
        characteristics: { combatRole: ["attacker", "defender"] }
      }
    }
  });
  assert.equal(dealTwo.linkedTo, undefined);
  assert.equal(dealTwo.condition, undefined);
});

test("Cannon Barrage golden: the printed 2 damage executes over the locked in-combat set", () => {
  // The "in combat" characteristic is the judged part; with the set locked the
  // merged effect.damage deals the card's printed 2 to each selected unit.
  const kernel = world()
    .unit("enemy-attacker", { owner: "B", controller: "B" })
    .unit("enemy-bystander", { owner: "B", controller: "B" })
    .unit("friendly-unit", { owner: "A", controller: "A" })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: "in-combat-set" },
    { world: kernel, targets: { "in-combat-set": [kernel.ref("enemy-attacker")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-attacker").damage, 2);
  assert.equal(kernel.getObject("enemy-bystander").damage, 0);
  assert.equal(kernel.getObject("friendly-unit").damage, 0);
  assert.equal(run.linked.dealt, 2);
});

test.todo(
  "Cannon Barrage: dealing damage to a programmatically selected set needs either a " +
    "set/query form of effect.damage or a target-system set requirement (355.10.d.1)."
);

test.todo(
  "Cannon Barrage: the 'in combat' test needs combatRole on ObjectSnapshot and its " +
    "live designation producer in CombatFlow (contract 3.8 item 1, 740.2.c); until " +
    "that state is published the set cannot be evaluated."
);

test.todo(
  "Cannon Barrage: [Reaction] admission during Closed States (813.1.c, 159.2.b.2) is " +
    "chain-side timing work, not card data."
);
