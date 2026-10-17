import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/virtuoso.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL_ID =
  "card.hash-cf809eb034135f7e3cd76d5eff022d2a22f25ee0fd5ce564ffc39eec131b51f6";
const SOURCE_TEXT =
  "When you play a spell, if you spent :rb_energy_4: or more, you may banish it. " +
  "Then, if there are four spells banished with me, put each in its trash, channel 4 runes, and draw 1.";

const [ability] = program.abilities;
const [optionalBanish, fourSpells] = ability.body;
const banishSpell = optionalBanish.args.body.value[0];
const [putInTrash, channelFour, drawOne] = fourSpells.args.body.value;

test("unl-181-219 Virtuoso: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-181-219 Virtuoso: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /spent/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /394/);
  // The refreshed reason names the observed blocked surfaces and the fifth gap
  // (nested targets through chain Finalize) instead of finished tasks.
  assert.match(program.judgeReason, /Unavailable condition result/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-181-219 Virtuoso: card-played trigger on a spell with the spent clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 383.4.a.4: triggered when the controller plays a spell.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "self" }
  });
  // 383.2.a.1: the clause right after the trigger condition belongs to the
  // condition; the retained count shape is the readability gap in judgeReason.
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 4 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  // The may-scope is a printed-text question (see judgeReason), so the trigger
  // itself stays non-optional and the chosen instruction sits inside the
  // contract-3.9 choice.optional body.
  assert.equal(ability.optional, false);
});

test("unl-181-219 Virtuoso: 'you may banish it' is a choice.optional body, not choice + linkedTo", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "virtuoso.opt-banish",
    "virtuoso.four-spells"
  ]);
  assert.equal(optionalBanish.op, "choice.optional");
  assert.equal(optionalBanish.args.body.kind, "constant");
  assert.equal(optionalBanish.linkedTo, undefined);
  assert.deepEqual(optionalBanish.args.body.value.map(instruction => instruction.id), [
    "virtuoso.banish-spell"
  ]);
  assert.equal(banishSpell.op, "effect.banish");
  assert.deepEqual(banishSpell.args.objects, {
    kind: "constant",
    value: { target: "played-spell" }
  });
  assert.deepEqual(banishSpell.targets[0], {
    id: "played-spell",
    filter: { type: "spell" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(banishSpell.picks, undefined);
});

test("unl-181-219 Virtuoso: the 'Then, if four spells banished with me' branch is an independent guarded sequence", () => {
  assert.equal(fourSpells.op, "sequence");
  // Independent statement: no forced link to the optional banish above.
  assert.equal(fourSpells.linkedTo, undefined);
  assert.equal(fourSpells.condition.kind, "compare");
  assert.equal(fourSpells.condition.operator, "gte");
  assert.deepEqual(fourSpells.condition.right, { kind: "constant", value: 4 });
  assert.equal(fourSpells.condition.left.kind, "count");
  assert.equal(fourSpells.condition.left.subject, "spells-banished-with-me");
  // Only real filter keys are used; the Linked Ability window itself has no
  // merged tracker (CR 394–398, see judgeReason) and is recorded by the subject.
  assert.deepEqual(fourSpells.condition.left.filter, { zone: "banishment", type: "spell" });
  assert.deepEqual(fourSpells.args.body.value.map(instruction => instruction.id), [
    "virtuoso.put-in-trash",
    "virtuoso.channel-four",
    "virtuoso.draw-one"
  ]);
  // 431.1 / 431.2.a: channel 4 runes readied (no exhausted stipulation printed).
  assert.equal(channelFour.op, "effect.channel");
  assert.deepEqual(channelFour.args, { amount: { kind: "constant", value: 4 } });
  assert.equal(channelFour.linkedTo, undefined);
  // 414.1 / 414.3: draw 1 for the controller (190.6.d).
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
});

test("unl-181-219 Virtuoso: declining the optional banish skips only that instruction", () => {
  const kernel = world()
    .unit("played-spell", { zone: "chain", types: ["spell"] })
    .build();
  kernel.setAnswers({ "virtuoso.opt-banish/optional": false });
  const outcome = runAbilityBody([optionalBanish], kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["virtuoso.opt-banish"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(
    kernel.getObject("played-spell").zone,
    "chain",
    "the declined banish must leave the spell where it is"
  );
});

test("unl-181-219 Virtuoso: accepting the optional banish moves the printed spell to Banishment", () => {
  // The interpreter re-selects targets for the declared TargetSpec at
  // resolution only inside repeats; at the top level it consumes the
  // Finalize-locked target set (355.3 / 355.15), which here is the played spell.
  const kernel = world().unit("played-spell", { zone: "chain", types: ["spell"] }).build();
  const ctx = kernel.clone();
  ctx.setAnswers({ "virtuoso.opt-banish/optional": true });
  ctx.setTargets("played-spell", [ctx.ref("played-spell")]);
  const outcome = runAbilityBody([optionalBanish], ctx);
  assert.equal(outcome.status, "executed");
  // The interpreter records the children of a control node before the node
  // itself (execution order, container last).
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["virtuoso.banish-spell", "executed"],
    ["virtuoso.opt-banish", "executed"]
  ]);
  assert.equal(ctx.getObject("played-spell").zone, "banishment");
  assert.deepEqual(ctx.events.map(event => event.action), ["banish"]);
});

test("unl-181-219 Virtuoso: effect.banish executes the printed banish on the reference kernel", () => {
  const kernel = world().unit("spell-card", { zone: "chain", types: ["spell"] }).build();
  const run = runInstruction(
    banish,
    { objects: banishSpell.args.objects, linkKey: { kind: "constant", value: "banishedSpells" } },
    { world: kernel, targets: { "played-spell": [kernel.ref("spell-card")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banishedSpellsCount, 1);
  assert.equal(kernel.getObject("spell-card").zone, "banishment");
});

test("unl-181-219 Virtuoso: the declared card-played trigger passes the merged adapter's closed vocabulary", () => {
  // RIFT-257's programs/ adapter translates the declared filter and registers it
  // with EventPipeline; the card-played timing point and the spell filter are
  // both inside the closed vocabulary, so the trigger really becomes pending
  // (the merged unl/<card> trigger scenarios use the same shape).
  const translated = translateTriggerFilter(ability.trigger.filter, "virtuoso", ability.trigger.at);
  // The event-object filter (spell, controlled by the ability controller) is kept
  // as an object pattern; it is neither the ability's own source nor a self anchor.
  assert.deepEqual(translated, {
    event: "card-played",
    object: { type: "spell", controller: "self" }
  });
  const validated = validateTriggerSpec({ at: ability.trigger.at, filter: translated });
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
});

test("unl-181-219 Virtuoso: channel 4 and draw 1 execute the supported tail", () => {
  const channelKernel = world().rune(["r1", "r2", "r3", "r4", "r5"]).build();
  const channelRun = runInstruction(channel, channelFour.args, { world: channelKernel });
  assert.equal(channelRun.result.status, "executed");
  assert.equal(channelRun.linked.channeled, 4);
  assert.equal(channelKernel.player("A").runePool.length, 4);
  assert.equal(channelKernel.player("A").runeDeckSize, 1);
  // 431.2.a: without an "exhausted" stipulation the runes enter readied.
  assert.deepEqual(channelRun.events.map(event => event.action), ["channel-rune"]);
  assert.equal(channelRun.events[0].exhausted, undefined);
  assert.equal(channelFour.args.exhausted, undefined);

  const drawKernel = world().deck(["top", "second"]).build();
  const drawRun = runInstruction(draw, drawOne.args, { world: drawKernel });
  assert.equal(drawRun.result.status, "executed");
  assert.equal(drawRun.linked.drawn, 1);
  assert.equal(drawKernel.player("A").handSize, 1);
});

test("unl-181-219 Virtuoso: the four-banish tail is guarded per instruction, not auto-run", () => {
  // The sequence condition is evaluated once before its body; the retained
  // count shape has no evaluable "banished with me" set, and the contract's
  // history/count expressions cannot express it (see judgeReason).
  assert.equal(putInTrash.op, "effect.zone");
  assert.deepEqual(putInTrash.args.to, { kind: "constant", value: "trash" });
  assert.deepEqual(putInTrash.args.pick, {
    kind: "constant",
    value: "spells-banished-with-me"
  });
  assert.deepEqual(putInTrash.picks[0], {
    id: "spells-banished-with-me",
    options: ["spells-banished-with-me"],
    min: 1,
    max: null,
    selection: "all"
  });
});

test("unl-181-219 Virtuoso gap: the spent clause over-satisfies without a cost receipt", () => {
  // 383.2.a.1 asks for the Energy actually spent on the triggering spell. The
  // retained count shape has no evaluable subject at all, so it tracks the number
  // of unrelated objects: 0 objects is false, 4 objects is true. The real
  // predicate (a finalized cost receipt) is unavailable during trigger evaluation.
  const condition = ability.trigger.condition;
  const empty = world().build();
  const fourObjects = world().unit("a").unit("b").unit("c").unit("d").build();
  assert.equal(empty.test(condition), false);
  assert.equal(fourObjects.test(condition), true);
  assert.throws(
    () => evaluateCondition(
      { kind: "result", result: "cost.total", key: "energy", operator: "gte", right: { kind: "constant", value: 4 } },
      {
        context: fourObjects,
        event: { timingPoint: "card-played" },
        linked: () => undefined,
        canLookBack: () => true,
        isIgnored: () => false,
        query: filter => fourObjects.query(filter)
      }
    ),
    /Unavailable condition result/
  );
});

test("unl-181-219 Virtuoso gap: the four-banish condition counts any banished spell, not the linked window", () => {
  // CR 394-398: "four spells banished with me" is a Linked Ability window. The
  // merged counter only sees Banishment as a zone, so four unrelated spells
  // satisfy the condition while the put-each-in-trash pick resolves as ignored.
  const kernel = world()
    .object("spell-1", { zone: "banishment", types: ["spell"], owner: "B" })
    .object("spell-2", { zone: "banishment", types: ["spell"], owner: "B" })
    .object("spell-3", { zone: "banishment", types: ["spell"], owner: "B" })
    .object("spell-4", { zone: "banishment", types: ["spell"], owner: "B" })
    .deck(["top", "second"])
    .rune(["r1", "r2", "r3", "r4", "r5"])
    .build();
  const context = kernel.clone({ controller: "A" });
  const outcome = resolveChainBody([fourSpells], context);

  assert.equal(kernel.test(fourSpells.condition), true);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["virtuoso.put-in-trash", "ignored"],
    ["virtuoso.channel-four", "executed"],
    ["virtuoso.draw-one", "executed"],
    ["virtuoso.four-spells", "executed"]
  ]);
  assert.deepEqual(
    kernel.query({ zone: "banishment" }).map(object => object.ref.id),
    ["spell-1", "spell-2", "spell-3", "spell-4"]
  );
});

test("unl-181-219 Virtuoso gap: the chain Finalize rejects the nested banish target", () => {
  // The optional banish target sits inside choice.optional. assertFinalizationSurface
  // refuses nested TargetSpecs, so putting this trigger on the chain throws before
  // Finalize can lock any target. Observed with the real ChainEngine, not with the
  // interpreter alone.
  const f = fixture();
  const body = [{
    id: "virtuoso.opt-banish",
    op: "choice.optional",
    args: {
      prompt: { kind: "constant", value: "Banish the spell you played?" },
      body: optionalBanish.args.body
    }
  }];
  assert.throws(
    () => f.engine.execute({
      id: "virtuoso-like",
      controller: "A",
      source: f.kernel.getObject("source"),
      kind: "triggered",
      speed: "action",
      body
    }),
    error => error instanceof ChainContractBlockedError &&
      /Nested\/repeated targets require an interpreter target-selection lifecycle adapter/.test(error.message)
  );
});
test.todo(
  "unl-181-219 Virtuoso: evaluate 'if you spent [4] or more' from the finalized cost plan receipt (CR 383.2.a.1) — " +
    "chain/engine.ts stores the payCostPlan receipt on ChainItem.payment, but ResolveContext has no spent/finalized-cost " +
    "reader; the cost plan and cost.pay/cost.modify primitives are merged, but the receipt is not exposed to Expr/Condition"
);
test.todo(
  "unl-181-219 Virtuoso: bind 'banish it' to the triggering spell object at trigger time (CR 383.2.c.3.b / 359.3.f.3) — " +
    "the frozen ObjectSelector vocabulary has no triggering-event object and the trigger snapshot's PipelineEvent is not " +
    "bindable as an object selector (engine batch 4 / RIFT-257 follow-up)"
);
test.todo(
  "unl-181-219 Virtuoso: track the Linked Ability window 'four spells banished with me' (CR 394–398 / 428.3) and move each to its owner's trash"
);
test.todo(
  "unl-181-219 Virtuoso: settle the 'you may banish it' scope (CR 383.3.a finalize decision vs 383.3.a.3 resolve-time " +
    "decision) and support the nested TargetSpec inside choice.optional — chain/engine.ts assertFinalizationSurface rejects nested targets"
);
