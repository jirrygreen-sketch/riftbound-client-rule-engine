import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/relentless-storm.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8c4ee3cd2f48d5640eebc2d0ba22037c8d5e8d2054d8fa40c4255e7a75b84b36";
const SOURCE_TEXT =
  "When you play a [Mighty] unit, you may exhaust me to channel 1 rune exhausted. " +
  "(A unit is Mighty while it has 5+ :rb_might:.)";

const [ability] = program.abilities;
const [exhaustSelf, channelRune] = ability.body;

test("ogn-249-298 Relentless Storm: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-249-298 Relentless Storm: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /706/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-264/);
});

test("ogn-249-298 Relentless Storm: optional card-played trigger with the [Mighty] marker", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / event "card-played": the played object is the newly played unit.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: {
      type: "unit",
      controller: "self",
      characteristics: { mighty: true }
    }
  });
  // 383.3.a / 403.1: “you may” as the first part of the effect is the
  // triggered ability's own Finalize decision, carried by optional: true.
  assert.equal(ability.optional, true);
  assert.equal(ability.trigger.condition, undefined);
});

test("ogn-249-298 Relentless Storm: exhaust-the-source then linked channel 1 exhausted", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "relentless-storm.exhaust-self",
    "relentless-storm.channel-rune"
  ]);
  // 355.10.c.1 (“[do X] to [do Y]”): the exhaust 415.5 wording is kept as a
  // non-target choose anchored to the source itself, so nothing becomes a
  // target (355.7) and the follow-up is genuinely gated by linkedTo.
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "relentless-storm.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);
  assert.equal(exhaustSelf.linkedTo, undefined);
  // 431.1 / 431.2: channel 1 rune exhausted, resolving only after the exhaust.
  assert.equal(channelRune.op, "effect.channel");
  assert.deepEqual(channelRune.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  assert.equal(channelRune.linkedTo, "relentless-storm.exhaust-self");
});

test("ogn-249-298 Relentless Storm: the exhaust sub-instruction executes through the interpreter", () => {
  const kernel = world()
    .rune(["r1", "r2"])
    .unit("storm", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const hostRef = kernel.ref("storm");
  const outcome = runAbilityBody([exhaustSelf], kernel, undefined, { host: hostRef });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["relentless-storm.exhaust-self", "executed"]
  ]);
  assert.equal(kernel.getObject("storm").exhausted, true);
});

test("ogn-249-298 Relentless Storm: the channel sub-instruction executes with the printed stipulations", () => {
  const kernel = world().rune(["r1", "r2"]).build();
  const run = runInstruction(
    channel,
    { amount: channelRune.args.amount, exhausted: channelRune.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  const channelEvent = run.events.find(event => event.action === "channel-rune");
  assert.ok(channelEvent, "expected a channel-rune game action");
});

test.todo(
  "ogn-249-298: evaluate the [Mighty] trigger predicate (CR 706–709, Might >= 5) when the unit is played " +
    "— the Mighty KeywordDef (RIFT-264) is merged but no consumer evaluates the marker inside the trigger filter; " +
    "card-program trigger registration additionally needs RIFT-257"
);

test.todo(
  "ogn-249-298: pay the leading “exhaust me” cost during Finalize (404.1.b.1 / 415.4) and remove the trigger " +
    "from the chain when the source is already exhausted — TriggeredAbility has no cost field and no merged " +
    "path turns the card program's leading [do X] into a trigger cost; the card-program trigger registration " +
    "additionally needs RIFT-257"
);
