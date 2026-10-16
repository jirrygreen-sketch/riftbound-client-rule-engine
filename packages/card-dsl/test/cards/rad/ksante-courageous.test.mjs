import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ksante-courageous.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-5a036961fb00b9d4befa78e1fb2d424a4647453d50975b08ec9edb34881c6035";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "When I hold, channel 1 rune.";

test("rad-086-167 K'Sante, Courageous: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /383\.4\.d/);
  assert.match(program.judgeReason, /RIFT-86/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-086-167 K'Sante, Courageous: Accelerate and Shield 2 keyword declarations", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  assert.equal(program.abilities[0].value, undefined);
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "shield", value: 2 });
});

test("rad-086-167 K'Sante, Courageous: hold trigger channels exactly one rune", () => {
  const triggered = program.abilities[2];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "hold");
  assert.deepEqual(triggered.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["ksante-courageous.channel"]);

  const [instruction] = triggered.body;
  assert.equal(instruction.op, "effect.channel");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  // 431.2: without an "exhausted" stipulation the runes are channelled readied.
  assert.equal(instruction.args.exhausted, undefined);
});

test("rad-086-167 K'Sante, Courageous: channel 1 rune moves the top rune of the Rune Deck (CR 431.1)", () => {
  const [instruction] = program.abilities[2].body;
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const run = runInstruction(channel, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
  assert.equal(kernel.getObject("top-rune").exhausted, false);
  assert.equal(run.events[0].action, "channel-rune");
});

test("rad-086-167 K'Sante, Courageous: the hold trigger body executes through the interpreter", () => {
  const body = program.abilities[2].body;
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues, { "ksante-courageous.channel.channeled": 1 });
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
});

test("rad-086-167 K'Sante, Courageous: an empty Rune Deck channels as many as possible without negating (CR 431.3)", () => {
  const [instruction] = program.abilities[2].body;
  const kernel = world().build();
  const run = runInstruction(channel, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test.todo(
  "ksante-courageous: [Accelerate] expansion (CR 805 optional additional cost [1] + matching-domain Power and the" +
    " enter-ready replacement) through the Accelerate KeywordDef and the cost pipeline (RIFT-86 / RIFT-89)"
);
test.todo(
  "ksante-courageous: [Shield 2] expansion (+2 Might while defending) through the Shield KeywordDef and layers" +
    " (RIFT-81 / RIFT-91)"
);
test.todo(
  "ksante-courageous: hold trigger end-to-end (CR v1.5 383.4.d.2/.2.a): the 'hold' timing point emitted by scoring" +
    " must carry the battlefield unit present during the hold (RIFT-31 scenarios-scoring / RIFT-33 scenarios-triggers)"
);
