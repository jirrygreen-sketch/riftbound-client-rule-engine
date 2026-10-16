import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/virtuoso.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /394/);
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

test.todo(
  "unl-181-219 Virtuoso: evaluate 'if you spent [4] or more' from the finalized cost plan receipt (CR 383.2.a.1) — " +
    "no ResolveContext spent/finalized-cost reader is merged (RIFT-89)"
);
test.todo(
  "unl-181-219 Virtuoso: bind 'banish it' to the triggering spell object at trigger time (CR 383.2.c.3.b / 359.3.f.3) — " +
    "the frozen ObjectSelector vocabulary has no triggering-event object (engine batch 4)"
);
test.todo(
  "unl-181-219 Virtuoso: track the Linked Ability window 'four spells banished with me' (CR 394–398 / 428.3) and move each to its owner's trash"
);
