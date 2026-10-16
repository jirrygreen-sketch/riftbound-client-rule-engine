import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/deadbloom-predator.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-c615c988d8b72525a349735e8c5029acbffec25179ae7427d5f8bc8aff9333b4";

const [deflect, playPermission] = program.abilities;

test("ogn-161-298 Deadbloom Predator: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
      "You may play me to an occupied enemy battlefield."
  );
});

test("ogn-161-298 Deadbloom Predator: judgeReason cites the target tax and the unresolved play permission", () => {
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /170\.11\.a/);
});

test("ogn-161-298 Deadbloom Predator: Deflect stays a keyword declaration (809)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(program.abilities.filter(ability => ability.kind === "replacement").length, 0);
});

test("ogn-161-298 Deadbloom Predator: the occupied-enemy-battlefield permission is a static play-location effect", () => {
  // Contract 3.1's play ability only has `restriction` (a limitation), never a
  // permission field, so this follows the merged sfd-093-221 Dauntless Vanguard
  // shape: a static continuous effect consumed by the play-location pipeline.
  assert.equal(playPermission.kind, "static");
  assert.equal(playPermission.effect.kind, "play-location-permission");
  assert.equal(playPermission.effect.duration, "while-in-hand");
  assert.equal(playPermission.condition, undefined);
  assert.equal(playPermission.effect.value.kind, "constant");
  assert.deepEqual(playPermission.effect.value.value, {
    zone: "battlefield",
    battlefield: { occupied: true, controller: "opponent" },
    appliesTo: "self"
  });
});

test("ogn-161-298 Deadbloom Predator: the same shape is the one merged for sfd-093-221 Dauntless Vanguard", async () => {
  const dauntless = (await import("../../../dist/cards/sfd/dauntless-vanguard.js")).default;
  const [dauntlessAbility] = dauntless.abilities;
  assert.equal(dauntlessAbility.kind, playPermission.kind);
  assert.equal(dauntlessAbility.effect.kind, playPermission.effect.kind);
  assert.deepEqual(dauntlessAbility.effect.value, playPermission.effect.value);
  assert.equal(dauntlessAbility.effect.duration, playPermission.effect.duration);
  // The permission shape is shared — and so is the missing consumer, which is
  // why Dauntless Vanguard also carries a test.todo for it.
  assert.equal(dauntless.status, "executable");
  assert.equal(program.status, "judge-required");
});

test("ogn-161-298 Deadbloom Predator: the merged Deflect KeywordDef emits only the target tax (809.1.c)", () => {
  const deflectDef = keywordDefinitionsById.get("Deflect");
  assert.ok(deflectDef, "Deflect KeywordDef must be registered");
  const [expanded] = deflectDef.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.effect.kind, "target.tax");
  assert.deepEqual(expanded.effect.value, { kind: "constant", value: 1 });
});

test.todo(
  "ogn-161-298 Deadbloom Predator: the Deflect target tax (809.1.c/d) needs a consumer that reads the " +
    "expanded target.tax effect during target finalization and folds it into the cost plan (contract 3.8 " +
    "item 4; RIFT-89 cost plan / RIFT-90 target tax)."
);
test.todo(
  "ogn-161-298 Deadbloom Predator: the static play-location permission (170.11.a occupied enemy " +
    "battlefield; 420.3.b.2 Finalize check) needs a consumer in the play-location pipeline."
);
