import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadows-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import grant from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-20160abc2cd3adac87c1b0f03192e12ab9103b22ffbd5a8468e4072e00264025";
const SOURCE_TEXT =
  "Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [play] = program.abilities;
const [grantTemporary, drawInstruction] = play.body;
const executableDraw = (() => {
  const { targets, ...rest } = drawInstruction;
  return rest;
})();
// The grant names the same TargetSpec through the contract 3.6 selector; the
// kernel owns the locked choice, so the TargetSpecs are removed before running
// the card's original instruction (the spirits-refuge / bounty-hunter convention).
const executableGrant = (() => {
  const { targets, ...rest } = grantTemporary;
  return rest;
})();

test("unl-165-219 Shadow's Call: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /816\.3/);
  assert.match(program.judgeReason, /withoutKeyword/);
  assert.match(program.judgeReason, /addContinuous/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
});

test("unl-165-219 Shadow's Call: printed 2 energy, no printed power, and one chosen friendly unit", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  // 355.5 / 355.7: "Choose a friendly unit" is a targeting choice; the
  // "without [Temporary]" restriction (816.3) stays descriptive (judgeReason).
  assert.equal(grantTemporary.op, "continuous.grant-keyword");
  assert.deepEqual(grantTemporary.args.keyword, { kind: "constant", value: "Temporary" });
  // 355.10.c: "it" is the chosen unit, not a new choice; the selector is the
  // contract 3.6 symbolic spelling of the declared TargetSpec.
  assert.deepEqual(grantTemporary.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "shadows-call.friendly-unit" }
  });
  assert.equal(grantTemporary.args.target, undefined);
  assert.deepEqual(grantTemporary.targets, [
    {
      id: "shadows-call.friendly-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        withoutKeyword: "Temporary"
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grantTemporary.linkedTo, undefined);
});

test("unl-165-219 Shadow's Call: the Draw 2 sentence is independent of the keyword grant", () => {
  assert.equal(drawInstruction.id, "shadows-call.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  // Two printed sentences: linking them would let an impossible grant suppress
  // the draw (055 / 359.3.e.11).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
});

test("unl-165-219 Shadow's Call golden: the merged Draw 2 half draws two cards", () => {
  const kernel = world().deck(["top", "second", "third"]).build();
  const outcome = resolveChainBody([executableDraw], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["shadows-call.draw.drawn"], 2);
  assert.equal(outcome.linkedValues["shadows-call.draw.drawnTo"], "A");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top", "second"]);
});

test("unl-165-219 Shadow's Call golden: a short deck draws as much as possible (414.4)", () => {
  const kernel = world().deck("only-card").build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("unl-165-219 Shadow's Call golden: Draw 2 still executes when the locked grant target is gone", () => {
  const kernel = world().deck(["top", "second", "third"]).build();
  kernel.setTargets("shadows-call.friendly-unit", []);
  const result = resolveChainBody([executableGrant, executableDraw], kernel);
  assert.deepEqual(result.results.map(entry => [entry.id, entry.result.status]), [
    [grantTemporary.id, "ignored"], [drawInstruction.id, "executed"]
  ]);
  assert.equal(result.results[0].result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top", "second"]);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(result.linkedValues[`${drawInstruction.id}.drawn`], 2);
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
});

test("unl-165-219 Shadow's Call golden: the merged grant registers Temporary on the chosen unit (CR 816.1.a)", () => {
  // The card's own instruction runs through the merged interpreter: the
  // continuous.grant-keyword primitive commits one ability-layer registration
  // and the layer engine then exposes Temporary on the chosen unit.
  const kernel = world()
    .unit("caster", { owner: "A", types: ["spell"], zone: "board" })
    .unit("chosen", { owner: "A", might: 2, keywords: [] })
    .unit("other", { owner: "A", might: 2, keywords: [] })
    .build();
  kernel.setTargets("shadows-call.friendly-unit", [kernel.ref("chosen")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("caster") });
  const run = runInstruction(grant, executableGrant.args, { world: context });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.granted.count, 1);
  assert.deepEqual(run.linked.granted.objects, [kernel.ref("chosen")]);
  assert.equal(context.continuousEffects.length, 1);

  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layered = createLayerEngine(context.objects, registrations);
  const chosen = layered.evaluate(context.ref("chosen"));
  assert.deepEqual(chosen.keywords.map((keyword) => keyword.id), ["Temporary"]);
  assert.deepEqual(layered.evaluate(context.ref("other")).keywords, []);
});

test("unl-165-219 Shadow's Call golden: the merged Temporary expansion kills the host (CR 816.1.b)", () => {
  // 816.1.b/816.1.c: Temporary is functionally "at the start of this permanent's
  // controller's Beginning Phase, before scoring, kill this". The merged
  // KeywordDef supplies the trigger and the merged effect.kill performs it.
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  const [trigger] = temporary.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "beginning-start");
  assert.equal(trigger.optional, false);

  const kernel = world().unit("granted", { owner: "A", might: 2, keywords: [{ id: "Temporary" }] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("granted") });
  const outcome = resolveChainBody(trigger.body, context);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(context.getObject("granted").zone, "trash");
});

test.todo(
  "unl-165-219 Shadow's Call: enforce without Temporary against live keyword characteristics during Finalize and Resolve (CR 355.9.b/816.3)"
);
test.todo(
  "unl-165-219 Shadow's Call: refresh the host's beginning-start subscription when a continuous effect grants Temporary to an existing permanent (CR 816.1.b/816.1.c); general program lifecycle binding is already merged"
);
