import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/turn-to-dust.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
const CANONICAL_ID =
  "card.hash-d499c08d49d46da72e1362f82b24b913abf3b6fbc0e80676cbb858f169d91e75";
const SOURCE_TEXT =
  "Give a gear [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [play] = program.abilities;
const [grant] = play.body;

test("unl-070-219 Turn to Dust: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-070-219 Turn to Dust: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.keyword|continuous\.grant-keyword/);
  assert.match(program.judgeReason, /816/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /beginning-start/);
});

test("unl-070-219 Turn to Dust: one play ability granting Temporary to one gear target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // The spell itself prints no cost line for this half; the printed 2 energy
  // comes from the card catalog at Finalize (356.1.c), so no CostSpec is
  // re-stated here.
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(grant.id, "turn-to-dust.grant-temporary");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Temporary" });
  // 355.9.a.1 / 355.7: "a gear" is a chosen Board object, i.e. a target.
  assert.deepEqual(grant.targets, [
    {
      id: "turn-to-dust.gear",
      filter: { zone: "board", type: "gear" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grant.picks, undefined);
  assert.equal(grant.linkedTo, undefined);
});

test("unl-070-219 Turn to Dust golden: the grant registers a Temporary ability-layer keyword on the locked gear", () => {
  const kernel = world().unit("gear-a", { types: ["gear"], might: null }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("gear-a") });
  ctx.setTargets("turn-to-dust.gear", [kernel.ref("gear-a")]);
  const outcome = resolveChainBody(play.body, ctx);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["turn-to-dust.grant-temporary", "executed"]]
  );
  // 478.1.a: keyword grants live in the ability layer; 816.3 makes Temporary a
  // readable characteristic of the permanent.
  assert.equal(ctx.continuousEffects.length, 1);
  const [registration] = ctx.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Temporary");
  assert.deepEqual(registration.effect.filter.objectId, "gear-a");

  const engine = createLayerEngine(ctx.objects, ctx.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 })));
  assert.deepEqual(engine.evaluate(ctx.ref("gear-a")).keywords.map(keyword => keyword.id), ["Temporary"]);
});

test("unl-070-219 Turn to Dust golden: a gear that left the Board is mistargeted and nothing is granted", () => {
  const kernel = world().unit("gear-a", { types: ["gear"], might: null }).build();
  const stale = kernel.ref("gear-a");
  // 124: a zone change invalidates the old reference; the Finalize-locked
  // target no longer resolves (359.3.e.6), so the grant is ignored.
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("gear-a") });
  ctx.setTargets("turn-to-dust.gear", [stale]);
  const outcome = resolveChainBody(play.body, ctx);

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["turn-to-dust.grant-temporary", "ignored", "mistargeted"]]
  );
  assert.equal(ctx.continuousEffects.length, 0);
});

test("unl-070-219 Turn to Dust golden: the granted Temporary expansion is a real 816.1.b kill of the host", async () => {
  // RIFT-265's Temporary KeywordDef really expands to the 816.1.b trigger body;
  // the golden executes that body (the missing half is only its registration
  // when the keyword is granted at runtime - see judgeReason).
  const { default: temporary } = await import("../../../../engine-core/dist/effects/keywords/Temporary.js");
  const [expansion] = temporary.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.trigger.at, "beginning-start");
  const kernel = world().unit("gear-a", { types: ["gear"], might: null }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("gear-a") });
  const { runAbilityBody } = await import("../../../../engine-core/dist/effects/interpreter.js");
  const outcome = runAbilityBody(expansion.body, ctx);
  assert.equal(outcome.status, "executed");
  assert.equal(ctx.getObject("gear-a").zone, "trash");
  assert.deepEqual(ctx.events.map(event => event.action), ["kill"]);
});

test.todo(
  "unl-070-219 Turn to Dust: the granted [Temporary] trigger (CR 816.1.b) killing the gear at the start of its " +
    "controller's Beginning Phase through the keyword expansion and trigger pipeline - runtime keyword grants must be " +
    "expanded into TriggerRegistrations by the production layer assembly with a lifecycle binder for triggered keyword " +
    "abilities, and beginning-start must join the closed event-pattern vocabulary"
);
