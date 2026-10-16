import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/honest-broker.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1289ecc082dc4dbd1ce937e07ccee8fcc9cd4f5f461b7043454560af9c237716";
const [keyword, deathknell] = program.abilities;

test("sfd-155-221 Honest Broker: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /RIFT-82/);
  assert.equal(
    program.sourceText,
    "[Deathknell] — Play a Gold gear token exhausted. (When I die, get the effect.)"
  );
});

test("sfd-155-221 Honest Broker: Deathknell keyword + object-killed trigger on self", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.kind, "triggered");
  assert.equal(deathknell.trigger.at, "object-killed");
  assert.deepEqual(deathknell.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  assert.equal(deathknell.optional, false);
});

test("sfd-155-221 Honest Broker: body declares one Gold token played exhausted", () => {
  assert.equal(deathknell.body.length, 1);
  const [instruction] = deathknell.body;
  assert.equal(instruction.id, "honest-broker.play-gold-token");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // 184.1 / 185.2.d entry stipulation, never a later exhaust (143.4).
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.targets, undefined);
});

test("sfd-155-221 Honest Broker: the merged create-token action has no Gold definition", () => {
  // CR 187.5 defines the Gold gear token with its own printed ability; the
  // frozen effect.token definition table deliberately excludes it, so the
  // primitive reports negated/impossible with a blockedReason instead of
  // inventing a definition. This is the judged half of the card.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "gold" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "goldToken" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.goldToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.linked["goldToken.amount"], 0);
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 0);
});

test("sfd-155-221 Honest Broker: the authored entry-state argument has no primitive support", () => {
  // The body declares the printed "exhausted" entry stipulation (184.1 /
  // 185.2.d). The frozen primitive supports no entry override at all, so the
  // authored arguments are rejected rather than silently entering ready.
  const kernel = world().player("A").build();
  assert.throws(
    () => runInstruction(token, deathknell.body[0].args, { world: kernel }),
    /Invalid effect\.token argument: entersExhausted/
  );
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 0);
});

test.todo(
  "sfd-155-221 Honest Broker: resolve the Deathknell [Effect] through the real chain once the " +
    "Gold gear definition (CR 187.5), chain creation + cost-waived play (440.2.c / 185.2.a) and the " +
    "exhausted entry stipulation (184.1 / 185.2.d) exist (RIFT-62 token work, RIFT-82 kw-deathknell)"
);
