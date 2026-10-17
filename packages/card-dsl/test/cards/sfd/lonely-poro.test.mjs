// RIFT-680: layer-1/2 checks (validation, identity, structure). Layer-3 real
// execution evidence (trigger pipeline row + gap behavior) lives in the
// parameterized template suite:
// test/cards/templates/keyword-triggered-object-killed-effect-d-680.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lonely-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-ead599cc175549f33e7ce605d2fc97d6e65ce56a91ca97055d06554ed4cea1ae";

const [deathknell, diedAlone] = program.abilities;
const [drawInstruction] = diedAlone.body;

test("sfd-036-221 Lonely Poro: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-036-221 Lonely Poro: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Deathknell] — If I died alone, draw 1. (When I die, get the effect. I'm alone if there are no other friendly units here.)"
  );
});

test("sfd-036-221 Lonely Poro: judgeReason names the trigger.leave and pre-chain condition gaps", () => {
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /Deathknell/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /attachProgramLifecycle/);
  assert.match(program.judgeReason, /object-leaves-board/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("sfd-036-221 Lonely Poro: [Deathknell] is declared, not re-implemented (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.value, undefined);
});

test("sfd-036-221 Lonely Poro: the printed [Effect] is hosted on an object-killed trigger", () => {
  // 808.1.c / 808.1.d: Deathknell is functionally "When I die, [Effect]." The
  // trigger is the permanent being killed and sent to the Trash (429.1.a.1.b).
  assert.equal(diedAlone.kind, "triggered");
  assert.equal(diedAlone.trigger.at, "object-killed");
  assert.deepEqual(diedAlone.trigger.filter, { event: "object-killed", filter: { source: "self" } });
  assert.equal(diedAlone.optional, false);
  assert.equal(diedAlone.trigger.once, undefined);
});

test("sfd-036-221 Lonely Poro: 'died alone' is a pre-chain condition reading the source's location", () => {
  // 740.2.a: "a unit is alone when there are no other friendly units at the
  // same location"; 808.1.c.2: a past-tense Effect refers to the state when the
  // ability was put on the chain, so the check is a trigger condition.
  const condition = diedAlone.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.deepEqual(condition.right, { kind: "constant", value: 0 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  // The filter is anchored with symbolic selectors only (contract 3.6):
  // sameLocationAs: "source" and exclude: "source" carry no runtime refs.
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "source",
    exclude: "source"
  });
});

test("sfd-036-221 Lonely Poro: the trigger body draws exactly 1 with a single unlinked instruction", () => {
  assert.equal(diedAlone.body.length, 1);
  assert.equal(drawInstruction.id, "lonely-poro.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test.todo(
  "sfd-036-221 Lonely Poro: [Deathknell] expansion (subscribe object-killed, 808.1.d.1 removal from " +
    "the chain when the death is replaced, 808.1.d.3 last-known information recorded pre-chain) — the " +
    "KeywordDef only references the unmerged trigger.leave op (no InstructionDef is registered)"
);

test.todo(
  "sfd-036-221 Lonely Poro: 'died alone' is checked against the source's location before the trigger " +
    "is queued (CR 740.2.a, 808.1.c.2) — the reference kernel's test() does not interpret the " +
    "sameLocationAs/exclude anchors or normalize the controller placeholder, so the count collapses " +
    "to 0 and the condition is always true; a production condition adapter with last-known location " +
    "is required"
);

test.todo(
  "sfd-036-221 Lonely Poro: the object-killed trigger must be delivered to the chain — " +
    "attachProgramLifecycle unregisters the card's registration on object-leaves-board, and the kill " +
    "action's object-killed event scans after it, so the death trigger is removed before delivery " +
    "(reproduced on the real ChainEngine: registration present, no chain item after a kill)"
);
