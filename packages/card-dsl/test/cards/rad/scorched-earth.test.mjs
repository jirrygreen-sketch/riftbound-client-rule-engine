// Execution evidence for the merged split-damage half of Scorched Earth lives
// in the RIFT-652 template suite:
//   ../templates/keyword-play-effect-damage-652.test.mjs
// The card stays judge-required: the "at a single battlefield" group
// constraint (355.14.a) has no evaluating consumer, 355.14.h target reduction
// is missing, and the production chain adapter does not decode effect.damage's
// divide flag. This file keeps validation, identity and the key structure only.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/scorched-earth.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-0de7fdfddfced7ff6b7fcdb3da2d93eb7c6f6531565882598b1ff5fa0d827fa0";
const [keyword, play] = program.abilities;
const deal = play.body[0];

test("rad-006-167 Scorched Earth: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\nDeal 5 damage split among units at a single battlefield."
  );
});

test("rad-006-167 Scorched Earth: judge-required naming the group, 355.14.h and adapter gaps", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.14\.a/);
  assert.match(program.judgeReason, /group/);
  assert.match(program.judgeReason, /355\.14\.h/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
});

test("rad-006-167 Scorched Earth: [Action] plus one split-damage target up to 5 units, capped at the damage", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.body.length, 1);
  assert.equal(deal.op, "effect.damage");
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 5 });
  // 355.14.e: the per-target division is decided at resolution; the IR can
  // only spell the flag as an Expr (see judgeReason for the adapter gap).
  assert.deepEqual(deal.args.divide, { kind: "constant", value: true });
  assert.deepEqual(deal.args.target, { kind: "constant", value: "scorched-earth.units" });

  assert.equal(deal.targets.length, 1);
  const [spec] = deal.targets;
  assert.equal(spec.id, "scorched-earth.units");
  // Targets are units on the Board at a battlefield (355.9.b: "at a battlefield"
  // is a targeting restriction; the battlefield itself is not a target, 355.10.b).
  assert.deepEqual(spec.filter, { type: "unit", zone: "board", location: "battlefield" });
  // 355.14.c: the target count cannot exceed the available damage (5).
  assert.equal(spec.max, 5);
  assert.equal(spec.selection, "any");
  // Group marker for "at a single battlefield" (CR 355.14.a).
  assert.equal(spec.group, true);
  assert.equal(deal.picks, undefined);
  assert.equal(deal.linkedTo, undefined);
});
