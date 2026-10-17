import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/frozen-fortress.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-09252b56d2b61d29cf38395a75ff54e4d386d4bfa33c0754a32ef693dd912c1a";
const SOURCE_TEXT =
  "At the start of each player's Beginning Phase, deal 1 to each unit here. (This happens before scoring.)";
const TARGET_ID = "frozen-fortress.units-here";

const [ability] = program.abilities;
const [deal] = ability.body;

/**
 * Run the card's own instruction with a test-side locked set. The program
 * deliberately has no TargetSpec for the "each unit here" set (CR v5.15
 * 355.10.d: the set is programmatically selected, never chosen, so it is not a
 * target), so the reference kernel must be handed the set directly — the same
 * layered convention ogn/anivia-primal uses. This checks the printed amount and
 * the per-unit handling, not that the card is executable end to end.
 */
function dealWithLockedSet(kernel, refs) {
  return runInstruction(
    damage,
    { amount: deal.args.amount, target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: refs } }
  );
}

test("unl-212-219 Frozen Fortress: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-212-219 Frozen Fortress: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-212-219 Frozen Fortress: judgeReason names the stale claims and the surviving set-damage gap", () => {
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /TargetSpec/);
  // The emission and TriggerRegistration claims are stale: both merged (turn
  // flow + programs/triggers.ts), so the reason no longer cites them as gaps.
  assert.ok(!/没有.*emit|触发注册/.test(program.judgeReason));
  assert.match(program.judgeReason, /programs\/triggers\.ts/);
});

test("unl-212-219 Frozen Fortress: the beginning-start trigger deals a fixed 1 with no target declared", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 315.2.a.1: effects happen at the start of Beginning Phase, before the
  // Scoring Step of 315.2.b runs ("This happens before scoring.").
  assert.equal(ability.trigger.at, "beginning-start");
  // "each player's": the trigger is not gated on the Battlefield's controller
  // (190.6.b covers the uncontrolled case). `at` is the phase timing point;
  // the pipeline event enum has no phase discriminant (see the source gap),
  // so the IR filter intentionally names no closed event type.
  assert.deepEqual(ability.trigger.filter, {});
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 1);
  assert.equal(deal.id, "frozen-fortress.damage-units-here");
  assert.equal(deal.op, "effect.damage");
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 1 });
  // The "each unit here" set is NOT a target (355.10.d/355.10.d.1): the value
  // below is a documented placeholder and the program carries no TargetSpec,
  // because registering one would make every unit a target (355.9/754).
  assert.deepEqual(deal.args.target, { kind: "literal", value: TARGET_ID });
  assert.equal(deal.targets, undefined);
  assert.equal(deal.picks, undefined);
  assert.equal(deal.linkedTo, undefined);
  assert.equal(deal.condition, undefined);
});

test("unl-212-219 Frozen Fortress: the fixed 1 damage hits every unit in the locked set (418.1.c/d)", () => {
  const kernel = world()
    .unit("own-here", { owner: "A" })
    .unit("enemy-here", { owner: "B" })
    .build();
  const run = dealWithLockedSet(kernel, [
    kernel.ref("own-here"),
    kernel.ref("enemy-here")
  ]);

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("own-here").damage, 1);
  assert.equal(kernel.getObject("enemy-here").damage, 1);
  // 418.1.c: the damage is marked separately on each unit.
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.equal(run.result.linkedValues.dealtCount, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
});

test("unl-212-219 Frozen Fortress: a unit that already left the battlefield drops out, the rest still take 1 (359.3.e.8)", () => {
  const kernel = world()
    .unit("staying", { owner: "A" })
    .unit("leaving", { owner: "B" })
    .build();
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "kill", object: stale });

  const run = dealWithLockedSet(kernel, [kernel.ref("staying"), stale]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("staying").damage, 1);
  assert.equal(run.result.linkedValues.dealt, 1);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("unl-212-219 Frozen Fortress: an empty set mistargets instead of inventing victims (355.10.d)", () => {
  const kernel = world().unit("elsewhere", { owner: "A" }).build();
  const run = dealWithLockedSet(kernel, []);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("elsewhere").damage, 0);
});

test("unl-212-219 Frozen Fortress: the merged trigger path can carry the beginning-start trigger", () => {
  // 315.2.a.1: the timing point is emitted by the turn flow, and
  // programs/triggers.ts does shape CardProgram triggers; the production
  // path is still gated by this card's judged executable status.
  const f = fixture({ cards: [{ id: "fortress", cardId: CANONICAL, types: ["battlefield"] }] });
  // ProgramRegistry.get gates on status === "executable", which is exactly
  // this card's judged gap; assert the gate first, then use the registry's
  // status-free inspect() to show the merged translation path can carry
  // this trigger shape.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const source = f.kernel.getObject("fortress");
  assert.throws(
    () => binding.registerProgramTriggers(f.engine, source),
    error => error instanceof Error && error.name === "ProgramBindingError"
  );
  // inspect() is status-free. The remaining engine gap is that the trigger
  // filter enum has no phase discriminator: translating the card's phase-only
  // filter yields {} and that cannot correctly express "this timing point".
  // This exercises the merged registration path and documents that boundary.
  const inspected = binding.inspect(source);
  assert.equal(inspected.program.canonicalCardId, CANONICAL);
  const [triggered] = expandProgram(inspected.program, { ...source, keywords: [] }).abilities.filter(item => item.kind === "triggered");
  assert.equal(triggered.trigger.at, "beginning-start");
  const registration = {
    id: `program:fortress:${source.ref.zoneEntryId}:0`,
    source,
    controller: source.controller,
    spec: { at: triggered.trigger.at, filter: translateTriggerFilter(triggered.trigger.filter, source.ref.id, "") },
    body: translateInstructionTargets(triggered.body),
    optional: triggered.optional,
    activeZones: ["board"],
    boundToIncarnation: true
  };
  // The phase-only filter has no closed event discriminant, so translation
  // leaves an empty ObjectFilter. Pipeline validation accepts it, but an
  // empty object filter does not express "this timing point": the merged
  // scanner would match every event at beginning-start and every otherwise
  // compatible event. This asserts the boundary without faking semantics.
  assert.deepEqual(registration.spec.filter, {});
  f.engine.pipeline.registerTrigger(registration);
  assert.equal(f.engine.pipeline.triggers.size, 1);
  f.engine.pipeline.unregisterTrigger(registration.id);
  assert.equal(f.engine.pipeline.triggers.size, 0);
});

test.todo(
  "unl-212-219 Frozen Fortress: 'deal 1 to each unit here' needs an untargeted set-damage form " +
    "over a same-location ('here') set anchor (CR 355.10.d/355.10.d.1, 053.3) — effect.damage " +
    "only reads Finalize-locked TargetSpecs today"
);

