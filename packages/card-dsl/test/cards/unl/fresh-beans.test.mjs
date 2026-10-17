import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/fresh-beans.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-17039d43b30b27ad3b262ad062f057e1b19e43c616105e2847e33e5fc6370cbc";
const SOURCE_TEXT = "When you play a unit during a showdown, you may exhaust this to draw 1.";

const [ability] = program.abilities;
const [exhaustSelf, drawOne] = ability.body;

/** Build a two-player world whose source is Fresh Beans itself (the printed "this"). */
function beansWorld({ exhausted = false, hand = [] } = {}) {
  const builder = world()
    .unit("beans", {
      types: ["gear"],
      might: null,
      energy: 2,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" },
      exhausted
    })
    .deck(["top-card"]);
  for (const id of hand) builder.hand(id);
  const base = builder.build();
  return { base, context: base.clone({ sourceSnapshot: base.getObject("beans") }) };
}

test("unl-011-219 Fresh Beans: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  // The trigger registration path is merged (RIFT-257); what remains is the
  // showdown predicate and the exhaust-as-trigger-cost wiring (RIFT-261).
  assert.match(program.judgeReason, /showdown/i);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-011-219 Fresh Beans: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-011-219 Fresh Beans: card-played unit trigger with the showdown clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.4: "when you play a unit" is not a Play Effect; it subscribes to card-played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "unit" },
    player: "self"
  });
  // 383.2.a.1: "during a showdown" follows the trigger condition and belongs to it.
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 1 });
  // 383.3.a: the leading "you may" is the trigger's own Finalize decision.
  assert.equal(ability.optional, true);
});

test("unl-011-219 Fresh Beans: the merged registration path produces the card-played subscription", () => {
  // RIFT-257: the card-played subscription is produced from the card program,
  // carrying the declared showdown condition for the trigger-time evaluator.
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = {
    ref: { id: "beans", zoneEntryId: 1 }, cardId: CARD_ID, name: "Fresh Beans", types: ["gear"],
    tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "base", player: "A" }, might: null, energy: 2, power: null, exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: null
  };
  const [registration] = triggerRegistrations(binding.registry, source);
  assert.equal(registration.spec.at, "card-played");
  assert.deepEqual(registration.spec.filter, {
    event: "card-played",
    object: { type: "unit" },
    player: "self"
  });
  assert.equal(registration.spec.condition.kind, "compare");
});

test("unl-011-219 Fresh Beans: exhaust-this then the linked draw 1", () => {
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [
    ["fresh-beans.exhaust-self", "effect.exhaust"],
    ["fresh-beans.draw-1", "effect.draw"]
  ]);
  // 355.10.c / 415.5: "exhaust this" is anchored to the source through a
  // non-target choose filter, so nothing becomes a target (355.7).
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "fresh-beans.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);
  assert.equal(exhaustSelf.linkedTo, undefined);
  // 359.3.e.14: the draw follows the exhaust rather than resolving unconditionally.
  assert.equal(drawOne.linkedTo, "fresh-beans.exhaust-self");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawOne.targets, undefined);
});

test("unl-011-219 Fresh Beans golden: the printed exhaust sub-instruction runs through the interpreter", () => {
  const { context } = beansWorld({});
  const host = context.ref("beans");
  const outcome = runAbilityBody([exhaustSelf], context, undefined, { host });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["fresh-beans.exhaust-self", "executed"]
  ]);
  // 415.1: the gear becomes exhausted; the action is recorded as a real game event.
  assert.equal(context.getObject("beans").exhausted, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["exhaust"]);
  assert.equal(outcome.results[0].result.linkedValues["exhausted.count"], 1);
});

test("unl-011-219 Fresh Beans golden: an already-exhausted gear cannot be exhausted again (CR 415.1.b/c)", () => {
  const { context } = beansWorld({ exhausted: true });
  const host = context.ref("beans");
  const outcome = runAbilityBody([exhaustSelf], context, undefined, { host });

  // 415.1.c: the instruction still resolves, but no new exhaust action happens.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues["exhausted.count"], 0);
  assert.equal(outcome.results[0].result.linkedValues.exhausted.alreadyExhausted, 1);
  assert.deepEqual(outcome.events, []);
  assert.equal(context.getObject("beans").exhausted, true);
});

test("unl-011-219 Fresh Beans golden: a host that left the board negates the exhaust (CR 359.3.e)", () => {
  const { context } = beansWorld({});
  const host = context.ref("beans");
  // The gear changed zones after Finalize but before resolution.
  context.perform({ type: "move-zone", object: host, to: "hand" });

  const outcome = runAbilityBody([exhaustSelf], context, undefined, { host });
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(outcome.events, []);
});

test("unl-011-219 Fresh Beans golden: the printed draw 1 executes through the merged primitive", () => {
  const { base } = beansWorld({});
  const run = runInstruction(draw, drawOne.args, { world: base });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(base.player("A").handSize, 1);
  assert.equal(base.player("A").deckSize, 0);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test.todo(
  "unl-011-219 Fresh Beans: evaluate \"during a showdown\" (CR 383.2.a.1) at trigger time — events/pipeline.ts " +
    "requires a host testTrigger adapter for conditioned registrations and no merged host provides one, and " +
    "Condition/Expr cannot read the in-progress Showdown state"
);

test.todo(
  "unl-011-219 Fresh Beans: pay the leading \"exhaust this\" as the trigger's base cost at Finalize " +
    "(CR 383.3.b / 404.1.b.1 / 415.4-415.5) and drop the trigger when the gear is already exhausted — " +
    "TriggeredAbility has no cost field and the cost.pay wiring is still on RIFT-261"
);

test.todo(
  "unl-011-219 Fresh Beans: run the whole authored body through one production adapter pass — " +
    "chain/interpreter-adapter.ts decodes literal fields for effect.exhaust but not \"choose\", so the " +
    "non-target cost anchor is rejected outside the bare interpreter"
);
