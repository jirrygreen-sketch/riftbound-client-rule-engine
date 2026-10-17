import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/deadbloom-predator.js";
import { deflectCost, collectTargetTaxes } from "../../../../engine-core/dist/target/tax/collect.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { playLocations } from "../../../../engine-core/dist/layers/rules/query.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-c615c988d8b72525a349735e8c5029acbffec25179ae7427d5f8bc8aff9333b4";

const [deflect, playPermission] = program.abilities;
const forged = { ...program, status: "executable", judgeReason: undefined };

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

test("ogn-161-298 Deadbloom Predator: the production static binder rejects both declared statics (current gap)", () => {
  // effects/keywords/Deflect.ts declares only static target.tax, and the card
  // declares only static play-location-permission. programs/statics.ts layerFor
  // has no mapping for either kind, so a real attachLifecycle binds nothing.
  const state = fixture({ cards: [{ id: "predator", cardId: CANONICAL, types: ["unit"], might: 8 }] });
  const errors = [];
  createProgramBinding({ cardPrograms: [forged] }).attachLifecycle(state.engine, error => errors.push(String(error && error.message)));
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("predator"), to: "board", location: { type: "base", player: "A" } });

  assert.deepEqual(errors, [
    "Static ability kind play-location-permission has no layer mapping",
    "Static ability kind target.tax has no layer mapping"
  ]);
  assert.deepEqual(state.engine.layers.registry.list(), []);
  // And with nothing registered, the play-location query sees no permission.
  assert.deepEqual(playLocations(state.engine.layers.registry), { permissions: [], restrictions: [] });
});

test("ogn-161-298 Deadbloom Predator: nothing forwards the card's static tax into a real target resolution", () => {
  // The tax collector derives amounts from snapshot keywords / supplied
  // bindings. The card's own static `target.tax` never reaches it because no
  // binding consumes that static kind, so an opponent targeting this unit pays
  // no tax today.
  const kernel = world()
    .unit("predator", { owner: "B", controller: "B", might: 8, keywords: [] })
    .player("A")
    .build();
  const context = bindResolveContext(kernel, { source: kernel.getObject("predator"), controller: "A" });
  const taxes = collectTargetTaxes(context, kernel.getObject("predator"), { kind: "spell" });
  assert.deepEqual(taxes, []);

  // Control: the same collector does price Deflect when the snapshot carries
  // the keyword, which is what the unbound static expansion would have to do.
  const granted = world()
    .unit("predator", { owner: "B", controller: "B", might: 8, keywords: [{ id: "Deflect" }] })
    .player("A")
    .build();
  const grantedContext = bindResolveContext(granted, { source: granted.getObject("predator"), controller: "A" });
  const grantedTaxes = collectTargetTaxes(grantedContext, granted.getObject("predator"), { kind: "spell" });
  assert.equal(grantedTaxes.length, 1);
  assert.equal(grantedTaxes[0].stage, "mandatory-additional");
  assert.deepEqual(grantedTaxes[0].cost, deflectCost(1));
});

test.todo(
  "ogn-161-298 Deadbloom Predator: route the static target.tax expansion into the target-tax collector and " +
    "consume the play-location permission in the play Finalize (170.11.a occupied enemy battlefield; " +
    "420.3.b.2 Finalize check; 809.1.c/d) once programs/statics.ts maps both kinds"
);

