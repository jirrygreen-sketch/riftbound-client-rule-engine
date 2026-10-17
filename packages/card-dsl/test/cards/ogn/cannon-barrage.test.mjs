// Execution evidence for the merged effect.damage / [Reaction] halves of Cannon
// Barrage lives in the RIFT-652 template suite:
//   ../templates/keyword-play-effect-damage-652.test.mjs
// The card stays judge-required: its "all enemy units in combat" set is not a
// target (355.10.d) and effect.damage has no non-target set form, plus the
// combat designation producer (740.2.c) is still missing. This file keeps
// validation, identity and the key structure only.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cannon-barrage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { abilitySpeed, expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /非目标/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
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
  // combat-step damage (418.6.c / 418.7).
  assert.equal(dealTwo.args.combat, undefined);
  // 355.10.d: an object mentioned only as a programmatic selection is not
  // Targeted ("Kill all units at battlefields" doesn't target anything), so
  // declaring a TargetSpec would wrongly report became-target events.
  assert.equal(dealTwo.targets, undefined);
  assert.equal(dealTwo.picks, undefined);
  // The described set carries the 740.2.c combat designation it needs, in the
  // same { kind: "query", filter } descriptor shape effect.ready / effect.heal
  // consume. effect.damage has no such consumer, which is the judgeReason gap.
  assert.deepEqual(dealTwo.args.objects, {
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

test("Cannon Barrage: its Reaction declaration is admitted by the real chain during a Closed State", () => {
  const f = fixture();
  const source = f.kernel.getObject("source");
  const speed = abilitySpeed(expandProgram(program, source).abilities, source);
  assert.equal(speed, "reaction");
  f.engine.execute(f.draft("open-response-window"));
  assert.equal(f.engine.turnState, "neutral-closed");
  assert.equal(f.engine.canAct("A", speed), true);
  assert.equal(f.engine.canAct("A", "action"), false);
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, 1);
});
