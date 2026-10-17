import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/lux-illuminated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-c2754bbf1ee513e71200b5c341447c73af45af5ba81a41efde12ac2d348cbcd8";
const SOURCE_TEXT =
  "When you play a spell that costs :rb_energy_5: or more, give me +3 :rb_might: this turn.";

const [ability] = program.abilities;
const [grantMight] = ability.body;

const registrations = (kernel) =>
  kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

test("ogs-006-024 Lux, Illuminated: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-006-024 Lux, Illuminated: judgeReason names the current event-payload cost gap and the merged Might/trigger primitives", () => {
  assert.match(program.judgeReason, /energyGte/);
  assert.match(program.judgeReason, /translateTriggerFilter/);
  assert.match(program.judgeReason, /testTrigger/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
});

test("ogs-006-024 Lux, Illuminated: card-played trigger with the descriptive energy gate and a temporary +3 Might body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  // The energy gate is a descriptive placeholder: the card-played event carries
  // no cost payload and the frozen vocabulary has no numeric comparison over an
  // event object's characteristics; the key is named in judgeReason as having
  // no formal semantics.
  assert.deepEqual(ability.trigger.filter, {
    type: "spell",
    controller: "controller",
    energyGte: 5
  });
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 1);
  assert.equal(grantMight.id, "lux-illuminated.grant-might");
  // "give me +3 :rb_might: this turn": a duration-bounded Might modification
  // (CR 143.2) carried by the merged continuous.might primitive, not a Buff.
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test("ogs-006-024 Lux, Illuminated: the merged trigger translation resolves the equal-value half of the descriptive energy gate", () => {
  // The card-played event payload carries no cost, so the numeric energy gate
  // stays descriptive (judgeReason). The merged translation resolves the
  // equal-value half: controller is normalized to "self", the object filter
  // matches a spell played by the source's controller, and the descriptive
  // energyGte key is rejected by the whitelist (asserted below).
  const base = world().unit("lux", { zone: "board" }).build();
  const played = base.getObject("lux");
  assert.throws(() => translateTriggerFilter(ability.trigger.filter, played.ref.id, "card-played"), (error) => {
    assert.ok(error instanceof ProgramBindingError);
    assert.match(error.message, /Unsupported filter field energyGte/);
    return true;
  });
  const pattern = translateTriggerFilter(
    { type: "spell", controller: "controller" },
    played.ref.id,
    "card-played"
  );
  // The flat filter is passed through as the pattern's object filter (the
  // translation only wraps keys like source/self/object into pattern.object).
  assert.deepEqual(pattern, { type: "spell", controller: "self" });
  assert.equal(matchesTriggerEvent(pattern, { timingPoint: "card-played", object: { ...played, types: ["spell"] }, player: "A" }, "A"), true);
  assert.equal(matchesTriggerEvent(pattern, { timingPoint: "card-played", object: { ...played, types: ["gear"] }, player: "A" }, "A"), false);
  // A flat filter has no pattern.player, so the event player is not compared;
  // an explicit player selector is what the production pipeline gets from
  // cards that name the player (like Might of Demacia's player: "self").
  assert.equal(matchesTriggerEvent({ ...pattern, player: "self" }, { timingPoint: "card-played", object: { ...played, types: ["spell"] }, player: "B" }, "A"), false);
});

test("ogs-006-024 Lux, Illuminated golden: the body registers +3 Might in the arithmetic layer until end of turn", () => {
  const base = world().unit("lux", { zone: "board", might: 5 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("lux") });

  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["lux-illuminated.grant-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: Might modifications live in the arithmetic layer.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.effect.filter.objectId, "lux");
  // 317.1.a / 468.7.c: "this turn" expires in the Expiration Step.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "lux"), 8);

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("lux")).might, 5);
});

test("ogs-006-024 Lux, Illuminated golden: a source that left the Board registers nothing (CR 359.3.e.6)", () => {
  const base = world().unit("lux", { zone: "trash", might: 5 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("lux") });

  const outcome = resolveChainBody(ability.body, kernel);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "ogs-006-024 Lux, Illuminated: the trigger only fires for a played spell whose cost is 5+ energy " +
    "(CR 383.4.a, 420.4.a, 355.9) — the card-played event payload carries no cost and the frozen " +
    "EventPattern/ObjectFilter vocabulary has no numeric >= comparison over an event object's " +
    "characteristics; trigger registration with a condition needs a host testTrigger adapter and " +
    "translateTriggerFilter rejects the descriptive energyGte key (contract change request)"
);
