import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/overzealous-fan.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ChainContractBlockedError, ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

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

test("sfd-128-221 Overzealous Fan: judgeReason names the merged and remaining gaps", () => {
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /466\.2\.c/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /characteristicsMatch/);
  assert.match(program.judgeReason, /107\.1\.c/);
  // CR 204.1.c names this card: the kill is the ability's Base Cost and must be
  // paid to Finalize, so the wiring gap must stay recorded.
  assert.match(program.judgeReason, /204\.1\.c/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  assert.match(program.judgeReason, /依赖：combat 的原子开始事务/);
  // The old combatRole filter-key rejection is no longer a gap.
  assert.doesNotMatch(program.judgeReason, /未注册该键|fail-closed/);
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
      // 466.2.c: the Attacker identity is read from the real ObjectSnapshot
      // field through the merged characteristics vocabulary.
      filter: { type: "unit", zone: "board", characteristics: { combatRole: "attacker" } },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "to its base" is the controller's Base (107.1.c: permanents controlled by a
  // player reside in that player's Base), derived from the chosen unit at
  // execution time by the merged target-controller-base selector.
  assert.deepEqual(moveAttacker.args.to, {
    kind: "constant",
    value: { kind: "target-controller-base", target: "overzealous-fan.attacking-unit" }
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
    "the 466.2.c Attacker designation — the filter spelling is now merged, but production combat " +
    "flow still never assigns combatRole (combat/flow.ts throws combat-start-transaction)"
);

test("sfd-128-221 Overzealous Fan: the merged filter vocabulary reads the 466.2.c Attacker identity", () => {
  // The published target now spells the identity through the real ObjectSnapshot
  // field (characteristics.combatRole) instead of the rejected bare combatRole
  // key, so layers/filter.ts characteristicsMatch is the production predicate.
  const [target] = moveAttacker.targets;
  const translated = translateInstructionTargets(ability.body)[0].args.body.value[1].targets[0];
  assert.deepEqual(translated.filter, target.filter);
  assert.deepEqual(target.filter, {
    type: "unit",
    zone: "board",
    characteristics: { combatRole: "attacker" }
  });

  const kernel = world()
    .unit("attacker", { owner: "B", controller: "B", might: 3, combatRole: "attacker" })
    .unit("defender", { owner: "B", controller: "B", might: 3, combatRole: "defender" })
    .unit("idle", { owner: "B", controller: "B", might: 3 })
    .build();
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("attacker")), true);
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("defender")), false);
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("idle")), false);
});

/**
 * Real ChainEngine over the reference kernel. The designation is written through
 * the world builder (the same route packages/engine-core/src/effects/testing/
 * README.md documents for combatRole), because production combat flow still
 * throws combat-start-transaction before it assigns one.
 */
function chainWorld(units, answers = {}) {
  const builder = world().player("A").player("B");
  for (const unit of units) {
    builder.unit(unit.id, {
      owner: unit.owner ?? "A", controller: unit.controller, types: ["unit"], might: unit.might ?? 3,
      zone: "board", location: { type: "battlefield", id: "bf1" }, combatRole: unit.combatRole ?? null
    });
  }
  const kernel = builder.build();
  // The answer map is returned so a caller can add answers (or a thunk that
  // reads this world's real references) after the kernel exists.
  const decide = (request) => {
    const answer = answers[request.id];
    if (typeof answer === "function") return answer(request, kernel);
    if (Object.hasOwn(answers, request.id)) return answer;
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel, answers };
}

test("sfd-128-221 Overzealous Fan: the same target really locks the attacker in a non-nested Finalize", () => {
  // Real Finalize + Resolve evidence for the merged identity predicate and the
  // merged target-controller-base destination. The body is the card's own move
  // instruction; only its nesting is lifted, because the merged chain rejects
  // nested targets before Finalize (assertFinalizationSurface, recorded in the
  // judgeReason as the second current gap).
  // The printed linkedTo (355.10.c.1: the kill is the cost of the move) is
  // asserted structurally above; the isolated move drops the link because the
  // linked kill-self instruction is not part of this lifted body.
  const { linkedTo: _link, ...moveOnly } = moveAttacker;
  const body = translateInstructionTargets([moveOnly]);
  const { engine, kernel, answers } = chainWorld([
    { id: "fan", owner: "A", controller: "A", might: 2 },
    // 466.2.c: the attacker is controlled by B while owned by A, so the
    // destination proves the controller's Base (107.1.c) rather than the owner's.
    { id: "attacker", owner: "A", controller: "B", might: 3, combatRole: "attacker" },
    { id: "idle", owner: "B", controller: "B", might: 3 }
  ]);
  // The printed move instruction chooses its target at Finalize; answer with the
  // real reference from this world (a bare id is not a valid selection).
  answers["target:overzealous-fan.attacking-unit"] = (request, world_) => [world_.ref("attacker")];
  engine.execute({ id: "fan-move", source: kernel.getObject("fan"), controller: "A", kind: "activated", speed: "reaction", body });

  const [plan] = engine.items[0].targetPlans;
  assert.equal(plan.requirement.id, "overzealous-fan.attacking-unit");
  assert.equal(plan.lockedAt, "finalize");
  assert.deepEqual(plan.selected.map((ref) => ref.id), ["attacker"]);
  engine.pass("A");
  engine.pass("B");
  assert.deepEqual(kernel.getObject("attacker").location, { type: "base", player: "B" });
  assert.deepEqual(engine.pipeline.events.filter((event) => event.timingPoint === "became-target").length, 1);
  assert.deepEqual(engine.pipeline.events.filter((event) => event.timingPoint === "object-moved").length, 1);
});

test("sfd-128-221 Overzealous Fan: non-attacker units stay outside Finalize's legal set", () => {
  // 466.2.c: the identity is not "any unit". Both a Defender and an
  // designation-free unit leave the requirement unfillable, so Finalize fails
  // closed instead of moving a non-attacker.
  const { linkedTo: _link, ...moveOnly } = moveAttacker;
  const body = translateInstructionTargets([moveOnly]);
  for (const extra of [{ combatRole: "defender" }, { combatRole: null }]) {
    const { engine, kernel } = chainWorld([
      { id: "fan", owner: "A", controller: "A", might: 2 },
      { id: "other", owner: "B", controller: "B", might: 3, ...extra }
    ]);
    assert.throws(
      () => engine.execute({ id: `fan-move-${String(extra.combatRole)}`, source: kernel.getObject("fan"), controller: "A", kind: "activated", speed: "reaction", body }),
      (error) => error.name === "TargetSelectionError" && error.code === "no-legal-targets"
    );
    assert.deepEqual(kernel.getObject("other").location, { type: "battlefield", id: "bf1" });
    assert.equal(engine.items.length, 0);
  }
});

test("sfd-128-221 Overzealous Fan: the nested target spelling is rejected before Finalize", () => {
  // Evidence for the second recorded gap: the printed shape keeps the target
  // inside the choice.optional body (contract 3.9), and the merged chain refuses
  // nested targets until an interpreter target-selection lifecycle adapter lands.
  const body = translateInstructionTargets(ability.body);
  const { engine, kernel } = chainWorld([
    { id: "fan", owner: "A", controller: "A", might: 2 },
    { id: "attacker", owner: "B", controller: "B", might: 3, combatRole: "attacker" }
  ]);
  assert.throws(
    () => engine.execute({ id: "fan-nested", source: kernel.getObject("fan"), controller: "A", kind: "triggered", speed: "normal", body }),
    (error) => error instanceof ChainContractBlockedError && /Nested\/repeated targets/.test(error.message)
  );
  assert.equal(engine.items.length, 0);
  assert.equal(kernel.getObject("fan").zone, "board");
});

test("sfd-128-221 Overzealous Fan golden: accepting the may kills the Fan and moves the chosen attacker to its controller's Base", () => {
  // 383.4.f / 355.10.c.1 / 107.1.c: with the defense trigger and Attacker
  // designation supplied by the combat layer, accepting the optional kill
  // destroys the Fan and then executes the linked real move through the
  // interpreter: the chosen attacker goes to the chosen unit's CONTROLLER's
  // Base — even when controller and owner differ (owner A, controller B).
  const kernel = world()
    .unit("fan", { owner: "A", might: 2 })
    .base("a-base", { owner: "A" })
    .base("b-base", { owner: "B" })
    .unit("attacker", { owner: "A", controller: "B", combatRole: "attacker" })
    .build();
  const context = withFanAsSource(kernel);
  context.setTargets("overzealous-fan.attacking-unit", [context.ref("attacker")]);
  context.setAnswers({ "overzealous-fan.may-kill/optional": true });

  const outcome = resolveChainBody(ability.body, context);

  assert.equal(outcome.status, "executed");
  // The optional choice flattens its accepted child instructions into the
  // outcome, so the executed ids end with the choice instruction itself.
  assert.deepEqual(outcome.results.map((entry) => entry.id), [
    "overzealous-fan.kill-self",
    "overzealous-fan.move-attacker",
    "overzealous-fan.may-kill"
  ]);
  assert.equal(context.getObject("fan").zone, "trash");
  assert.deepEqual(context.getObject("attacker").location, { type: "base", player: "B" });
  assert.deepEqual(context.events.map((event) => event.action), ["kill", "move-location"]);
});

test("sfd-128-221 Overzealous Fan: the kill-first-cost wiring stays recorded as judge-required evidence (204.1.c)", () => {
  // CR 204.1.c's printed example is this card: the kill is the triggered
  // ability's Base Cost, paid to finalize the ability — not a resolution-time
  // instruction. The production binder offers no cost/mayAtFinalize extraction,
  // so the golden above only proves the linked body executes; it is not
  // evidence that the Finalize cost flow is merged. This structural check keeps
  // the current-shape declaration honest and the gap recorded.
  assert.equal(mayKill.op, "choice.optional");
  assert.equal(ability.optional, false);
  assert.match(program.judgeReason, /204\.1\.c/);
  assert.match(program.judgeReason, /cost\/mayAtFinalize/);
});
