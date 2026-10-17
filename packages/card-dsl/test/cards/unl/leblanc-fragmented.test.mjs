import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/leblanc-fragmented.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-b8d443a7b94f10a4f56f95ffc2b338f17de7a1fbc3a76e380bf2cd67a5436a7e";
const SOURCE_TEXT =
  "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
  "[Deathknell][>] Draw 1. If it's your Beginning Phase, draw 2 instead. (When I die, get the effect.)";

const [assault, deathknell, triggered] = program.abilities;
const [drawOne, drawTwo] = triggered.body;

test("unl-172-219 LeBlanc, Fragmented: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-172-219 LeBlanc, Fragmented: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /807\.1/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /Beginning Phase/);
});

test("unl-172-219 LeBlanc, Fragmented: [Assault] and [Deathknell] are declared, never expanded in the card", () => {
  // 807.1.b.3: the printed Assault has no value, so value is omitted (default 1 is
  // the keyword expansion's job, contract 3.7).
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.equal(assault.value, undefined);
  // 808.1: Deathknell is only declared here; the [Effect] is attached below as an
  // object-killed trigger (the ruined-rex / kogmaw-caustic shape).
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
});

test("unl-172-219 LeBlanc, Fragmented: Deathknell is registered and exposes the merged object-killed skeleton", () => {
  const definition = keywordDefinitionsById.get("Deathknell");
  assert.ok(definition, "effects/keywords/Deathknell.ts must be registered");
  const [expanded] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.trigger.at, "object-killed");
  assert.deepEqual(expanded.trigger.filter, {
    self: true,
    cause: "kill",
    destination: "trash"
  });
  assert.deepEqual(expanded.body.map(instruction => [instruction.id, instruction.op]), [
    [`deathknell:${CANONICAL_ID}:leave`, "trigger.leave"]
  ]);
});

test("unl-172-219 LeBlanc, Fragmented: the Deathknell effect is an object-killed trigger of the host", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(triggered.kind, "triggered");
  // 808.1.c / 808.1.d: "When I die" = this card being killed (object-killed,
  // put on the chain before it is placed in Trash).
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    filter: { source: "self" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
});

test("unl-172-219 LeBlanc, Fragmented: 'draw 1' and the 'draw 2 instead' branch are mutually exclusive", () => {
  assert.deepEqual(triggered.body.map(instruction => [instruction.id, instruction.op]), [
    ["leblanc-fragmented.draw-1", "effect.draw"],
    ["leblanc-fragmented.draw-2", "effect.draw"]
  ]);
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawTwo.args.amount, { kind: "constant", value: 2 });
  // 367: "draw 2 instead" replaces the printed "Draw 1." — the two branches are
  // guarded by complementary conditions on the same Beginning-Phase placeholder.
  assert.equal(drawOne.condition.kind, "not");
  assert.deepEqual(drawOne.condition.condition, drawTwo.condition);
  assert.equal(drawTwo.condition.kind, "compare");
  assert.equal(drawTwo.condition.operator, "eq");
  assert.deepEqual(drawTwo.condition.left, {
    kind: "object-property",
    object: "self",
    property: "leblanc-fragmented.controller-beginning-phase"
  });
  assert.deepEqual(drawTwo.condition.right, { kind: "constant", value: true });
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawTwo.linkedTo, undefined);
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawTwo.picks, undefined);
});

test("unl-172-219 LeBlanc, Fragmented golden: 'Draw 1.' moves the top card of the deck to hand", () => {
  // 414.3: the printed Draw 1 is the merged effect.draw primitive.
  // An array deck() call lists cards top-to-bottom: "top" is the first card drawn.
  const kernel = world().deck(["top", "bottom"], { owner: "A" }).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top"]);
});

test("unl-172-219 LeBlanc, Fragmented golden: the Beginning-Phase branch draws 2 through the same primitive", () => {
  const kernel = world().deck(["c1", "c2", "c3"], { owner: "A" }).build();
  const run = runInstruction(draw, drawTwo.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["c1", "c2"]);
});

test("unl-172-219 LeBlanc, Fragmented golden: the phase placeholder fails closed, so draw 2 never fires spuriously", () => {
  // The Beginning-Phase characteristic has no merged reader: the reference kernel
  // evaluates the placeholder property to null, so the compare is false. The
  // draw-1 branch therefore remains the resolvable default and the 'instead'
  // branch cannot fire without the missing phase state.
  const kernel = world().unit("leblanc").build();
  assert.equal(kernel.test(drawTwo.condition), false);
  assert.equal(kernel.test(drawOne.condition), true);
});

test("unl-172-219 LeBlanc, Fragmented golden: CardProgram triggers register through the merged binding", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const board = fixture({
    cards: [{ id: "leblanc", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Order"], might: 3 }]
  });
  const source = { ...board.kernel.getObject("leblanc"), cardId: CANONICAL_ID, zone: "board" };
  const ids = binding.registerProgramTriggers(board.engine, source);
  assert.equal(ids.length, 2);
  assert.ok(ids.every(id => id.startsWith("program:leblanc:1:")));
});

test.todo(
  "unl-172-219 LeBlanc, Fragmented: read the controller's Beginning Phase at resolution (383.2.a.1/367) " +
    "so the 'draw 2 instead' branch can be evaluated instead of the fail-closed placeholder"
);
test.todo(
  "unl-172-219 LeBlanc, Fragmented: [Deathknell] keyword expansion (808.1.d.1 replaced death leaves the chain, " +
    "808.1.d.2/.d.3 last-known info before the zone change) — the registered KeywordDef still references " +
    "the unregistered trigger.leave primitive"
);
test.todo(
  "unl-172-219 LeBlanc, Fragmented: [Assault] expansion consumer (807.1.c attacker designation, contract 3.8 " +
    "combatRole) so the keyword actually grants +1 Might while attacking"
);
