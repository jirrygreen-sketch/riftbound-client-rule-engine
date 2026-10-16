import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/trove-golem.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6e0d0c7e82324687174e1c1585a9fdba369a29e517e743eb601994ed2edb5de9";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-174-221 Trove Golem: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.equal(
    program.sourceText,
    "When you play me, play four Gold gear tokens exhausted."
  );
});

test("sfd-174-221 Trove Golem: card-played self trigger plays four Gold tokens", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(instruction.linkedTo, undefined);
});

test("sfd-174-221 Trove Golem: the merged primitive reports the Gold definition gap", () => {
  // CR 187.5 defines Gold with its own printed ability; the frozen definition
  // table excludes it, so the primitive negates with a blockedReason instead of
  // creating a definition-less token.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "gold" },
      amount: { kind: "constant", value: 4 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "goldTokens" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.goldTokens.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.linked["goldTokens.amount"], 0);
  assert.deepEqual(run.linked["goldTokens.objects"], []);
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 0);
});

test("sfd-174-221 Trove Golem: the authored entry-state argument has no primitive support", () => {
  // "exhausted" is an entry stipulation (184.1 / 185.2.d) that the frozen
  // creation/play actions cannot express; the authored args are rejected
  // instead of silently entering ready.
  const kernel = world().player("A").build();
  assert.throws(
    () => runInstruction(token, instruction.args, { world: kernel }),
    /Invalid effect\.token argument: entersExhausted/
  );
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 0);
});

test.todo(
  "sfd-174-221 Trove Golem: create and play four Gold gear tokens exhausted once the Gold definition " +
    "(CR 187.5), chain creation (440.2.c / 185.2.a) and the entry-state stipulation (184.1 / 185.2.d) " +
    "are merged (token primitive task)"
);
