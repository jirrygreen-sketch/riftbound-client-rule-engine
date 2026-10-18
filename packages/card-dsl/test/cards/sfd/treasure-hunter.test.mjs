import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/treasure-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-391b4e14a6ac07093188b967dee259bef4f8692e3d1e87e6bb28cf249f3e788a";
const SOURCE_TEXT = "When I move, play a Gold gear token exhausted.";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-130-221 Treasure Hunter: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-130-221 Treasure Hunter: judgeReason names the current token gaps", () => {
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /LocationExpr/);
  assert.match(program.judgeReason, /ability-controller-base/);
  // 2026-10-18 re-sweep: the trigger-side blocker and the token-side syntax gap
  // are both named with their measured errors.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /Invalid effect\.token argument/);
});

test("sfd-130-221 Treasure Hunter: 'when I move' subscribes to object-moved scoped to this unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1-449.2 / 458: "When I move" is any successful Move; the
  // printed text names no destination, so no toZone filter is authored.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-130-221 Treasure Hunter: the body declares one Gold token played exhausted", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "treasure-hunter.play-gold-token");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, { kind: "location", value: "ability-controller-base" });
  // 184.1 / 185.2.d entry stipulation, never a later exhaust (143.4).
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "goldToken" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test.todo(
  "sfd-130-221 Treasure Hunter: play the Gold gear token through chain creation plus the hand-off play " +
    "(440.2.c / 185.2.a / 350.2 / 354) with the CR 187.5 Gold definition and its exhausted entry " +
    "(184.1 / 185.2.d); effect.token also needs to consume the contract LocationExpr " +
    "ability-controller-base as a runtime LocationRef."
);

// Live evidence for the refreshed reason: the declared trigger cannot register,
// the declared token arguments fail the frozen schema, and the Gold definition
// itself is absent from the merged token table.
test("sfd-130-221 Treasure Hunter: the object-moved trigger cannot register (EventPattern vocabulary)", () => {
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const { engine, kernel } = fixture({ cards: [{ id: "hunter", cardId: CANONICAL, types: ["unit"], might: 1 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("hunter"), to: "battlefield", location: { type: "battlefield", id: "bf-1" } });
  assert.throws(
    () => binding.registerProgramTriggers(engine, kernel.getObject("hunter")),
    (error) => {
      assert.equal(error.name, "TriggerSpecValidationError");
      assert.deepEqual([...new Set(error.issues.map((issue) => issue.code))], ["invalid-event-type"]);
      assert.equal(error.issues[0].path, "trigger.filter.event");
      return true;
    }
  );
  assert.equal(engine.pipeline.checkpoint().triggers.size, 0);
});

test("sfd-130-221 Treasure Hunter: the printed token arguments are not accepted by effect.token", () => {
  for (const key of ["location", "entersExhausted"]) {
    assert.throws(
      () => token.argsSchema.parse({ token: instruction.args.token, [key]: instruction.args[key] }),
      new RegExp(`Invalid effect\\.token argument: ${key}`)
    );
  }
  // A schema-legal spelling reaches the frozen definition table and records the
  // missing Gold definition instead of inventing one.
  const kernel = world().player("A", { energy: 5 }).unit("hunter", { might: 1, location: { type: "base", player: "A" } }).build();
  const run = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked.goldToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.linked.goldToken.amount, 0);
});
