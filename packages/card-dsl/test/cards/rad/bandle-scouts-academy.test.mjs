import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/bandle-scouts-academy.js";

const CANONICAL =
  "card.hash-722142d79d944add290577d2ffd13c8f888e9948a549f7948d622833d6a0783e";
const [trigger] = program.abilities;

test("bandle-scouts-academy: passes validateCardProgram and carries the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    'When you hide a card here, play a Gold gear token exhausted. (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
  );
});

test("bandle-scouts-academy: judgeReason names the Gold definition, the play flow and the entry override", () => {
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /argsSchema/);
  assert.match(program.judgeReason, /describePlay/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /card-hidden/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|261)/);
});

test("bandle-scouts-academy: hidden-card trigger at this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "card-hidden");
  assert.equal(trigger.trigger.filter.event, "card-hidden");
  assert.equal(trigger.trigger.filter.here, true);
  // "you hide" — the merged PlayerSelector spelling for the ability
  // controller is "self".
  assert.equal(trigger.trigger.filter.player, "self");
  assert.equal(trigger.trigger.once, undefined);
  assert.equal(trigger.optional, false);
});

test("bandle-scouts-academy: body plays the CR 187.5 Gold token from the controller base", () => {
  assert.equal(trigger.body.length, 1);
  const [instruction] = trigger.body;
  assert.equal(instruction.id, "bandle-scouts-academy.play-gold");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
});

test("bandle-scouts-academy: the printed exhausted entry stipulation is not carried by the frozen token args", () => {
  // CR 143.4 / 184.1 / 185.2.d: slug and entry state are one printed stipulation.
  // The frozen create-token arguments have no field for the entry state, so the
  // program records it in judgeReason instead of adding a follow-up exhaust.
  assert.deepEqual(Object.keys(trigger.body[0].args).sort(), ["amount", "location", "mode", "token"]);
  assert.match(program.judgeReason, /argsSchema/);
});

test.todo(
  "bandle-scouts-academy: create the Gold token on the Chain and play it exhausted in the " +
    "production chain (440.2.c / 185.2.a / 350.2 / 354; needs the Gold definition, the exhausted " +
    "entry stipulation and a host that consumes { type: \"play\" })"
);
test.todo(
  "bandle-scouts-academy: card-hidden timing wiring for the Hide discretionary action " +
    "and the here-scoped battlefield filter (422.1 / 422.2; the Hide action and the card-hidden " +
    "producer are not merged, card-hidden is not in EVENT_PATTERN_TYPES, and the filter " +
    "translator rejects the here anchor)"
);
