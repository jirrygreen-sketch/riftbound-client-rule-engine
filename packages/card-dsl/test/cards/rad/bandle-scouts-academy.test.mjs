import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/bandle-scouts-academy.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /185\.2\.d/);
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

test("bandle-scouts-academy: the Gold definition is blocked, not approximated", () => {
  // CR 187.5 Gold carries its own activated ability; the frozen effect.token
  // definition table deliberately excludes it, and it must not be silently
  // replaced with a plain gear token. The authored "controller" destination is
  // symbolic, so the probe supplies a concrete Base to reach the definition
  // lookup the production flow performs after binding.
  const kernel = world().build();
  const run = runInstruction(
    token,
    { ...trigger.body[0].args, location: { kind: "constant", value: { type: "base", player: "A" } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(kernel.query({ zone: "board" }), []);
});

test("bandle-scouts-academy: the exhausted entry override has no frozen argument", () => {
  // The authored location is the symbolic controller Base, which the kernel
  // cannot resolve; the card program keeps it because the printed destination
  // is decided by the pending chain play flow.
  const placeholder = runInstruction(token, trigger.body[0].args, { world: world().build() });
  assert.equal(placeholder.result.status, "negated");
  assert.deepEqual(placeholder.world.query({ zone: "board" }), []);

  // The "exhausted" entry override (143.4 / 185.2.d) has no frozen argument;
  // passing it must be rejected rather than dropped.
  assert.throws(
    () =>
      runInstruction(
        token,
        {
          token: { kind: "constant", value: "recruit" },
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "A" } },
          exhausted: { kind: "constant", value: true }
        },
        { world: world().build() }
      ),
    /exhausted/
  );
});

test.todo(
  "bandle-scouts-academy: create the Gold token on the Chain and play it exhausted " +
    "(440.2.c / 185.2.a / 350.2 / 354; needs the finalized cost plan, RIFT-89)"
);
test.todo(
  "bandle-scouts-academy: card-hidden timing wiring for the Hide discretionary action " +
    "and the here-scoped battlefield filter (422.1 / 422.2; 依赖触发管线与 Battlefield 位置绑定)"
);
