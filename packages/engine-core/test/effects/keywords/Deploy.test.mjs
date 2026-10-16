import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";

import deploy from "../../../dist/effects/keywords/Deploy.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { isTimingPointId } from "../../../dist/events/timing-points.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = Object.freeze({ canonicalCardId: "rad-116-167" });

const program = abilities => ({
  canonicalCardId: HOST.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "[Deploy]"
});

test("Deploy metadata identifies an unvalued, single-stacking keyword", () => {
  assert.equal(deploy.keyword, "Deploy");
  assert.equal(deploy.valued, false);
  assert.equal(deploy.stacking, "single");
  for (const ref of ["830", "830.1", "830.1.b", "830.2", "830.3"]) {
    assert.ok(deploy.ruleRefs.includes(ref), `missing rule ref ${ref}`);
  }
});

test("Deploy expands to a continuous.location permission covering play and create", () => {
  const [location] = deploy.expand({ host: HOST });
  assert.equal(location.kind, "static");
  assert.equal(location.effect.kind, "continuous.location");
  assert.equal(location.effect.appliesTo, "self");
  assert.equal(location.effect.objectType, "gear");
  assert.deepEqual(location.effect.play, {
    zone: "battlefield",
    anyBattlefield: true,
    includesOccupied: true,
    includesEnemyControlled: true
  });
  assert.deepEqual(location.effect.create, location.effect.play);
  assert.deepEqual(location.effect.destinationRestriction, { zone: "battlefield" });
  assert.deepEqual(location.effect.movement, { allowed: true });
  assert.deepEqual(location.effect.cleanup, { recall: "unit-only" });
});

test("Deploy registers one mandatory opponent-Hold trigger that kills itself", () => {
  const abilities = deploy.expand({ host: HOST });
  assert.equal(abilities.length, 2);
  const trigger = abilities[1];
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.optional, false);
  assert.equal(trigger.trigger.at, "hold");
  assert.equal(isTimingPointId(trigger.trigger.at), true);
  assert.deepEqual(trigger.trigger.filter, { event: "hold", here: true, player: "opponent" });
  assert.equal(trigger.body.length, 1);
  assert.equal(trigger.body[0].op, "effect.kill");
  assert.deepEqual(trigger.body[0].args, { self: { kind: "constant", value: true } });
});

test("Deploy expansion validates as an EffectIR CardProgram", () => {
  const result = validateCardProgram(program(deploy.expand({ host: HOST })));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Deploy is redundant when granted more than once", () => {
  assert.equal(deploy.stacking, "single");
  const first = deploy.expand({ host: HOST });
  const merged = deploy.expand({ host: HOST, value: 2 });
  assert.deepEqual(merged, first);
  assert.equal(merged.length, 2);
});

test("Deploy ignores accidental numeric values because it is unvalued", () => {
  assert.deepEqual(
    deploy.expand({ host: HOST, value: 0 }),
    deploy.expand({ host: HOST, value: Number.MAX_SAFE_INTEGER })
  );
});

test("Deploy keeps the location and cleanup clauses together in one static ability", () => {
  const abilities = deploy.expand({ host: HOST });
  assert.equal(abilities.filter(ability => ability.kind === "static").length, 1);
  assert.equal(abilities.filter(ability => ability.kind === "triggered").length, 1);
  const effect = abilities[0].effect;
  assert.equal(effect.play.zone, "battlefield");
  assert.equal(effect.create.zone, "battlefield");
  assert.equal(effect.cleanup.recall, "unit-only");
});

test("Deploy kill body executes through the merged effect.kill reference kernel", () => {
  const base = world().object("deploy-gear", {
    owner: "A",
    zone: "board",
    types: ["gear"],
    location: { type: "battlefield", id: "bf-1" }
  }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("deploy-gear") });
  const trigger = deploy.expand({ host: HOST })[1];
  const outcome = runAbilityBody(trigger.body, kernel, instructionDefinitionsById);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("deploy-gear")?.zone, "trash");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("Deploy kill body is ignored when its host is no longer on the board", () => {
  const kernel = world().object("deploy-gear", {
    owner: "A",
    zone: "hand",
    types: ["gear"]
  }).build();
  const trigger = deploy.expand({ host: HOST })[1];
  const outcome = runAbilityBody(trigger.body, kernel, instructionDefinitionsById);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test("Deploy is available from the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Deploy"), deploy);
});
