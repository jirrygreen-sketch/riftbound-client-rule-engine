import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/for-demacia.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a battlefield. Give friendly units there [Shield 2] this turn. " +
  "(+2 :rb_might: while they're defenders.)";

const [keyword, play] = program.abilities;
const [grantInstruction] = play.body;

test("For Demacia! program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("For Demacia! identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("For Demacia! structure: [Reaction], printed cost, battlefield target plus Shield 2 grant", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(play.body.length, 1);

  // 814.1.c: "[Shield 2] this turn" is an end-of-turn keyword grant of Shield 2.
  assert.equal(grantInstruction.id, "for-demacia.grant-shield");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Shield" });
  assert.deepEqual(grantInstruction.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });

  // 170 / 170.7 / 355.10.a.1: the chosen battlefield is a target.
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "for-demacia.battlefield",
      filter: { type: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // 355.10.d: "friendly units there" is a criteria-based set, not a target; the
  // location anchor records the intended 170.11-style restriction.
  const affected = grantInstruction.args.filter.value;
  assert.equal(affected.type, "unit");
  assert.equal(affected.controller, "controller");
  assert.deepEqual(affected.sameLocationAs, { target: "for-demacia.battlefield" });
  // No unit TargetSpec: the affected units are never chosen individually.
  assert.equal(grantInstruction.targets.length, 1);
});

test("For Demacia! fail-closed: the unregistered keyword-grant op throws instead of granting nothing", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  // Lock the printed battlefield target the way Finalize would, then run the
  // body without its TargetSpecs (the reference kernel compares the contract
  // placeholders verbatim). The keyword-grant op must still fail closed.
  const executableBody = play.body.map(({ targets, ...rest }) => rest);
  assert.throws(
    () => runAbilityBody(executableBody, kernel),
    /Unregistered instruction opcode: continuous\.grant-keyword/
  );
  assert.deepEqual(kernel.getObject("ally").keywords, []);
});

test.todo(
  "For Demacia!: '[Shield 2] this turn' needs the end-of-turn continuous.grant-keyword effect " +
    "(CR 814.1.c, contract 3.4) — RIFT-91 / RIFT-9"
);

test.todo(
  "For Demacia!: the Shield expansion is continuous.might gated on designation === 'defender', which needs the " +
    "defender designation characteristic and its layer consumer (CR 814.1.d) — RIFT-91"
);

test.todo(
  "For Demacia!: 'friendly units there' needs the chosen battlefield's LocationRef to filter units by location " +
    "(target.location not merged) — RIFT-90"
);
