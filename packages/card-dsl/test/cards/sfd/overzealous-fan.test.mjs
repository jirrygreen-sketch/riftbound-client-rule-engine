import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/overzealous-fan.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a6e0742278165d13dd6f68c8b8696d40709801c4e6c64fcdc4263f35d6edef38";
const SOURCE_TEXT = "When I defend, you may kill me to move an attacking unit to its base.";

const [ability] = program.abilities;
const [mayKill] = ability.body;
const [killSelf, moveAttacker] = mayKill.args.body.value;

// The reference kernel's `source` is snapshotted when the world is created, so
// a world built before the unit exists has no Board source. Pin the source to
// the Fan for the kill-self runs, and drop the move's TargetSpec to pre-lock the
// attacker (the challenge / one-two-punch convention; the production target
// pipeline resolves it at Finalize). The TargetSpec stays in the
// program and is asserted structurally below.
const withFanAsSource = (kernel) => kernel.clone({ sourceSnapshot: kernel.getObject("fan") });

test("sfd-128-221 Overzealous Fan: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-128-221 Overzealous Fan: judgeReason names all three merged gaps", () => {
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /466\.2\.c/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /combatRole\/designation/);
  assert.match(program.judgeReason, /198\.2/);
  assert.match(program.judgeReason, /controller-base/);
  assert.match(program.judgeReason, /combat 身份指派与事件发射/);
  assert.match(program.judgeReason, /target\.location 未合入/);
  assert.match(program.judgeReason, /Attacker designation/);
});

test("sfd-128-221 Overzealous Fan: 'when I defend' subscribes to defense-declared once per combat", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.f.1/383.4.f.2/466.2.c: the Defend Trigger fires on gaining the
  // Defender designation; "I" is this unit.
  assert.equal(ability.trigger.at, "defense-declared");
  assert.deepEqual(ability.trigger.filter, { event: "defense-declared", source: "self" });
  // 383.4.f.2.a.
  assert.equal(ability.trigger.once, "per-combat");
  assert.equal(ability.optional, false);
});

test("sfd-128-221 Overzealous Fan: the may-shape kills the source, then moves an attacker home (contract 3.9)", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["overzealous-fan.may-kill"]);
  assert.equal(mayKill.op, "choice.optional");
  assert.equal(mayKill.args.body.kind, "constant");
  assert.deepEqual(mayKill.args.body.value.map((instruction) => instruction.id), [
    "overzealous-fan.kill-self",
    "overzealous-fan.move-attacker"
  ]);
  assert.deepEqual(mayKill.args.prompt, {
    kind: "constant",
    value: "Kill Overzealous Fan to move an attacking unit to its base?"
  });

  // 429.1 / 429.1.a.1.a: "kill me" is an active Kill of the ability's own
  // source; effect.kill's self form (816.1.b pattern).
  assert.equal(killSelf.op, "effect.kill");
  assert.deepEqual(killSelf.args.self, { kind: "constant", value: true });
  assert.deepEqual(killSelf.args.reason, { kind: "constant", value: "kill-this" });
  assert.equal(killSelf.targets, undefined);
  assert.equal(killSelf.linkedTo, undefined);

  // 355.10.c.1: "[do X] to [do Y]" makes the kill the cost of the Move, so the
  // move is linked to the kill. The attacker is a target (355.9.a.1).
  assert.equal(moveAttacker.op, "effect.move");
  assert.equal(moveAttacker.linkedTo, "overzealous-fan.kill-self");
  assert.deepEqual(moveAttacker.targets, [
    {
      id: "overzealous-fan.attacking-unit",
      filter: { type: "unit", zone: "board", attacking: true },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "to its base" is the owner's Base (198.2), derived from the chosen unit;
  // controller-base would follow the post-move controller and is not used.
  assert.deepEqual(moveAttacker.args.to, {
    kind: "constant",
    value: { ownerBaseOf: { target: "overzealous-fan.attacking-unit" } }
  });
  assert.equal(moveAttacker.args.mode, undefined);
  assert.deepEqual(moveAttacker.args.linkKey, { kind: "constant", value: "moved" });
  assert.equal(mayKill.linkedTo, undefined);
});

test("sfd-128-221 Overzealous Fan golden: declining the may kills nothing", () => {
  const kernel = world().unit("fan", { owner: "A", might: 2 }).build();
  kernel.setAnswers({ "overzealous-fan.may-kill/optional": false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.id), ["overzealous-fan.may-kill"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("fan").zone, "board");
});

test("sfd-128-221 Overzealous Fan golden: the kill-self half really kills the source (429)", () => {
  const kernel = world().unit("fan", { owner: "A", might: 2 }).build();
  const context = withFanAsSource(kernel);
  const run = runInstruction(
    kill,
    { self: true, reason: "kill-this" },
    { world: context }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(context.getObject("fan").zone, "trash");
  // The pre-clone world is untouched: runInstruction only mutates its target.
  assert.equal(kernel.getObject("fan").zone, "board");
  assert.deepEqual(run.linked.killed, [{ id: "fan", zoneEntryId: 1 }]);
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test.todo(
  "sfd-128-221 Overzealous Fan: the defense-declared timing point is emitted when this unit gains " +
    "the Defender designation (383.4.f.2, 466.2.c/323.2) — combat/ has no emission path yet " +
    "(combat/flow.ts throws combat-start-transaction)"
);

test.todo(
  "sfd-128-221 Overzealous Fan: finalize can reject non-attacking units for \"an attacking unit\" using " +
    "the 466.2.c Attacker designation (contract 3.8 combatRole; ObjectSnapshot has no such field yet)"
);

test.todo(
  "sfd-128-221 Overzealous Fan: \"to its base\" resolves the chosen attacker's OWNER's Base (198.1/198.2) " +
    "as a derived LocationRef instead of controller-base — target.location destination plan"
);

test.todo(
  "sfd-128-221 Overzealous Fan golden: accepting the may kills the Fan and then moves the chosen " +
    "attacker to its owner's Base; the authored destination is a declared owner-base marker (198.2), " +
    "so no authentic execution is possible until that LocationRef is resolvable"
);
