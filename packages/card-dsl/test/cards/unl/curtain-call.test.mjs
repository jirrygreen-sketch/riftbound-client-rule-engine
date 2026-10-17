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
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  // Re-probed 2026-10-17: the Repeat costs are refused on both declaration
  // paths, the mode memory is missing, and the production surface still blocks
  // choice.mode.
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /repeat\.cost/);
  assert.match(program.judgeReason, /820\.2\.a/);
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

test("unl-182-219 Curtain Call boundary: neither Repeat declaration reaches Finalize (CR 820.1.c.1/820.1.c.2)", () => {
  // Re-probed 2026-10-17: the play ability's additional-cost declaration is
  // refused by the production cost translator, and the Repeat keyword's own
  // repeat.cost static effect has no layer mapping in the production binder.
  // Finalize therefore never selects or pays an instance, and no paid-instance
  // count exists for an extra execution.
  assert.equal(play.cost.kind, "additional-cost");
  assert.throws(
    () => translateCost(play.cost, "curtain-call", "play"),
    (error) => error.code === "judge-required" && /Unsupported play cost field keyword/.test(error.message)
  );
  const repeat = keywordDefinitionsById.get("Repeat");
  const [repeatCost] = repeat.expand({ host: { canonicalCardId: CANONICAL_ID }, cost: play.cost.costs[0] });
  assert.equal(repeatCost.effect.kind, "repeat.cost");
  const board = fixture({
    cards: [{ id: "curtain-call", cardId: CANONICAL_ID, types: ["spell"], energy: 4, power: null, might: null }]
  });
  assert.throws(
    () => createEngineStaticBinder(board.engine).bindStatic(repeatCost, board.kernel.getObject("curtain-call")),
    (error) => error.code === "judge-required" && /repeat\.cost/.test(error.message) && /no layer mapping/.test(error.message)
  );
});

test("unl-182-219 Curtain Call boundary: mode selection has no per-spell memory and the production chain blocks choice.mode (CR 355.3/820.2.a)", () => {
  // The interpreter de-duplicates only inside one request, so a second execution
  // would ask "one you haven't already chosen" without remembering the first.
  // Driving the same body twice shows the second request still offers all four
  // modes, and the production surface refuses the body outright.
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("curtain-call.battlefield-unit", [kernel.ref("bf-unit")]);
  const asked = [];
  const chooser = (request) => {
    if (request.type === "select-objects") return [...request.options];
    if (request.type !== "mode") throw new Error(`Unexpected choice ${request.type}`);
    asked.push([...request.options]);
    // Always answer with the first mode: a per-spell memory would exclude it
    // from the next request instead of offering it again.
    return request.options[0];
  };
  const context = bindResolveContext(kernel, { choose: chooser });
  resolveChainBody(executableBody(play.body), context);
  resolveChainBody(executableBody(play.body), context);
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[0], modes.map((mode) => mode.id));
  assert.deepEqual(asked[1], asked[0]);

  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const board = fixture({ cards: [{ id: "caster", cardId: CANONICAL_ID, types: ["spell"], energy: 4, power: null, might: null }] });
  assert.throws(
    () => binding.describePlay({ type: "play", player: "A", object: board.kernel.ref("caster") }, board.kernel.getObject("caster")),
    (error) => error.constructor.name === "ProgramBindingError" && /Mode choices require a Finalize\/Resolve choice-plan adapter/.test(error.message)
  );
});

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
