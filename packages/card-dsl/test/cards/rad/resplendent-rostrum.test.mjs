import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/resplendent-rostrum.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-3fbe07d45b81cd1a97249fa165c6aa18b0f3350d24e4eaf06e090a22035f70d4";
const [activated, triggered] = program.abilities;
const [drawOne, channelOne] = activated.body;
const grantMight = triggered.body[0];

test("rad-046-167 Resplendent Rostrum: program passes validateCardProgram and keeps the catalog text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Draw 1 and channel 1 rune exhausted.\n" +
      "When I become exhausted, give a friendly unit +3 :rb_might: this turn."
  );
});

test("rad-046-167 Resplendent Rostrum: judge-required naming the missing temporary Might primitive", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /702/);
});

test("rad-046-167 Resplendent Rostrum: exhaust-costed activated ability with Draw 1 and channel 1 exhausted", () => {
  assert.equal(program.abilities.length, 2);

  // The printed ":rb_exhaust:" is the whole activation cost (415.3/415.3.a is
  // the Limited-Action description; the cost itself is the merged cost planner's
  // nonstandard "exhaust" payment). No Energy/Power is printed on this ability.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "cost.activated",
    payments: [{ kind: "exhaust" }]
  });
  assert.equal(activated.restriction, undefined);

  assert.deepEqual(activated.body.map((instruction) => instruction.id), [
    "resplendent-rostrum.draw-1",
    "resplendent-rostrum.channel-1"
  ]);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(channelOne.op, "effect.channel");
  assert.deepEqual(channelOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelOne.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelOne.linkedTo, "resplendent-rostrum.draw-1");
});

test("rad-046-167 Resplendent Rostrum: the become-exhausted trigger grants +3 Might for the turn", () => {
  assert.equal(triggered.kind, "triggered");
  // CR 415.1/415.1.c: becoming Exhausted is the merged "object-exhausted"
  // timing point; "I" scopes it to the source (415.2 makes the state readable).
  assert.equal(triggered.trigger.at, "object-exhausted");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-exhausted",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  assert.equal(grantMight.id, "resplendent-rostrum.grant-might");
  // No merged primitive performs a temporary Might modification; recorded with
  // the layers/continuous-effect shape (see judgeReason).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.targets, [
    {
      id: "resplendent-rostrum.unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grantMight.picks, undefined);
});

test("rad-046-167 Resplendent Rostrum golden: the activated body draws 1 and channels 1 rune exhausted", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .rune(["rune-1", "rune-2"])
    .build();
  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["resplendent-rostrum.draw-1", "executed"],
      ["resplendent-rostrum.channel-1", "executed"]
    ]
  );
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
  // CR 431.1/431.2: the printed exhausted stipulation is passed to the action.
  assert.equal(outcome.linkedValues["resplendent-rostrum.channel-1.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map((ref) => ref.id), ["rune-1"]);
});

test("rad-046-167 Resplendent Rostrum: the Might-grant op is not registered, so the trigger cannot resolve", () => {
  const kernel = world().unit("ally", { owner: "A", might: 2 }).build();
  kernel.setTargets("resplendent-rostrum.unit", [kernel.ref("ally")]);
  // The reference kernel compares filter scalars literally, so the production
  // "self" selector is substituted with the concrete controller for this run.
  const body = [{
    ...grantMight,
    targets: [{
      ...grantMight.targets[0],
      filter: { ...grantMight.targets[0].filter, controller: "A" }
    }]
  }];
  assert.throws(
    () => runAbilityBody(body, kernel),
    /Unregistered instruction opcode: continuous\.might/
  );
});

test.todo(
  "rad-046-167 Resplendent Rostrum: 'give a friendly unit +3 Might this turn' needs a " +
    "temporary-Might primitive (continuous.might with an end-of-turn duration); effect.buff only " +
    "covers CR 702 Buff counters and no card-facing primitive registers a continuous.might effect " +
    "through ctx.addContinuous (RIFT-91 layers-continuous)"
);
test.todo(
  "rad-046-167 Resplendent Rostrum: the activated ability's exhaust cost (415.3/415.3.a) and the " +
    "Gear's printed 8 Energy + 1 Calm Power need the Finalize cost plan adapter (RIFT-89)"
);
test.todo(
  "rad-046-167 Resplendent Rostrum: data issue — the official RAD-046/167 image shows a GEAR " +
    "(green banner) reading 'When this becomes exhausted, ...', while " +
    "packages/card-data/data/deck-catalog.json records cardType 'Spell' and 'When I become " +
    "exhausted'; reported by this task, not edited here"
);
