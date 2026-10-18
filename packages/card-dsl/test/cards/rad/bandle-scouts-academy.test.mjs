import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/bandle-scouts-academy.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";

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
  assert.ok(program.judgeReason.includes("Universal Power"));
  assert.ok(program.judgeReason.includes("cardId:null"));
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
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|261)/);
});

test("bandle-scouts-academy: the here-scoped card-hidden trigger still cannot be translated", () => {
  // 422.1 / 422.2: "when you hide a card here" must be scoped to this
  // Battlefield, and the merged filter translator has no spelling for it.
  assert.throws(
    () => translateTriggerFilter(trigger.trigger.filter, "bandle", "card-hidden"),
    error => error.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const kernel = world().unit("bandle", { cardId: program.canonicalCardId, types: ["battlefield"], zone: "board" }).build();
  assert.throws(
    () => triggerRegistrations(registry, kernel.getObject("bandle")),
    error => error.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
});

test("bandle-scouts-academy: the declared Gold token instruction is really refused, with an exhausted entry override impossible", () => {
  // 187.5: Gold is an ability-bearing gear token, so it is deliberately absent
  // from the frozen definition table; 143.4 / 185.2.d: the printed "exhausted"
  // entry stipulation has no argument either.
  const instruction = trigger.body[1];
  // The body runs through the real interpreter so the linked controller-Base
  // location resolves exactly as it would at resolution time.
  const kernel = world().player("A").unit("bandle", { types: ["battlefield"], zone: "board" }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("bandle") });
  const outcome = resolveChainBody(trigger.body, scoped);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["bandle-scouts-academy.read-base", "executed"],
    ["bandle-scouts-academy.play-gold", "negated"]
  ]);
  assert.deepEqual(outcome.linkedValues["bandle-scouts-academy.read-base.base"], { type: "base", player: "A" });
  assert.equal(
    outcome.linkedValues["bandle-scouts-academy.play-gold.goldToken"].blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  assert.equal(outcome.linkedValues["bandle-scouts-academy.play-gold.goldToken"].amount, 0);
  assert.throws(
    () => runInstruction(token, { ...instruction.args, entriesExhausted: { kind: "constant", value: true } }, { world: world().build() }),
    /Invalid effect\.token argument: entriesExhausted/
  );
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

test("bandle-scouts-academy: body resolves the controller base then plays the CR 187.5 Gold token", () => {
  assert.equal(trigger.body.length, 2);
  const [readBase, instruction] = trigger.body;
  assert.equal(readBase.op, "condition.value");
  assert.deepEqual(readBase.args.value, {
    kind: "location",
    value: "ability-controller-base"
  });
  assert.equal(instruction.id, "bandle-scouts-academy.play-gold");
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.linkedTo, readBase.id);
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "linked-value",
    instructionId: readBase.id,
    key: "base"
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
});

test("bandle-scouts-academy: the printed exhausted entry stipulation is not carried by the frozen token args", () => {
  // CR 143.4 / 184.1 / 185.2.d: slug and entry state are one printed stipulation.
  // The frozen create-token arguments have no field for the entry state, so the
  // program records it in judgeReason instead of adding a follow-up exhaust.
  assert.deepEqual(Object.keys(trigger.body[1].args).sort(), ["amount", "linkKey", "location", "mode", "token"]);
  assert.match(program.judgeReason, /argsSchema/);
});

test.todo(
  "bandle-scouts-academy: create the Gold token on the Chain and play it exhausted in the " +
    "production chain (440.2.c / 185.2.a / 350.2 / 354; needs the Gold definition, the exhausted " +
    "entry stipulation and the Gold program identity/describePlay adapter). The controller-Base " +
    "resolution and the measured fail-closed refusal are covered by the real-execution test above."
);
test.todo(
  "bandle-scouts-academy: card-hidden timing wiring for the Hide discretionary action " +
    "and the here-scoped battlefield filter (422.1 / 422.2; the Hide action and the card-hidden " +
    "producer are not merged, card-hidden is not in EVENT_PATTERN_TYPES, and the filter " +
    "translator rejects the here anchor)"
);
