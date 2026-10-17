import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/loyal-pup.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-f4e865137dd3c74c2b7b55f74508a0cb2f04b8d181e7103a6fb0316f8b6b4f63";
const SOURCE_TEXT = "When you defend at a battlefield, you may move me there.";

const [ability] = program.abilities;
const [mayMove] = ability.body;
const [moveSelf] = mayMove.args.body.value;

test("sfd-126-221 Loyal Pup: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-126-221 Loyal Pup: judgeReason names the defense emission and destination-binding gaps", () => {
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /466\.2\.c/);
  assert.match(program.judgeReason, /383\.4\.f\.2/);
  assert.match(program.judgeReason, /payloadFields/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /RIFT-357/);
});

test("sfd-126-221 Loyal Pup: 'when you defend at a battlefield' subscribes to defense-declared once per combat", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.f / 383.4.f.2 / 466.2.c: the Defend Trigger fires when the defender
  // gains the Defender designation; "you" is the ability controller (190.6.d).
  assert.equal(ability.trigger.at, "defense-declared");
  assert.deepEqual(ability.trigger.filter, { event: "defense-declared", player: "self" });
  // 383.4.f.2.a: the trigger condition is checked only once per combat.
  assert.equal(ability.trigger.once, "per-combat");
  assert.equal(ability.trigger.condition, undefined);
  // 403.1: "you may" is the instruction-level optional wrapper, so the trigger
  // itself is mandatory.
  assert.equal(ability.optional, false);
});

test("sfd-126-221 Loyal Pup: the may-shape moves the source itself with contract 3.9", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["loyal-pup.may-move"]);
  assert.equal(mayMove.op, "choice.optional");
  assert.equal(mayMove.args.body.kind, "constant");
  assert.deepEqual(mayMove.args.body.value.map((instruction) => instruction.id), ["loyal-pup.move-self"]);

  // 451: an effect Move; "me" is the ability's own source, written with the
  // contract 3.6 symbolic selector (never a runtime ObjectRef).
  assert.equal(moveSelf.op, "effect.move");
  assert.deepEqual(moveSelf.args.objects, { kind: "constant", value: "source" });
  assert.deepEqual(moveSelf.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveSelf.args.linkKey, { kind: "constant", value: "moved" });
  // "there" = the defended battlefield; a runtime LocationRef cannot be written
  // into static IR and the event payload does not carry it (see judgeReason),
  // so the program declares the missing referent instead of inventing a
  // battlefield id that could silently move Loyal Pup to the wrong place.
  assert.deepEqual(moveSelf.args.to, {
    kind: "constant",
    value: { referent: "defending-battlefield" }
  });
  // No target: "me" is the source, not a chosen object.
  assert.equal(moveSelf.targets, undefined);
  assert.equal(moveSelf.picks, undefined);
  assert.equal(moveSelf.linkedTo, undefined);
  assert.equal(mayMove.linkedTo, undefined);
});

test("sfd-126-221 Loyal Pup golden: declining the may leaves Loyal Pup where it is", () => {
  const kernel = world()
    .unit("pup", { owner: "A", location: { type: "base", player: "A" } })
    .build();
  kernel.setAnswers({ "loyal-pup.may-move/optional": false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.id), ["loyal-pup.may-move"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.getObject("pup").location, { type: "base", player: "A" });
});

test.todo(
  "sfd-126-221 Loyal Pup: the defense-declared timing point is emitted when this unit gains the " +
    "Defender designation (383.4.f.2, 466.2.c/323.2) — combat/ has no emission path yet " +
  "(combat/flow.ts throws combat-start-transaction)"
);

test.todo(
  "sfd-126-221 Loyal Pup: the defended battlefield reaches the ability as a resolvable destination for " +
  "\"there\" (359.3.f.1 referent; the timing-point payload declares no fields) — the in-progress " +
  "RIFT-357 runtime Location choice"
);

test.todo(
  "sfd-126-221 Loyal Pup golden: accepting the may moves Loyal Pup from its current Location to the " +
    "defended battlefield; the authored destination is a declared referent marker (359.3.f.1), so no " +
  "authentic execution is possible until the defended battlefield is resolvable — RIFT-357"
);
