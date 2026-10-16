import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cannon-barrage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.match(program.judgeReason, /RIFT-90/);
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
        combatRole: ["attacker", "defender"]
      }
    }
  });
  assert.equal(dealTwo.linkedTo, undefined);
  assert.equal(dealTwo.condition, undefined);
});

test.todo(
  "Cannon Barrage: dealing damage to a programmatically selected set needs either a " +
    "set/query form of effect.damage or a target-system set requirement with a location " +
    "filter (355.10.d.1, RIFT-9 target.query/target.many; RIFT-90 target system)."
);

test.todo(
  "Cannon Barrage: the 'in combat' test needs combatRole on ObjectSnapshot and its " +
    "filter vocabulary (contract 3.8 item 1, 740.2.c); until it lands the set cannot be " +
    "evaluated, so the instruction stays judged rather than approximated."
);

test.todo(
  "Cannon Barrage: [Reaction] admission during Closed States (813.1.c, 159.2.b.2) is " +
    "chain plus layer work (RIFT-91), not card data."
);
