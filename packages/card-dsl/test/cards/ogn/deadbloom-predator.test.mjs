// RIFT-646 single-card golden: validation, identity, judgeReason and the key
// structure of Deadbloom Predator. The real execution evidence for this card
// (whole-card scenarios through the generic card harness plus the measured
// outcome of binding each expanded static ability) lives in
// `test/cards/templates/keyword-static-646.test.mjs`.
//
// The card stays judge-required: [Deflect]'s expanded `target.tax` and the
// printed play-location permission still have no layer mapping in
// `engine-core/src/programs/statics.ts`, so the template row records both as
// fail-closed. Nothing here approximates either ability.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/deadbloom-predator.js";
import { deflectCost } from "../../../../engine-core/dist/target/tax/collect.js";
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

test("ogn-161-298 Deadbloom Predator: judgeReason cites the two measured gaps", () => {
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /has no layer mapping/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /170\.11\.a/);
  assert.match(program.judgeReason, /420\.3\.b\.2/);
  // RIFT-360 is named only as the landed tax module, never as a pending dependency.
  assert.match(program.judgeReason, /RIFT-360 已合入/);
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

test("ogn-161-298 Deadbloom Predator: the merged Deflect KeywordDef emits only the target tax (809.1.c)", () => {
  const deflectDef = keywordDefinitionsById.get("Deflect");
  assert.ok(deflectDef, "Deflect KeywordDef must be registered");
  const [expanded] = deflectDef.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.effect.kind, "target.tax");
  assert.deepEqual(expanded.effect.value, { kind: "constant", value: 1 });
});

test("ogn-161-298 Deadbloom Predator: the permission shape is still the one merged for sfd-093-221 Dauntless Vanguard", async () => {
  // Same declared shape as Dauntless Vanguard, and the same missing consumer:
  // that card carries the identical static play-location-permission and is
  // marked executable, so the shared gap is tracked in both places.
  const dauntless = (await import("../../../dist/cards/sfd/dauntless-vanguard.js")).default;
  const [dauntlessAbility] = dauntless.abilities;
  assert.equal(dauntlessAbility.kind, playPermission.kind);
  assert.equal(dauntlessAbility.effect.kind, playPermission.effect.kind);
  assert.deepEqual(dauntlessAbility.effect.value, playPermission.effect.value);
  assert.equal(dauntlessAbility.effect.duration, playPermission.effect.duration);
  assert.equal(dauntless.status, "executable");
  assert.equal(program.status, "judge-required");
});

test("ogn-161-298 Deadbloom Predator: RIFT-360's tax module already prices the Deflect cost in any-domain Power", () => {
  // 809.1.c.1: the Deflect Power may be of any Domain. The merged module
  // produces a Power payment with all six domains allowed, so this half of the
  // chain is not the gap anymore; what remains is the layer mapping that would
  // feed it from the card's own static declaration.
  assert.deepEqual(deflectCost(1), {
    payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }]
  });
  assert.deepEqual(deflectCost(0), { payments: [{ kind: "power", amount: { kind: "constant", value: 0 }, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }] });
});

test.todo(
  "ogn-161-298 Deadbloom Predator: route the static target.tax expansion into the target-tax collector and " +
    "consume the play-location permission in the play Finalize (170.11.a occupied enemy battlefield; " +
    "420.3.b.2 Finalize check; 809.1.c/d) once programs/statics.ts maps both kinds"
);

