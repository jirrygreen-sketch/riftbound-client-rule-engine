import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/tactical-retreat.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindReplacement, planReplacementBody } from "../../../../engine-core/dist/replacement/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6e703faa3d5dcede2068e4872e8021e824403fe96e25a18904960e6595699c35";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead. " +
  "(Send it to base. This isn't a move.)";

const [speed, play] = program.abilities;
const [replacement] = play.body;
const [healInstruction, exhaustInstruction, recallInstruction] = replacement.args.instead.value;

test("unl-175-219 Tactical Retreat: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /457/);
  assert.match(program.judgeReason, /next time/);
  assert.match(program.judgeReason, /replacement\.object/);
});

test("unl-175-219 Tactical Retreat: [Reaction] plus the printed 2 energy cost", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
});

test("unl-175-219 Tactical Retreat: the chosen friendly unit is a target, not part of the replacement", () => {
  // 355.10.c's own example: "Choose a friendly unit. The next time it would
  // die this turn, return it to your hand instead" targets the friendly unit
  // because the choice is not part of the replacement effect.
  assert.equal(play.body.length, 1);
  assert.equal(replacement.id, "tactical-retreat.register-death-replacement");
  assert.equal(replacement.op, "replacement.event");
  // The merged replacement/ layer reads the pattern as an EventPattern object
  // inside a constant expression; the binding is exercised below.
  assert.deepEqual(replacement.args.event, {
    kind: "constant",
    value: { event: "object-killed" }
  });
  // The printed "the next time ... this turn" one-occurrence window is the
  // merged window spelling bound to the pipeline's current turn.
  assert.deepEqual(replacement.args.window, { kind: "constant", value: "next-time-this-turn" });
  assert.deepEqual(replacement.targets, [
    {
      id: "tactical-retreat.chosen-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-175-219 Tactical Retreat: the instead-body heals, exhausts, then recalls the same unit", () => {
  // "it" in all three clauses refers to the replaced event's object (355.10.c),
  // so every instruction names the same merged linked selector.
  const linkedSelector = { kind: "constant", value: { linked: "replacement.object" } };
  assert.equal(healInstruction.op, "effect.heal");
  assert.deepEqual(healInstruction.args.objects, linkedSelector);
  assert.equal(healInstruction.linkedTo, undefined);

  // 415.1: the exhaustion is part of the replaced outcome.
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.equal(exhaustInstruction.linkedTo, "tactical-retreat.heal");
  assert.deepEqual(exhaustInstruction.args.target, linkedSelector);

  // 457 / 458: a Recall is not a Move; the merged primitive refuses to
  // substitute move-location and reports blockedReason instead.
  assert.equal(recallInstruction.op, "effect.move");
  assert.equal(recallInstruction.linkedTo, "tactical-retreat.exhaust");
  assert.deepEqual(recallInstruction.args.objects, linkedSelector);
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
});

test("unl-175-219 Tactical Retreat golden: the heal and exhaust halves clear the damage and exhaust the unit", () => {
  // 419.1 / 415.1: the printed "heal it, exhaust it" runs through the merged
  // interpreter over the chosen unit. The unqualified "heal" clears all marked
  // damage (the primitive's documented default) and the linked instruction
  // exhausts the same unit. The card's replacement-body spelling of "it" is
  // exercised against the planner below.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3, damage: 2, location: { type: "base", player: "A" } })
    .build();
  const ref = kernel.ref("ally");
  kernel.setTargets("tactical-retreat.chosen-unit", [ref]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ally") });
  const targetedHeal = {
    ...healInstruction,
    args: {
      objects: { kind: "constant", value: { kind: "target", id: "tactical-retreat.chosen-unit" } }
    }
  };
  const targetedExhaust = {
    ...exhaustInstruction,
    args: { target: { kind: "constant", value: "tactical-retreat.chosen-unit" } }
  };
  const outcome = resolveChainBody([targetedHeal, targetedExhaust], context);
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["tactical-retreat.heal", "executed"],
    ["tactical-retreat.exhaust", "executed"]
  ]);
  assert.equal(context.getObject("ally").damage, 0);
  assert.equal(context.getObject("ally").exhausted, true);
  const healResult = outcome.results.find((entry) => entry.id === "tactical-retreat.heal").result;
  assert.deepEqual(healResult.linkedValues.healed, {
    amount: 2,
    count: 1,
    objects: [ref]
  });
  const actions = context.events.map((event) => event.action);
  assert.equal(actions.includes("heal"), true);
  assert.equal(actions.includes("exhaust"), true);
});

test("unl-175-219 Tactical Retreat golden: the replacement planner consumes the linked 'it' selector", () => {
  // The merged replacement planner resolves { linked: "replacement.object" } to
  // the replaced event's object and plans closed heal/exhaust actions. The
  // planned heal amount shows the recorded gap: without an authored amount the
  // planner uses 1, while 419.1's "heal it" clears all marked damage.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3, damage: 2, location: { type: "base", player: "A" } })
    .build();
  const ref = kernel.ref("ally");
  const planned = planReplacementBody(
    [healInstruction, exhaustInstruction],
    { hostRef: ref, replacedObject: ref, usedWindow: true },
    {
      host: { object: (candidate) => kernel.object(candidate), objects: () => kernel.objects, context: () => kernel },
      controller: "A",
      evaluate: (expr) => kernel.evaluate(expr)
    }
  );
  assert.deepEqual(planned, [
    { type: "heal", object: ref, amount: 1 },
    { type: "exhaust", object: ref }
  ]);
  // 419.1 expects the whole 2 marked damage to be cleared, so the plan-time
  // default of 1 is not the printed semantics.
  for (const action of planned) assert.equal(kernel.perform(action).status, "done");
  assert.equal(kernel.getObject("ally").damage, 1);
  assert.equal(kernel.getObject("ally").exhausted, true);
});

test("unl-175-219 Tactical Retreat golden: the card's ability binds as a real one-shot death replacement (CR 369.1 / 370.1.a.1)", () => {
  // The merged replacement layer consumes the card's own declaration: the
  // pattern matches a kill of the chosen unit, the once-per-bound-turn window
  // allows exactly one interception, and the retained exhaust half plans a real
  // action bound to the replaced event's object. The entry stays judge-required
  // for the card-program registration (RIFT-257) and the two recorded gaps.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3, damage: 2, location: { type: "base", player: "A" } })
    .build();
  const ref = kernel.ref("ally");
  const registrations = [];
  // The merged binder spells the instead-body as a raw instruction array (see
  // the judgeReason: the frozen Instruction.args expression wrapper and this
  // array field disagree).
  const bound = bindReplacement(
    {
      replaces: {},
      with: [{
        id: replacement.id,
        op: "replacement.event",
        args: {
          event: replacement.args.event,
          window: replacement.args.window,
          instead: [exhaustInstruction]
        }
      }]
    },
    ref,
    {
      host: { object: (candidate) => kernel.object(candidate), objects: () => kernel.objects, context: () => kernel },
      pipeline: {
        clock: { turn: 1 },
        registerReplacement: (registration) => registrations.push(registration)
      }
    }
  );
  assert.equal(registrations.length, 1);

  const kill = { type: "kill", object: ref };
  assert.equal(bound.registration.matches(kill, kill), true);
  const applied = bound.registration.apply(kill, kill);
  assert.equal(applied.status, "replace");
  assert.deepEqual(applied.actions, [{ type: "exhaust", object: ref }]);
  // 370.1.a.1: the replaced event does not happen.
  assert.equal(applied.actions.some((action) => action.type === "kill"), false);
  for (const action of applied.actions) assert.equal(kernel.perform(action).status, "done");
  assert.equal(kernel.getObject("ally").zone, "board");
  assert.equal(kernel.getObject("ally").exhausted, true);

  // "the next time": the window is one-shot within the bound turn, so a second
  // kill in the same turn is no longer intercepted.
  const second = world().unit("other", { owner: "A", might: 3 }).build();
  const otherKill = { type: "kill", object: second.ref("other") };
  assert.equal(bound.registration.matches(otherKill, otherKill), false);
});

test("unl-175-219 Tactical Retreat golden: the merged recall mode refuses to approximate a Move (457-460.1)", () => {
  // 458: a Recall is not a Move and cannot be approximated by one. The planner
  // raises the documented block instead of submitting a move-location, so a
  // silently substituted Move can never relocate the unit.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const ref = kernel.ref("ally");
  assert.throws(
    () =>
      planReplacementBody(
        [recallInstruction],
        { hostRef: ref, replacedObject: ref, usedWindow: true },
        {
          host: { object: (candidate) => kernel.object(candidate), objects: () => kernel.objects, context: () => kernel },
          controller: "A",
          evaluate: (expr) => kernel.evaluate(expr)
        }
      ),
    (error) => error.name === "BlockedReplacementError" && /recall/.test(error.message)
  );
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-1" });
  assert.equal(kernel.events.some((event) => event.action === "move-location"), false);
});

test.todo(
  "unl-175-219 Tactical Retreat: register the card's death replacement so the chosen unit's death is intercepted, " +
    "with the printed one-occurrence 'the next time ... this turn' window and its end-of-turn expiry " +
    "(CR 368.1/369.1/370.1.a.1) from the card program — the merged bindReplacement consumes the ability above and " +
    "supports the next-time window; nothing registers a card's ReplacementAbility in production (RIFT-257)"
);

test.todo(
  "unl-175-219 Tactical Retreat: bind the replaced event's unit into the replacement body so 'it' stays the " +
    "intercepted unit instead of a new choice (CR 355.10.c) — the merged { linked: \"replacement.object\" } selector is " +
    "consumed by the planner above; the remaining piece is carrying the finalized TargetSpec choice into the " +
    "replacement binding (a ReplacementAbility has no TargetSpec slot)"
);

test.todo(
  "unl-175-219 Tactical Retreat: clear the marked damage through the replacement plan — the merged planner maps an " +
    "absent effect.heal amount to 1 instead of the primitive's 'clear all marked damage' semantics, so the heal half " +
    "cannot be planned by the replacement body yet (CR 419.1); the interpreter executes it correctly above"
);

test.todo(
  "unl-175-219 Tactical Retreat: declare the replacement instead-body in the merged binder's instruction-array " +
    "spelling — Instruction.args types every field as an Expr, so validateCardProgram accepts only a constant-wrapped " +
    "body while bindReplacement rejects it (\"replacement.event instead must be an instruction body\"); the two halves " +
    "of the frozen contract have to agree"
);

test.todo(
  "unl-175-219 Tactical Retreat: perform the Recall (CR 457-460: relocates to Base without being a Move, fires no " +
    "Move triggers, cannot be blocked by movement restrictions, keeps statuses) once a Recall action distinct from " +
    "move-location is merged; the planner's documented block is asserted above and a plain Move is not an acceptable substitute"
);

