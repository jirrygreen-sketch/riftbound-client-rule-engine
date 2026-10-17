import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/honest-broker.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

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
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /RIFT-82/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
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

test("sfd-155-221 Honest Broker: the token instruction carries the Gold spec, play mode and entry state", () => {
  // The authored arguments are the complete, reviewable instruction the merged
  // play-mode primitive consumes once a Gold definition exists; the entry
  // stipulation rides on the instruction (184.1 / 185.2.d) rather than as a
  // later exhaust (143.4).
  const [instruction] = deathknell.body;
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "goldToken" });
});

test.todo(
  "sfd-155-221 Honest Broker: resolve the Deathknell [Effect] through the real chain once the " +
    "Gold gear definition (CR 187.5), chain creation + cost-waived play (440.2.c / 185.2.a) and the " +
    "exhausted entry stipulation (184.1 / 185.2.d) exist (RIFT-62 token work, RIFT-82 kw-deathknell)"
);

test("sfd-155-221 Honest Broker: the object-killed trigger and the Deathknell expansion both bind through the merged program binding", () => {
  // RIFT-257's binding registers the card's explicit triggered ability and the
  // keyword expansion's trigger shape; execution is blocked by the missing Gold
  // definition (the golden above), not by the subscription path.
  const source = {
    ref: { id: "honest-broker", zoneEntryId: 1 },
    cardId: CANONICAL,
    name: "Honest Broker",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 2,
    energy: 2,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const registered = [];
  const engine = { pipeline: { registerTrigger: (registration) => registered.push(registration.id) } };
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const ids = binding.registerProgramTriggers(engine, source);

  assert.equal(ids.length, registered.length);
  assert.ok(ids.length >= 1, "the authored object-killed trigger must register");
  assert.ok(registered.every(id => id.startsWith("program:honest-broker:1:")));
});
