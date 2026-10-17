// RIFT-662: execution evidence for this card lives in
// ../templates/activated-activated-continuous-grant-key-662.test.mjs.
// This file keeps the README §4.1 layer 1 (validation and identity) and layer 2
// (structure) checks; the card stays judge-required for the gap recorded in its
// judgeReason.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/megatusk.js";

const CARD_ID =
  "card.hash-1c5a34df03f1f2101ee472f6d3fd4673e56683b49f28e64e3d9d4291bc6d8448";
const SOURCE_TEXT =
  "Spend 3 XP: Give your units here [Ganking] this turn. (We can move from " +
  "battlefield to battlefield.)";

const [ability] = program.abilities;
const [grant] = ability.body;

test("unl-126-219 Megatusk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-126-219 Megatusk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /810\.1\.c/);
  assert.match(program.judgeReason, /144\.4\.c/);
});

test("unl-126-219 Megatusk: 3 XP base cost, Action timing, no printed Exhaust", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 204.1.b / 377.1: the text before the ":" is the base cost; 730.2 is Spend XP.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }]
  });
  assert.equal(ability.restriction, undefined);
});

test("unl-126-219 Megatusk: the grant names Ganking with an end-of-turn duration and 'here' scope", () => {
  assert.equal(grant.id, "megatusk.grant-ganking");
  assert.equal(grant.op, "continuous.grant-keyword");
  // 810 / 810.3：被注册的 KeywordId 是大小写敏感的 "Ganking"。
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Ganking" });
  // 801.3.a.2 / 317.2.c: the granted keyword carries the printed "this turn" duration.
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grant.linkedTo, undefined);
  assert.equal(grant.picks, undefined);

  // "your units here" is a criteria-based set (359.3.f, 355.10.d), resolved by
  // the query at instruction time rather than locked as a target.
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        controller: "self",
        zone: "board",
        sameLocationAs: "source"
      }
    }
  });
  assert.equal(grant.targets, undefined);
});

test.todo(
  "unl-126-219 Megatusk: the granted [Ganking] must open a battlefield-to-battlefield Standard Move " +
    "(CR 810.1.b / 810.1.c, 144.4.c) — effects/keywords/Ganking.ts writes permission as the string " +
    "\"battlefield-to-battlefield\" while layers/rules/query.ts movement() reads permission.routes, so " +
    "canGank stays false even with the registration present (measured)"
);
