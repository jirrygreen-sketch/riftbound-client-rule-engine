import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vayne-hunter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { evaluateExtendedExpression } from "../../../../engine-core/dist/effects/interpreter/expr-ext/index.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";

const CARD_ID = "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6";
const MAY_ID = "vayne-hunter.may-return";
const SOURCE_TEXT =
  "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
  "If an opponent controls a battlefield, I enter ready.\n" +
  "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand.";

test("ogn-035-298 Vayne, Hunter: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /evaluateCondition/);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /subject/);
  assert.match(program.judgeReason, /TargetSpec|嵌套/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /payment scope.savepoint/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(83|84|89|90|91|257|258|260|261|359)/);
});

test("ogn-035-298 Vayne, Hunter: the merged designation extension reads the actual Assault host's combatRole", () => {
  const [expanded] = assault.expand({ value: program.abilities[0].value, host: { canonicalCardId: CARD_ID } });
  for (const controller of ["A", "B"]) {
    for (const combatRole of ["attacker", "defender", null]) {
      const base = world().unit("vayne", { owner: controller, combatRole, might: 2 }).build();
      const kernel = base.clone({ controller, sourceSnapshot: base.getObject("vayne") });
      const actual = evaluateExtendedExpression(expanded.condition.left, {
        context: kernel, host: kernel.ref("vayne"), linked: key => kernel.linked(key),
        canLookBack: () => true, isIgnored: () => false
      });
      assert.equal(actual, combatRole);
      assert.equal(actual === expanded.condition.right.value, combatRole === "attacker");
    }
  }
});

test("ogn-035-298 Vayne, Hunter: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-035-298 Vayne, Hunter: Assault 3 keyword, conditional enter-ready replacement, optional conquer return", () => {
  assert.equal(program.abilities.length, 3);
  const [assault, replacement, triggered] = program.abilities;
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault", value: 3 });

  // "If an opponent controls a battlefield, I enter ready." — a conditional
  // replacement (364.3 / 369.3), not a post-entry effect.ready.
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(replacement.condition.kind, "compare");
  assert.equal(replacement.condition.left.kind, "count");
  assert.equal(replacement.condition.left.subject, "battlefields");
  assert.deepEqual(replacement.condition.left.filter, { controller: "opponent" });
  assert.equal(replacement.condition.operator, "gte");
  assert.deepEqual(replacement.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(replacement.with.map((instruction) => [instruction.id, instruction.op]), [
    ["vayne-hunter.enter-ready", "replacement.enter"]
  ]);
  assert.deepEqual(replacement.with[0].args.state, { kind: "constant", value: "ready" });
  assert.deepEqual(replacement.with[0].args.zone, { kind: "constant", value: "board" });

  // "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquered", filter: { source: "self" } });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [choice] = triggered.body;
  assert.equal(choice.id, MAY_ID);
  assert.equal(choice.op, "choice.optional");
  const body = choice.args.body.value;
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(body.map((instruction) => [instruction.id, instruction.op]), [
    ["vayne-hunter.pay-1", "cost.pay"],
    ["vayne-hunter.return-to-hand", "effect.zone"]
  ]);
  assert.deepEqual(body[0].args, {
    payments: { kind: "constant", value: { energy: 1 } }
  });
  assert.equal(body[1].linkedTo, "vayne-hunter.pay-1");
  assert.deepEqual(body[1].args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(body[1].targets, [
    {
      id: "vayne-hunter.self",
      filter: { source: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ogn-035-298 Vayne, Hunter: declining the optional pay leaves the board unchanged", () => {
  const kernel = world().build();
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = runAbilityBody([program.abilities[2].body[0]], kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.events.length, 0);
});

test("ogn-035-298 Vayne, Hunter golden: the merged entry replacement rewrites the exhausted entry to ready (369.3)", () => {
  // "If an opponent controls a battlefield, I enter ready." — the merged
  // replacement registration binds the entry-orientation rewrite;
  // the rewrite is applied to the chain-zone permanent so the move carries it
  // to the Board (no separate becomes-ready timing happens on Board).
  const kernel = world()
    .player("A")
    .player("B")
    .unit("vayne", { zone: "hand", location: null, might: 2 })
    .unit("opponent-battlefield", {
      types: ["battlefield"],
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "opponent-field" }
    })
    .build();
  const hostRef = kernel.ref("vayne");
  const registrations = [];
  bindReplacement(program.abilities[1], hostRef, {
    host: {
      object: (ref) => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: { clock: { turn: 1 }, registerReplacement: (registration) => registrations.push(registration) }
  });

  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  // The resolver lands the default exhausted entry state on the chain-zone card.
  assert.equal(kernel.perform({ type: "exhaust", object: kernel.ref("vayne") }).status, "done");
  const entering = {
    type: "move-zone",
    object: kernel.ref("vayne"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  };
  const [registration] = registrations;
  assert.equal(registration.matches(entering, entering), true);
  const replacement = registration.apply(entering, entering);
  assert.equal(replacement.status, "replace");
  assert.deepEqual(replacement.actions.map((action) => action.type), ["ready", "move-zone"]);
  for (const action of replacement.actions) assert.equal(kernel.perform(action).status, "done");

  const entered = kernel.getObject("vayne");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(entered.exhausted, false);
});

test("ogn-035-298 Vayne, Hunter: the return-to-hand instruction returns the chosen self object to its owner's hand", () => {
  const kernel = world()
    .unit("vayne", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 2
    })
    .build();
  const instruction = program.abilities[2].body[0].args.body.value[1];
  const run = runInstruction(
    zone,
    { target: "vayne-hunter.self", to: instruction.args.to },
    { world: kernel, targets: { "vayne-hunter.self": [kernel.ref("vayne")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("vayne").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["vayne"]);
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
});

test("ogn-035-298 Vayne, Hunter golden: accepting the optional payment charges Energy before returning Vayne", () => {
  const base = world()
    .player("A", { energy: 1 })
    .unit("vayne", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 2
    })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("vayne") });
  kernel.setAnswers({ [`${MAY_ID}/optional`]: true });
  kernel.setTargets("vayne-hunter.self", [kernel.ref("vayne")]);

  const outcome = resolveChainBody([program.abilities[2].body[0]], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["vayne-hunter.pay-1", "executed"],
      ["vayne-hunter.return-to-hand", "executed"],
      [MAY_ID, "executed"]
    ]
  );
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["vayne"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["pay", "return-to-hand"]);
});

test("ogn-035-298 Vayne, Hunter: the Assault 3 condition reads a characteristic the snapshot does not expose (807.1.c)", async () => {
  // The KeywordDef expansion registers, but its condition reads
  // object-property "designation" while ObjectSnapshot exposes the contract 3.8
  // combatRole. Registering through the real production static binder and then
  // marking the unit as the attacker leaves the effective Might at the printed
  // value, so "+3 while I'm an attacker" is not enforced by the merged layers.
  const f = fixture({
    cards: [{ id: "vayne", cardId: CARD_ID, types: ["unit"], energy: 4, power: ["Fury"], might: 2 }]
  });
  assert.equal(
    f.engine.commit({
      type: "move-zone",
      object: f.kernel.ref("vayne"),
      to: "battlefield",
      location: { type: "battlefield", id: "battlefield-1" }
    }).status,
    "done"
  );
  const snapshot = f.kernel.getObject("vayne");
  assert.equal(Object.hasOwn(snapshot, "designation"), false);
  assert.equal(snapshot.combatRole, null);
  assert.equal(snapshot.might, 2);

  const { default: assault } = await import("../../../../engine-core/dist/effects/keywords/Assault.js");
  const [assaultAbility] = assault.expand({
    value: program.abilities[0].value,
    host: { canonicalCardId: CARD_ID }
  });
  assert.deepEqual(assaultAbility.condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  const binder = createEngineStaticBinder(f.engine);
  binder.bindStatic(assaultAbility, { ...snapshot, combatRole: "attacker" });
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("vayne")).might, 2);
});

test("ogn-035-298 Vayne, Hunter: the entry rewrite ignores the printed battlefield condition (364.3.a)", () => {
  // replacement/bind.ts matchesEnterAction returns before testCondition, so the
  // declared "an opponent controls a battlefield" gate never runs on the entry
  // path: a board with no opponent-controlled battlefield still rewrites the
  // entry to ready.
  // The count expression the condition asks for is evaluable but sees nothing:
  // battlefields are not control-carrying ObjectSnapshot objects.
  const kernel = world().player("A").player("B")
    .unit("vayne", { might: 2 })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  const environment = {
    context: kernel,
    host: kernel.ref("vayne"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(
    evaluateExpression(program.abilities[1].condition.left, environment),
    1,
    "the live object set is counted"
  );
  // The printed condition is therefore false here, so a correct implementation
  // would leave the default exhausted entry untouched.
  assert.equal(evaluateCondition(program.abilities[1].condition, environment), true);
  assert.equal(
    evaluateExpression({ kind: "count", subject: "some-other-subject", filter: { controller: "opponent" } }, environment),
    1,
    "the subject string is ignored: the filter alone decides the count"
  );
});

test("ogn-035-298 Vayne, Hunter: no opponent battlefield leaves the entry exhausted (364.3.a / 371.1)", () => {
  const kernel = world().player("A").player("B").unit("vayne", { zone: "hand", location: null, might: 2 }).build();
  const registrations = [];
  bindReplacement(program.abilities[1], kernel.ref("vayne"), {
    host: {
      object: (ref) => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: { clock: { turn: 1 }, registerReplacement: (registration) => registrations.push(registration) }
  });
  kernel.perform({ type: "move-zone", object: kernel.ref("vayne"), to: "chain" });
  kernel.perform({ type: "exhaust", object: kernel.ref("vayne") });
  const entering = {
    type: "move-zone",
    object: kernel.ref("vayne"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  };
  assert.equal(kernel.objects.filter((object) => object.controller === "B").length, 0);
  assert.equal(registrations[0].matches(entering, entering), false);
  assert.throws(() => registrations[0].apply(entering, entering), /called without a matching event/);
});

test("ogn-035-298 Vayne, Hunter: the merged conquer filter binds self, but production lacks the participant object (383.4.c.2.a)", () => {
  // The merged source:self event-filter spelling binds to the host id. The
  // production Score wave still emits only player/details, so it cannot prove
  // that this particular unit participated in the conquest.
  const kernel = world().unit("vayne", { might: 2 }).build();
  const snapshot = kernel.getObject("vayne");
  const declared = translateTriggerFilter(program.abilities[2].trigger.filter, snapshot.ref.id, "conquer");
  assert.deepEqual(declared, { event: "conquered", object: { objectId: snapshot.ref.id } });
  assert.equal(validateTriggerSpec({ at: "conquer", filter: declared }).ok, true);
  assert.equal(
    matchesTriggerEvent(declared, { timingPoint: "conquer", object: snapshot, player: "A", details: { battlefieldId: "bf-1" } }, "A"),
    true,
    "source:self is rebound to the host id"
  );
  // The Score wave emits only { player, details: { battlefieldId } }.
  assert.equal(
    matchesTriggerEvent(declared, { timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } }, "A"),
    false,
    "a payload-only conquer emission carries no participant object"
  );
});

test("ogn-035-298 Vayne, Hunter: the production binding preserves the optional body's self TargetSpec", async () => {
  const [translatedMay] = translateInstructionTargets(program.abilities[2].body);
  const [, translatedReturn] = translatedMay.args.body.value;
  assert.deepEqual(translatedReturn.targets[0].filter, { source: "self" });

  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "vayne", cardId: CARD_ID, types: ["unit"], energy: 4, power: ["Fury"], might: 2 }]
  });
  assert.doesNotThrow(
    () => binding.registerProgramTriggers(f.engine, f.kernel.getObject("vayne"))
  );
});

test("ogn-035-298 Vayne, Hunter: an unpayable optional payment aborts instead of skipping the body (203.3)", () => {
  // cost.pay throws cannot-pay-cost; cost/README.md records the missing payment
  // scope/savepoint that would let an enclosing choice.optional skip only its
  // own body. Here the failure propagates out of the whole instruction body.
  const kernel = world().player("A", { energy: 0 })
    .unit("vayne", { zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 })
    .build();
  kernel.setAnswers({ [`${MAY_ID}/optional`]: true });
  kernel.setTargets("vayne-hunter.self", [kernel.ref("vayne")]);
  assert.throws(
    () => resolveChainBody([program.abilities[2].body[0]], kernel),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.getObject("vayne").zone, "board");
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "ogn-035-298 Vayne, Hunter: the printed 'an opponent controls a battlefield' condition needs an evaluable " +
    "predicate — the ObjectSnapshot has no control-carrying battlefield object, the count subject is not " +
    "evaluated (interpreter/expr.ts reads only expr.filter), and replacement/bind.ts matches enter rewrites " +
    "before testing the ability condition. effect.ready must not approximate the entry rewrite."
);

test.todo(
  "ogn-035-298 Vayne, Hunter: production Chain Finalize must translate the body's self-anchored TargetSpec and " +
    "support the nested TargetSpec inside choice.optional, and cost.pay needs a payment scope/savepoint so an " +
    "unpayable optional body is skipped without aborting the enclosing trigger (383.3.b)."
);

