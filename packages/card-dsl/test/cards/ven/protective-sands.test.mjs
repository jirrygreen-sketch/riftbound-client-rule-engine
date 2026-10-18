import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/protective-sands.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { ProgramBindingError, ProgramRegistry, triggerRegistrations } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CANONICAL =
  "card.hash-be16710fdfd6fce7243538754b9e041ce61077a17c75b104b7d6dc5dd119ce97";
const SOURCE_TEXT =
  "When you conquer here, if you control 4 or fewer runes, you may pay :rb_energy_1: to draw 1.";

const [ability] = program.abilities;
const [optional] = ability.body;
const [pay, draw] = optional.args.body.value;
const OPTIONAL_ID = "protective-sands.opt-in/optional";

/**
 * The reference kernel compares filter fields literally, so the symbolic
 * "self" player selector of 190.6.d is bound to the acting player for the
 * execution check (the same convention as ogn/master-yi-meditative).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

/** 133.5.a.1 / 431.1: a rune the controller channeled is a rune in their rune zone. */
function runeZoneWorld(runesTotal, channeled) {
  const ids = Array.from({ length: runesTotal }, (_, index) => `r${index + 1}`);
  const kernel = world().rune(ids).build();
  if (channeled > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: channeled }).status, "done");
  }
  return kernel;
}

test("ven-162-166 Protective Sands: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-162-166 Protective Sands: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The remaining gap the judgeReason must name after the 2026-10-17 re-sweep:
  // the 053.3 "here" anchor (the conquer timing point and cost.pay are merged).
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /740\.4\.a\.2/);
  assert.match(program.judgeReason, /TriggeredAbility/);
  assert.ok(!/RIFT-261（分支未合入）|cost\.pay\/ cost\.modify 属仍在进行/.test(program.judgeReason));
  // Deleted stale assertion (2026-10-18 re-sweep): the previous reason cited
  // the merged RIFT-257 / RIFT-261 dependencies. The refreshed reason names
  // the live translator refusal and the missing Finalize cost binding.
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ven-162-166 Protective Sands: conquer-here trigger with the rune-count trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c.2.b: a Conquer Effect that references the conquering player; 383.4.c.2.c
  // keeps it triggering when the point gain is negated or replaced.
  assert.equal(ability.trigger.at, "conquer");
  // 053.3 "here" + 190.6.a/190.6.d "you" (the battlefield's controller). The
  // "self" spelling is the merged PlayerSelector for the ability's controller;
  // "conquered" is the closed EventPattern discriminant that EVENT_NAMES maps
  // to the conquer timing point; "here" is the still-unbound 053.3 referent.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquered",
    here: true,
    player: "self"
  });
  assert.equal(ability.trigger.once, undefined);

  // 383.2.a.1: "if you control 4 or fewer runes" immediately follows the trigger
  // condition, so it belongs to the Trigger Condition, not the effect.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lte");
  assert.deepEqual(condition.right, { kind: "constant", value: 4 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes");
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    controller: "self",
    zone: "rune-zone"
  });
});

test("ven-162-166 Protective Sands: 'you may pay … to draw 1' is one optional body", () => {
  // Contract 3.9: the printed "may" wraps the chosen instructions in a single
  // choice.optional body instead of a choice plus a linkedTo consumer.
  assert.equal(ability.optional, true);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["protective-sands.opt-in"]);
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.body.kind, "constant");
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.targets, undefined);
  assert.equal(optional.picks, undefined);
  assert.deepEqual(optional.args.body.value.map(instruction => instruction.id), [
    "protective-sands.pay",
    "protective-sands.draw"
  ]);

  // The payment is the merged cost.pay primitive (RIFT-261); the amount is
  // the printed :rb_energy_1:, given in the payments resource-plan shape.
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.payments, { kind: "constant", value: { energy: 1 } });
  assert.equal(pay.linkedTo, undefined);

  // 414.3: "to draw 1" draws one card, and it follows the payment.
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw.linkedTo, "protective-sands.pay");
  assert.equal(draw.targets, undefined);
});

test("ven-162-166 Protective Sands golden: the rune-count trigger condition really evaluates (CR 383.2.a.1)", () => {
  const condition = substituteController(ability.trigger.condition, "A");
  const body = [
    {
      id: "gate",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: condition } }
    }
  ];

  // Four runes on the board: "4 or fewer runes" holds (the rune is in the rune
  // zone after being channeled, 133.5.a.1 / 431.1).
  const four = runeZoneWorld(4, 4);
  const accepted = resolveChainBody(body, four);
  assert.equal(accepted.status, "executed");
  assert.deepEqual(accepted.results[0].result.linkedValues, { value: true });
  assert.equal(four.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 4);

  // Five runes: the trigger condition is not fulfilled, so the ability would not
  // even be put on the chain.
  const five = runeZoneWorld(5, 5);
  const rejected = resolveChainBody(body, five);
  assert.equal(rejected.status, "executed");
  assert.deepEqual(rejected.results[0].result.linkedValues, { value: false });
});

test("ven-162-166 Protective Sands golden: declining the payment skips both the payment and the draw", () => {
  const kernel = world().deck(["top-card"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map(result => result.id), ["protective-sands.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.zone("A", "deck").length, 1);
  assert.equal(kernel.zone("A", "hand").length, 0);
});

test("ven-162-166 Protective Sands golden: the merged scoring flow really emits conquer with the battlefield id", () => {
  // Production turn flow (turn/flow.ts scheduleScore → Score commit wave): the
  // 'conquer' emission is produced by the same pipeline the card trigger will
  // subscribe to, and it carries the battlefield as details.battlefieldId.
  const builder = world().player("A").player("B");
  for (const player of ["A", "B"]) {
    builder
      .deck(Array.from({ length: 12 }, (_, index) => `${player}:deck:${index}`), { owner: player })
      .rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  builder.unit("mover", { controller: "A", might: 4 });
  const worldKernel = builder.build();
  const choose = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "mode") return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: worldKernel.snapshot(), links: worldKernel.clone() }),
    restore: saved => {
      worldKernel.restore(saved.state);
      worldKernel.copyLinkedFrom(saved.links);
    },
    objects: () => worldKernel.objects,
    perform: action => worldKernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(worldKernel, { source, controller, timingPoint, choose }),
    testTrigger: () => false
  });
  const flow = new TurnFlow({
    host,
    player: id => worldKernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: "B" }]
  });
  flow.start();
  const source = worldKernel.getObject("mover");
  // Moves into the uncontrolled battlefield bf1; Cleanup discovers Contested
  // and the merged combat flow conquers after the showdown is settled.
  flow.execute({
    id: "protective-sands-entry",
    controller: "A",
    source,
    kind: "unit",
    body: [],
    cost: { id: "cost:entry", cost: { energy: { kind: "constant", value: 0 }, power: { kind: "constant", value: [] } } },
    location: { type: "battlefield", id: "bf1" }
  });
  let guard = 0;
  while (flow.chain.items.length) {
    if (++guard > 60) throw new Error("protective-sands golden: chain did not settle");
    flow.pass(flow.chain.priority);
  }
  for (let step = 0; step < 12 && !flow.chain.pipeline.events.some(event => event.timingPoint === "conquer"); step++) {
    if (flow.combat.active && flow.chain.turnState?.startsWith("showdown")) flow.pass(flow.chain.priority);
    flow.advance();
    guard = 0;
    while (flow.chain.items.length) {
      if (++guard > 60) throw new Error("protective-sands golden: trigger chain did not settle");
      flow.pass(flow.chain.priority);
    }
  }
  const conquer = flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].player, "A");
  assert.deepEqual(conquer[0].details, { battlefieldId: "bf1" });
  assert.equal(worldKernel.player("A").score, 1);
});

test("ven-162-166 Protective Sands golden: the closed 'conquered' discriminant fires on the emitted conquer timing point", () => {
  // The trigger filter now uses the closed EVENT_PATTERN_TYPES value
  // "conquered" (events/pipeline-match.ts EVENT_NAMES maps it to "conquer").
  // Registering the card's own filter against the real EventPipeline is the
  // maximum evidence available while the 053.3 "here" anchor is unbound.
  const kernel = world().unit("mover", { controller: "A", might: 4 }).build();
  const source = kernel.getObject("mover");
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [source],
    choose: () => {
      throw new Error("unexpected choice");
    }
  };
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const seen = [];
  pipeline.onTrigger = snapshot => seen.push(snapshot);
  pipeline.registerTrigger({
    id: "protective-sands.conquer-probe",
    source,
    controller: "A",
    optional: false,
    body: [],
    // The card's own discriminant plus the controller selector; the "here"
    // key stays out because the engine-side translator rejects it fail-closed.
    spec: { at: "conquer", filter: { event: "conquered", player: "self" } }
  });
  pipeline.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "bf1" } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "bf1");
});

test("ven-162-166 Protective Sands golden: accepting the may really pays 1 Energy and draws 1", () => {
  // 405.2.a / 414.3: this only proves the body-level cost.pay primitive and the
  // subsequent draw. CR 740.4.a.2 still requires the payment to be extracted
  // into the triggered ability's Finalize cost plan (see the TODO below).
  const kernel = world().player("A", { energy: 2 }).deck(["top-card"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  // The optional wrapper flattens its accepted body: pay first, then draw.
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["protective-sands.pay", "executed"],
    ["protective-sands.draw", "executed"],
    ["protective-sands.opt-in", "executed"]
  ]);
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(kernel.zone("A", "deck").length, 0);
  assert.equal(kernel.zone("A", "hand").length, 1);
  assert.equal(kernel.zone("A", "hand")[0].id, "top-card");
  assert.deepEqual(kernel.events.filter(event => event.action === "draw").length, 1);
});

test.todo(
  "ven-162-166 Protective Sands: extract the 1-Energy trigger cost into Finalize (CR 740.4.a.2) " +
    "and reject the trigger before it enters the chain when the controller cannot pay; " +
    "TriggeredAbility has no cost field and CardProgram -> TriggerRegistration cost/mayAtFinalize " +
    "binding is still missing"
);

test("ven-162-166 Protective Sands gap: the printed here anchor blocks production trigger registration", () => {
  // Measured evidence for judgeReason point 2: the conquer timing point, its
  // real emission and the card-played-style registration path all exist, but
  // the card's own here key is refused by the merged translator, so the real
  // binding registers nothing.
  const kernel = world().unit("sands", { cardId: CANONICAL, types: ["battlefield"], location: { type: "battlefield", id: "bf1" } }).build();
  const source = kernel.getObject("sands");
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  assert.throws(
    () => triggerRegistrations(registry, source),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      /Unsupported filter field here/.test(error.message)
  );
});

test("ven-162-166 Protective Sands gap: the accepted may-body errs instead of paying when energy is short", () => {
  // Measured evidence for judgeReason point 1: the 1-Energy payment is still a
  // settlement-time instruction. With zero energy the merged primitive raises
  // cannot-pay-cost (CR 203.3) rather than the trigger being rejected at
  // Finalize as 740.4.a.2 requires, and nothing is drawn.
  const kernel = world().player("A", { energy: 0 }).deck(["top-card"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  assert.throws(
    () => resolveChainBody(ability.body, kernel),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.equal(kernel.zone("A", "deck").length, 1);
});

test.todo(
  "ven-162-166 Protective Sands: bind \"here\" to the conquer event's battlefield payload (053.3) and resolve " +
    "the battlefield controller's abilities (190.6) so the CardProgram trigger registers without the " +
    "descriptive here key — the conquer emission itself is already merged"
);
