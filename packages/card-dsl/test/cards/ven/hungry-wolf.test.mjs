import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/hungry-wolf.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-c57951db37608d30432354f25a074c018c9b41aa44a03a6ee3b5b4be3ec93ad1";
const SOURCE_TEXT =
  ":rb_rune_order:: Ready me and give me +1 :rb_might: this turn. " +
  "Use only if you've chosen an enemy unit this turn and only once each turn.";

const [ability] = program.abilities;
const [readyMe, mightThisTurn] = ability.body;

const wolfWorld = (exhausted) =>
  world()
    .player("controller")
    .unit("hungry-wolf", { controller: "controller", exhausted, might: 4 })
    .build();

const wolfKernel = (exhausted) => {
  const base = wolfWorld(exhausted);
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("hungry-wolf") });
};

test("ven-125-166 Hungry Wolf: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-125-166 Hungry Wolf: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /386\.1/);
});

test("ven-125-166 Hungry Wolf: one Action-speed activated ability costing an Order Power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 404.1.a: the printed ":rb_rune_order:" before the ':' separator is the cost.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    power: { kind: "constant", value: ["Order"] }
  });
  // “only once each turn” (386.1) and “use only if you've chosen an enemy unit
  // this turn” have no executable modelling field; recorded as printed limits.
  assert.deepEqual(ability.restriction, {
    kind: "printed-use-limit",
    value: { kind: "constant", value: "once-each-turn-chosen-enemy-unit-this-turn" }
  });
});

test("ven-125-166 Hungry Wolf: body is 'ready me' plus the unmerged temporary Might grant", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "hungry-wolf.ready-me",
    "hungry-wolf.might-this-turn"
  ]);
  assert.equal(readyMe.op, "effect.ready");
  // No args: effect.ready defaults to the ability source, and 827.1.b-style
  // “me” is never a target (355.10.g).
  assert.deepEqual(readyMe.args, {});
  assert.equal(readyMe.targets, undefined);
  assert.equal(readyMe.linkedTo, undefined);

  // “give me +1 [M] this turn” must NOT be authored as a Buff counter
  // (effect.buff documents that temporary Might belongs to continuous.might).
  assert.equal(mightThisTurn.op, "effect.might-modify");
  assert.deepEqual(mightThisTurn.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightThisTurn.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightThisTurn.args.object, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightThisTurn.condition, undefined);
});

test("ven-125-166 golden: the merged 'Ready me' half readies the exhausted host", () => {
  const kernel = wolfKernel(true);
  assert.equal(kernel.getObject("hungry-wolf").exhausted, true);

  const outcome = runAbilityBody([readyMe], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["hungry-wolf.ready-me", "executed"]
  ]);
  assert.equal(kernel.getObject("hungry-wolf").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.equal(outcome.linkedValues["hungry-wolf.ready-me.readied"].count, 1);
});

test("ven-125-166 golden: an already-ready host is a no-op, not an error (CR 416.1.b)", () => {
  const kernel = wolfKernel(false);
  const outcome = runAbilityBody([readyMe], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(outcome.events, []);
});

test("ven-125-166: the temporary Might half is blocked, never approximated", () => {
  // There is no merged consumer for effect.might-modify, so running the whole
  // printed body must fail loudly instead of silently granting nothing.
  const kernel = wolfKernel(true);
  assert.throws(() => runAbilityBody(ability.body, kernel), /Unregistered instruction opcode: effect\.might-modify/);
});

test.todo(
  "ven-125-166 Hungry Wolf: 'give me +1 :rb_might: this turn' (temporary Might with the " +
    "end-of-turn expiry, CR 315.4 + cleanup) needs the card-side continuous.might primitive and " +
    "layers registration (RIFT-91)"
);

test.todo(
  "ven-125-166 Hungry Wolf: 'Use only if you've chosen an enemy unit this turn' needs a " +
    "choose-history predicate (355.7) — the closed HistoryQuery has no 'chosen' action (RIFT-87)"
);

test.todo(
  "ven-125-166 Hungry Wolf: 'only once each turn' (CR 386.1) needs a per-turn activation " +
    "limit on the activated ability (Finalize-side consumer)"
);
