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
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
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
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-265/);
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

test("unl-165-219 Shadow's Call: the 'without [Temporary]' restriction has no keyword dimension in the merged filter", () => {
  // 816.3 makes "has Temporary" a readable characteristic, but the declared
  // withoutKeyword key is not a filter dimension in the merged matchers: the
  // layer matcher accepts a Temporary holder and a plain unit alike, and
  // dropping the key changes nothing. This is the evidence behind the
  // judgeReason, which names the missing restriction.
  const filter = grantTemporary.targets[0].filter;
  const withoutKey = Object.fromEntries(
    Object.entries(filter).filter(([key]) => key !== "withoutKeyword")
  );
  const kernel = world()
    .unit("plain", { owner: "A", might: 2, keywords: [] })
    .unit("temporary", { owner: "A", might: 2, keywords: [{ id: "Temporary" }] })
    .build();
  for (const id of ["plain", "temporary"]) {
    const snapshot = kernel.getObject(id);
    // 816.3: the whole point of the restriction is that these two differ; the
    // merged matcher returns the same answer for both because it has no keyword
    // dimension (the plain unit additionally fails only on the controller
    // placeholder, which the Finalize target pipeline resolves).
    assert.equal(
      matchesObjectFilter(withoutKey, snapshot),
      matchesObjectFilter(filter, snapshot)
    );
  }
  const plain = kernel.getObject("plain");
  const temporary = kernel.getObject("temporary");
  assert.equal(matchesObjectFilter(withoutKey, plain), matchesObjectFilter(withoutKey, temporary));
  assert.equal(withoutKey.withoutKeyword, undefined);
});

test.todo(
  "unl-165-219 Shadow's Call: grant [Temporary] to the chosen unit (CR 816.1.a: a characteristic of the permanent, " +
    "816.3 referenceable) end-to-end — the merged continuous.grant-keyword primitive and Temporary KeywordDef are " +
    "executed above and the layer engine reads the granted keyword; what is still open is the card-program -> " +
    "keyword-expansion -> timing/chain wiring (RIFT-257)"
);

test.todo(
  "unl-165-219 Shadow's Call: the Temporary trigger — kill the permanent at the start of its controller's Beginning " +
    "Phase, before scoring (CR 816.1.b/816.1.c) — the merged KeywordDef body executes above, but nothing subscribes " +
    "it to beginning-start for a card program (RIFT-257)"
);

test.todo(
  "unl-165-219 Shadow's Call: enforce 'without [Temporary]' as a targeting restriction (CR 355.9.b, 816.3) once the " +
    "filter vocabulary can read keyword characteristics (the merged matchers silently accept any unit)"
);

