import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rocket-barrage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { AwaitChoice, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder, staticCostSources } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";

const CANONICAL_ID = "card.hash-b104ab4f2d5ede379d04e1002cd97a70d95148d73cddde15852f5dce8b204e9e";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_4::rb_rune_mind: (You may pay the additional cost to repeat this spell's effect, and may make different choices.)\n" +
  "Choose one —\n" +
  "Deal 4 to a unit in a base.Kill a gear.";

const [play] = program.abilities;
const [choice] = play.body;
const [damageMode, killMode] = choice.args.modes.value;
const [damage] = damageMode.body;
const [kill] = killMode.body;

/**
 * The reference kernel compares filter values literally; the production chain
 * query (chain/engine.ts) normalizes controller "opponent" and the layer
 * matcher (layers/filter.ts) understands a location-type string. Reproduce
 * those paths so the card's own TargetSpecs are what execute.
 */
function productionQuery(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          if (typeof normalized.location === "string") delete kernelFilter.location;
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller))
            .filter((object) => normalized.location === undefined || typeof normalized.location !== "string" ||
              (object.location !== null && object.location.type === normalized.location));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function freshKernel() {
  const kernel = world()
    .unit("base-unit", { owner: "B", controller: "B", might: 6, location: { type: "base", player: "B" } })
    .card("gear", { owner: "B", controller: "B", types: ["gear"], zone: "board" })
    .build();
  kernel.setTargets("rocket-barrage.unit-in-base", [kernel.ref("base-unit")]);
  kernel.setTargets("rocket-barrage.gear", [kernel.ref("gear")]);
  return kernel;
}

test("sfd-077-221 Rocket Barrage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-077-221 Rocket Barrage: identity, ruleset, status and verbatim text (with the catalog data note)", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // Data note (data not changed): the local catalog text glues the two mode
  // sentences together with no separator between "base." and "Kill".
  assert.match(program.sourceText, /in a base\.Kill a gear\./);
  assert.match(program.judgeReason, /sourceText/);
});

test("sfd-077-221 Rocket Barrage: judgeReason names the Repeat cost wiring", () => {
  assert.match(program.judgeReason, /820\.1/);
  assert.match(program.judgeReason, /Additional costs are not bound/);
  assert.match(program.judgeReason, /Unsupported play cost field optional/);
  assert.match(program.judgeReason, /repeat\.cost has no layer mapping/);
  assert.match(program.judgeReason, /Mode choices require a Finalize\/Resolve choice-plan adapter/);
  assert.match(program.judgeReason, /依赖：PlayAbility 与 repeat\.cost 静态声明的费用计划消费方/);
  // RIFT-89/261 are merged cost work; the reason must name the missing consumers
  // instead of citing them as pending dependencies.
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-261/);
  // 2026-10-18 re-sweep: name the measured third half of the Repeat gap.
  assert.match(program.judgeReason, /cost\.optional-additional-paid/);
  assert.match(program.judgeReason, /Repeat count must be a non-negative safe integer/);
  assert.match(program.judgeReason, /programs\/keywords\.ts/);
});

test("sfd-077-221 Rocket Barrage: the printed [Repeat] additional cost is 4 energy plus one Mind power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.keyword, "repeat");
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 2);
  const [energyPayment, powerPayment] = play.cost.payments;
  assert.equal(energyPayment.kind, "energy");
  assert.deepEqual(energyPayment.amount, { kind: "constant", value: 4 });
  assert.equal(energyPayment.choice.id, "rocket-barrage.repeat-payment");
  assert.deepEqual(energyPayment.choice.options, ["pay", "decline"]);
  assert.equal(powerPayment.kind, "power");
  assert.deepEqual(powerPayment.amount, { kind: "constant", value: 1 });
  // :rb_rune_mind: — the payment only accepts Mind power.
  assert.deepEqual(powerPayment.allowedDomains, ["Mind"]);
});

test("sfd-077-221 Rocket Barrage: structure is one choice.mode with the two printed modes", () => {
  assert.equal(play.body.length, 1);
  assert.equal(choice.id, "rocket-barrage.choose-one");
  assert.equal(choice.op, "choice.mode");
  assert.equal(choice.linkedTo, undefined);
  assert.deepEqual(choice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(choice.args.different, { kind: "constant", value: true });
  assert.equal(choice.args.modes.kind, "constant");
  assert.deepEqual(choice.args.modes.value.map((mode) => mode.id), [
    "rocket-barrage.damage-mode",
    "rocket-barrage.kill-mode"
  ]);

  // "Deal 4 to a unit in a base.": one unit target restricted to a Base
  // (355.9.a.1, 355.10.b) with the merged effect.damage (418).
  assert.equal(damage.id, "rocket-barrage.deal-4");
  assert.equal(damage.op, "effect.damage");
  assert.deepEqual(damage.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(damage.args.target, { kind: "constant", value: "rocket-barrage.unit-in-base" });
  assert.deepEqual(damage.targets, [
    {
      id: "rocket-barrage.unit-in-base",
      filter: { type: "unit", zone: "board", location: "base" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // A fixed amount per target is not split damage (355.14).
  assert.equal(damage.args.divide, undefined);

  // "Kill a gear.": one gear target (355.7, 429.6) with the merged effect.kill.
  assert.equal(kill.id, "rocket-barrage.kill-gear");
  assert.equal(kill.op, "effect.kill");
  assert.deepEqual(kill.args.target, { kind: "constant", value: "rocket-barrage.gear" });
  assert.deepEqual(kill.targets, [
    {
      id: "rocket-barrage.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-077-221 Rocket Barrage golden: the damage mode deals 4 to the unit in a base", () => {
  const kernel = freshKernel();
  kernel.setAnswers({ "rocket-barrage.choose-one/mode%3A0": "rocket-barrage.damage-mode" });

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  assert.equal(outcome.status, "executed");
  const dealt = outcome.results.find((entry) => entry.id === "rocket-barrage.deal-4");
  assert.equal(dealt.result.status, "executed");
  assert.equal(dealt.result.linkedValues.dealt, 4);
  assert.equal(kernel.getObject("base-unit").damage, 4);
  assert.equal(kernel.getObject("gear").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
});

test("sfd-077-221 Rocket Barrage golden: the kill mode kills the chosen gear", () => {
  const kernel = freshKernel();
  kernel.setAnswers({ "rocket-barrage.choose-one/mode%3A0": "rocket-barrage.kill-mode" });

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  assert.equal(outcome.status, "executed");
  const killed = outcome.results.find((entry) => entry.id === "rocket-barrage.kill-gear");
  assert.equal(killed.result.status, "executed");
  assert.deepEqual(killed.result.linkedValues.killed, [{ id: "gear", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("gear").zone, "trash");
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
});

test("sfd-077-221 Rocket Barrage golden: the mode choice is asked at resolution and nothing happens before it is answered", () => {
  const kernel = freshKernel();

  assert.throws(
    () => resolveChainBody(play.body, productionQuery(kernel)),
    (error) => {
      assert.ok(error instanceof AwaitChoice);
      assert.equal(error.request.type, "mode");
      assert.equal(error.request.chooser, "A");
      assert.deepEqual(error.request.options, [
        "rocket-barrage.damage-mode",
        "rocket-barrage.kill-mode"
      ]);
      return true;
    }
  );
  // The unanswered choice leaves the world untouched (transactional replay).
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.equal(kernel.getObject("gear").zone, "board");
});

test("sfd-077-221 Rocket Barrage golden: the merged repeat control re-runs the body with a different mode choice (820.2.a)", () => {
  // The interpreter's own repeat control node is merged (unlike the Repeat
  // additional-cost wiring). Driving the card's real body through it shows the
  // two executions are independently scoped and may choose different modes
  // (820.2 / 820.2.a): iteration 0 takes the damage mode, iteration 1 takes the
  // kill mode, both found from the same body.
  const repeated = [{
    id: "rocket-barrage.repeat-body",
    op: "repeat",
    args: {
      count: { kind: "constant", value: 2 },
      body: { kind: "constant", value: play.body }
    }
  }];
  const answers = {};
  let modeIndex = 0;
  let outcome = null;
  let kernel = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    kernel = freshKernel();
    kernel.setAnswers(answers);
    try {
      outcome = resolveChainBody(repeated, productionQuery(kernel));
      break;
    } catch (error) {
      assert.ok(error instanceof AwaitChoice);
      const request = error.request;
      if (request.type === "mode") {
        // First ask: damage mode; second ask: kill mode.
        answers[request.id] = modeIndex === 0
          ? "rocket-barrage.damage-mode"
          : "rocket-barrage.kill-mode";
        modeIndex += 1;
      } else if (request.type === "select-objects") {
        answers[request.id] = [request.options[0]];
      } else {
        assert.fail("unexpected request " + request.id);
      }
    }
  }

  assert.ok(outcome);
  assert.equal(outcome.status, "executed");
  // Both iterations executed, each with its own mode body.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["rocket-barrage.deal-4", "executed"],
      ["rocket-barrage.choose-one", "executed"],
      ["rocket-barrage.kill-gear", "executed"],
      ["rocket-barrage.choose-one", "executed"],
      ["rocket-barrage.repeat-body", "executed"]
    ]
  );
  assert.equal(kernel.getObject("base-unit").damage, 4);
  assert.equal(kernel.getObject("gear").zone, "trash");
});

test.todo(
  "sfd-077-221 Rocket Barrage: [Repeat] :rb_energy_4::rb_rune_mind: must be collected at Finalize and the paid " +
    "instance count fed to the interpreter's repeat node so the mode choice is re-made for each additional " +
    "execution (CR 820.1.c.1 / 820.1.d.1 / 820.2 / 820.2.a) — no consumer turns the PlayAbility declaration or " +
    "the Repeat keyword expansion's repeat.cost static ability into CostPlanInput, and the merged repeat control " +
    "is only reachable from a caller-supplied paid instance count."
);
// Direct evidence for the [Repeat] gap recorded in the judgeReason: the merged
// play-cost adapter refuses the optional additional-cost declaration before
// any plan can be built, so the printed [Repeat] cost never reaches Finalize.
import { translateCost } from "../../../../engine-core/dist/programs/play.js";

test("sfd-077-221 Rocket Barrage: translateCost delegates the optional [Repeat] declaration to the program cost binder (CR 820.1.c.1)", () => {
  assert.throws(
    () => translateCost(play.cost, "rocket-barrage:play", "play"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Additional costs require the program cost adapter on rocket-barrage:play/);
      return true;
    }
  );
});

test("sfd-077-221 Rocket Barrage: the Repeat expansion registers as a Finalize cost source", () => {
  const [declaration] = keywordDefinitionsById.get("Repeat").expand({
    host: { canonicalCardId: CANONICAL_ID },
    cost: { energy: { kind: "constant", value: 4 }, power: [{ allowedDomains: ["Mind"], amount: { kind: "constant", value: 1 } }] }
  });
  assert.equal(declaration.kind, "static");
  assert.equal(declaration.effect.kind, "repeat.cost");
  const kernel = world().unit("spell", { might: 3 }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("A static binding must not ask for a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const binder = createEngineStaticBinder(engine);
  const handle = binder.bindStatic(declaration, kernel.getObject("spell"));
  const [source] = staticCostSources(engine);
  assert.equal(source.ability.effect.kind, "cost.additional");
  assert.equal(source.ability.effect.optional, true);
  handle.unbind();
});

test("sfd-077-221 Rocket Barrage: the chain Finalize refuses the card's choice.mode body", () => {
  // Evidence for the mode-choice gap: the production play draft for this card's
  // own body is rejected by chain/engine.ts assertFinalizationSurface, so the
  // printed "Choose one" cannot be finalized at all today.
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const kernel = world().player("A", { energy: 20 }).build();
  kernel.addObject({
    ref: { id: "spell", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Rocket Barrage",
    types: ["spell"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "hand",
    location: null,
    might: null,
    energy: 4,
    power: ["Mind"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, "hand");
  assert.throws(
    () => binding.describePlay({ type: "play", object: kernel.ref("spell"), player: "A" }, kernel.getObject("spell")),
    /Mode choices require a Finalize\/Resolve choice-plan adapter/
  );
});

test("sfd-077-221 Rocket Barrage: the paid Repeat receipt is a boolean the repeat node cannot consume (820.1.d.1)", () => {
  // Live evidence for the third half of the refreshed reason. The receipt is
  // readable as a predicate, but the merged repeat node requires a
  // non-negative integer count, so the additional execution and its re-made
  // mode choice cannot be derived card-side from the paid/declined decision.
  const kernel = world()
    .player("A", { energy: 9, power: ["Mind"] })
    .deck(["d1", "d2"])
    .object("spell-source", { cardId: CANONICAL_ID, types: ["spell"], zone: "board", energy: 4, power: ["Mind"] })
    .build();
  const cost = {
    plan: {
      components: [{ id: "rocket-barrage.repeat-payment", stage: "optional-additional" }],
      selectedAdditional: [{ id: "rocket-barrage.repeat-payment", kind: "repeat" }],
      declinedAdditional: []
    },
    receipt: { paid: true, additional: [{ id: "rocket-barrage.repeat-payment", kind: "repeat", paid: true }] }
  };
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("spell-source") });

  const read = runAbilityBody(
    [{ id: "rocket.read-repeat", op: "condition.predicate", args: { condition: { kind: "constant", value: { kind: "result", result: "cost.optional-additional-paid", id: "rocket-barrage.repeat-payment" } } } }],
    context,
    undefined,
    { cost }
  );
  assert.equal(read.results[0].result.linkedValues.value, true);

  const repeated = kernel.clone({ sourceSnapshot: kernel.getObject("spell-source") });
  assert.throws(
    () => runAbilityBody(
      [
        { id: "rocket.read-repeat", op: "condition.predicate", args: { condition: { kind: "constant", value: { kind: "result", result: "cost.optional-additional-paid", id: "rocket-barrage.repeat-payment" } } } },
        {
          id: "rocket.repeat",
          op: "repeat",
          linkedTo: "rocket.read-repeat",
          args: {
            count: { kind: "linked-value", instructionId: "rocket.read-repeat", key: "value" },
            body: { kind: "constant", value: [{ id: "rocket.draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }] }
          }
        }
      ],
      repeated,
      undefined,
      { cost }
    ),
    /Repeat count must be a non-negative safe integer/
  );
  assert.equal(repeated.player("A").handSize, 0, "no repetitions ran");
});

test("sfd-077-221 Rocket Barrage: programs/keywords.ts expands Repeat without the printed cost", () => {
  // The printed 4 Energy + 1 Mind power lives on the play CostSpec; the card has
  // no `repeat` keyword ability for expandProgram to forward a cost to, so the
  // merged keyword registry cannot recover it (keyword → cost wiring gap).
  const keywords = program.abilities.filter((ability) => ability.kind === "keyword").map((ability) => ability.keyword);
  assert.equal(keywords.includes("repeat"), false);
  const kernel = world()
    .object("spell-source", { cardId: CANONICAL_ID, types: ["spell"], zone: "board", energy: 4, power: ["Mind"] })
    .build();
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const expanded = expandProgram(lifted, kernel.getObject("spell-source")).expanded;
  assert.equal(
    expanded.some((ability) => ability.kind === "static" && ability.effect.kind === "repeat.cost"),
    false
  );
});
