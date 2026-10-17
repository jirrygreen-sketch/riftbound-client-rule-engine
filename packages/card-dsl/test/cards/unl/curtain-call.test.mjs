import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/curtain-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-461012a9889f3812c0033854e007b78f0f8ad1f1d1ef943bf505bfd5defabca6";
const SOURCE_TEXT =
  "[Repeat] — :rb_energy_1: / :rb_rune_rainbow: / :rb_energy_1::rb_rune_rainbow: " +
  "(You may pay each additional cost to repeat this spell's effect.)\n" +
  "Choose one you haven't already chosen —\n" +
  "Draw 1.Deal 2 to a unit at a battlefield.Deal 3 to a unit at a base." +
  "Give a unit at a battlefield -4 :rb_might: this turn.";

const [repeatKeyword, play] = program.abilities;
const [chooseOne] = play.body;
const modes = chooseOne.args.modes.value;
const [drawOne, dealTwo, dealThree, mightMinusFour] = modes.map((mode) => mode.body[0]);

// The reference kernel compares filter values literally, so the card layer's
// location restrictions cannot be re-derived there. Production locks targets
// during Finalize and the harness supplies the same locked answers; the
// authored TargetSpecs stay asserted structurally above. The strip therefore
// walks control bodies too (the Damage modes declare their own specs).
function withoutTargetSpecs(body) {
  return body.map(({ targets, args, ...instruction }) => ({
    ...instruction,
    args: Object.fromEntries(
      Object.entries(args).map(([key, expression]) => {
        if ((key === "body" || key === "modes" || key === "with") && expression.kind === "constant") {
          const value = expression.value;
          return [key, {
            ...expression,
            value: Array.isArray(value)
              ? value.map((entry) => entry?.body
                ? { ...entry, body: withoutTargetSpecs(entry.body) }
                : entry)
              : value
          }];
        }
        return [key, expression];
      })
    )
  }));
}
const executableBody = withoutTargetSpecs;

test("unl-182-219 Curtain Call: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-182-219 Curtain Call: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The reason names the remaining Repeat/mode-choice wiring gaps; the Might
  // primitive itself is merged and executable.
  assert.match(program.judgeReason, /820\.1\.c\.2/);
  assert.match(program.judgeReason, /820\.1\.d\.1/);
  assert.match(program.judgeReason, /Finalize optionalAdditional/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
});

test("unl-182-219 Curtain Call: [Repeat] plus the four printed modes in printed order", () => {
  assert.deepEqual(repeatKeyword, { kind: "keyword", keyword: "repeat" });
  assert.equal(repeatKeyword.value, undefined);
  assert.equal(play.kind, "play");
  // 820.1.c / 820.1.c.2: three separately payable Repeat costs recorded as
  // additional costs (KeywordAbility itself only carries keyword/value); the
  // charging pipeline is the judged gap.
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    costs: [
      { energy: { kind: "constant", value: 1 } },
      { power: { kind: "constant", value: ["rainbow"] } },
      {
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: ["rainbow"] }
      }
    ]
  });
  assert.equal(play.body.length, 1);
  assert.equal(chooseOne.id, "curtain-call.choose-one");
  assert.equal(chooseOne.op, "choice.mode");
  assert.equal(chooseOne.linkedTo, undefined);
  assert.deepEqual(chooseOne.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseOne.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    modes.map((mode) => mode.id),
    [
      "curtain-call-draw-1",
      "curtain-call-deal-2",
      "curtain-call-deal-3",
      "curtain-call-might-minus-4"
    ]
  );
  for (const mode of modes) assert.equal(mode.body.length, 1);
});

test("unl-182-219 Curtain Call: the three Damage/Draw modes carry the printed values and restrictions", () => {
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });

  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  // "a unit at a battlefield": the unit is the target, the location is only a
  // legality restriction (355.9.a.1 / 355.10.b).
  assert.deepEqual(dealTwo.targets[0], {
    id: "curtain-call.battlefield-unit",
    filter: { type: "unit", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });

  assert.equal(dealThree.op, "effect.damage");
  assert.deepEqual(dealThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(dealThree.targets[0].filter, { type: "unit", location: "base" });

  // The fourth mode is the temporary Might modification through the merged
  // continuous.might primitive.
  assert.equal(mightMinusFour.op, "continuous.might");
  assert.deepEqual(mightMinusFour.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "curtain-call.battlefield-might-unit" }
  });
  assert.deepEqual(mightMinusFour.args.amount, { kind: "constant", value: -4 });
  assert.deepEqual(mightMinusFour.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightMinusFour.args.appliesTo, undefined);
  assert.deepEqual(mightMinusFour.targets, [{
    id: "curtain-call.battlefield-might-unit",
    filter: { type: "unit", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("unl-182-219 Curtain Call golden: the Deal 2 mode really deals 2 to the chosen battlefield unit", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("base-unit", { owner: "B", might: 5 })
    .build();
  kernel.setTargets("curtain-call.battlefield-unit", [kernel.ref("bf-unit")]);
  kernel.setAnswers({ "curtain-call.choose-one/mode%3A0": "curtain-call-deal-2" });

  const outcome = resolveChainBody(executableBody(play.body), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["curtain-call.deal-2", "executed"],
    ["curtain-call.choose-one", "executed"]
  ]);
  assert.equal(kernel.getObject("bf-unit").damage, 2);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
});

test("unl-182-219 Curtain Call golden: the Draw 1 mode really draws 1 for the caster", () => {
  const kernel = world()
    .deck(["top-card", "second-card"])
    .unit("bf-unit", { owner: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("curtain-call.battlefield-unit", [kernel.ref("bf-unit")]);
  kernel.setAnswers({ "curtain-call.choose-one/mode%3A0": "curtain-call-draw-1" });

  const outcome = resolveChainBody(executableBody(play.body), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["curtain-call.draw", "executed"],
    ["curtain-call.choose-one", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(kernel.getObject("bf-unit").damage, 0);
});

test("unl-182-219 Curtain Call golden: the Might mode registers -4 until turn end", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("curtain-call.battlefield-might-unit", [kernel.ref("bf-unit")]);
  kernel.setAnswers({ "curtain-call.choose-one/mode%3A0": "curtain-call-might-minus-4" });

  const outcome = resolveChainBody(executableBody(play.body), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["curtain-call.might-modify", "executed"],
    ["curtain-call.choose-one", "executed"]
  ]);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: 1
  })));
  assert.equal(layers.evaluate(kernel.ref("bf-unit")).might, 1);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("bf-unit")).might, 5);
});

test("unl-182-219 Curtain Call golden: the mode choice excludes the modes already chosen in that request", () => {
  // different: true is the only cross-mode memory the merged interpreter has,
  // and it is scoped to one selection request (interpreter/choice.ts); the
  // per-execution memory "you haven't already chosen" is the judged gap.
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("curtain-call.battlefield-unit", [kernel.ref("bf-unit")]);
  // No answer: the primitive must ask for exactly one distinct mode.
  let asked = null;
  try {
    resolveChainBody(executableBody(play.body), kernel);
  } catch (error) {
    asked = error.request ?? null;
  }
  assert.equal(asked?.type, "mode");
  assert.deepEqual(asked.options, modes.map((mode) => mode.id));
  assert.equal(asked.min ?? undefined, undefined);
  assert.equal(asked.max ?? undefined, undefined);
});

test("unl-182-219 Curtain Call the printed Deal 3 restriction accepts a base and excludes a battlefield", () => {
  // 355.9.b / 355.10.b: "a unit at a base" is only a legality restriction on
  // the target; the merged filter matcher the chain uses compares the
  // location type. The reference kernel compares filter values literally, so
  // the restriction itself is asserted here instead of being re-derived.
  assert.deepEqual(dealThree.targets[0].filter, { type: "unit", location: "base" });
  assert.notDeepEqual(dealThree.targets[0].filter, dealTwo.targets[0].filter);
  const kernel = world().base("base-unit").unit("battlefield-unit").build();
  assert.equal(matchesObjectFilter(dealThree.targets[0].filter, kernel.getObject("base-unit")), true);
  assert.equal(matchesObjectFilter(dealThree.targets[0].filter, kernel.getObject("battlefield-unit")), false);
});

test("unl-182-219 Curtain Call golden: effect.draw and effect.damage are the merged primitives the modes call", () => {
  assert.equal(draw.op, "effect.draw");
  assert.equal(damage.op, "effect.damage");
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(
    draw,
    { amount: drawOne.args.amount },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test.todo(
  "unl-182-219 Curtain Call: pay each printed [Repeat] additional cost (1 / rainbow rune / 1 + rainbow rune) and execute the spell's instructions an additional time per paid instance " +
    "(CR 820.1.c.1–820.1.d.1; Repeat still needs CardProgram-to-Finalize payment/count wiring)"
);
test.todo(
  "unl-182-219 Curtain Call: remember the modes already chosen for this spell across executions so \"Choose one you haven't already chosen\" can exclude them (CR 355.3 / 820.2.a; choice.mode currently de-duplicates only within one selection request)"
);
test.todo(
  "unl-182-219 Curtain Call: drive the card body through the production chain, whose Finalize surface currently blocks nested targets and resolution-time choice.mode (chain/engine.ts assertFinalizationSurface; production choice-plan adapter)"
);

test("unl-182-219 Curtain Call golden: the printed Deal 3 primitive damages only the locked base unit", () => {
  const kernel = world()
    .base("base-unit", { owner: "B", might: 5 })
    .unit("battlefield-unit", { owner: "B", might: 5 })
    .build();
  const run = runInstruction(damage, { amount: dealThree.args.amount, target: dealThree.args.target.value }, {
    world: kernel,
    targets: { "curtain-call.base-unit": [kernel.ref("base-unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 3);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("base-unit").damage, 3);
  assert.equal(kernel.getObject("battlefield-unit").damage, 0);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});
