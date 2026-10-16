import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/reksai-breacher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-6eb6345b70c561ae3d2ed335eb50fdd0958d942af912aaceba44ad0038813815";

const [accelerate, assault, grant] = program.abilities;

test("sfd-029-221 Rek'Sai, Breacher: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-029-221 Rek'Sai, Breacher: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
      "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
      "Friendly units played from anywhere other than a player's hand have [Accelerate]."
  );
});

test("sfd-029-221 Rek'Sai, Breacher: judgeReason names the keyword-grant and play-origin gaps", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /来源区域|played from anywhere/);
});

test("sfd-029-221 Rek'Sai, Breacher: [Accelerate] and [Assault] are declared without values", () => {
  assert.equal(program.abilities.length, 3);
  // 805.1.b: the printed cost is fixed at 1 energy + 1 power, so the keyword
  // carries no value; 807.1.b.3: an omitted Assault value presumes 1.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.equal(accelerate.value, undefined);
  assert.equal(assault.value, undefined);
});

test("sfd-029-221 Rek'Sai, Breacher: the third ability is a static Accelerate grant to non-hand-played units", () => {
  // 364.1 / 364.2: a statement-sentence passive ability, not a keyword
  // declaration; contract 3.7 gives keyword granting its own continuous shape.
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "accelerate");
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    playedFromZoneNot: "hand"
  });
  assert.equal(grant.condition, undefined);
});

test.todo(
  "sfd-029-221 Rek'Sai, Breacher: the continuous.grant-keyword static ability needs a consumer that " +
    "registers CardProgram statics into layers and expands the granted Accelerate on each recipient " +
    "(RIFT-9 continuous.keyword, RIFT-91 layers-continuous)"
);

test.todo(
  "sfd-029-221 Rek'Sai, Breacher: 'played from anywhere other than a player's hand' needs a " +
    "play-origin zone predicate (the frozen ObjectFilter vocabulary has type/controller/owner/zone/" +
    "states/tags/characteristics but no origin-zone-of-play match); the `playedFromZoneNot` key above " +
    "is a descriptive placeholder with no consumer"
);

test.todo(
  "sfd-029-221 Rek'Sai, Breacher: [Accelerate] payment and enter-ready replacement end-to-end through " +
    "the cost pipeline and entry replacement (CR 805.1.b, 805.2.b, 805.6.a) — RIFT-86 / RIFT-89 / RIFT-91"
);

test.todo(
  "sfd-029-221 Rek'Sai, Breacher: [Assault] (+1 Might while the host is an attacker) — the KeywordDef " +
    "exists but no consumer expands CardProgram keyword abilities into layers (RIFT-81 / RIFT-91)"
);
