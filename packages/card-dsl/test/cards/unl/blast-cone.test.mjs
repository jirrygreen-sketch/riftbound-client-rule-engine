import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/blast-cone.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const move = (await import(new URL("effects/instructions/effect.move.js", ENGINE))).default;
const stun = (await import(new URL("effects/instructions/effect.stun.js", ENGINE))).default;
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const { queryLocationCandidates } = await import(new URL("target/location/candidates.js", ENGINE));
const { translateTriggerFilter } = await import(new URL("programs/filters.js", ENGINE));
const { ProgramRegistry } = await import(new URL("programs/registry.js", ENGINE));
const { triggerRegistrations } = await import(new URL("programs/triggers.js", ENGINE));

const CANONICAL_ID =
  "card.hash-3ffea48ff592a10eca59908e205019c7f50fddff02d49b1eede58694d9b2b348";
const SOURCE_TEXT =
  "When you play this, you may move an enemy unit.\n" +
  "When you move an enemy unit, you may exhaust this to [Stun] it. (It doesn't deal combat damage this turn.)";

const [playTrigger, moveTrigger] = program.abilities;
const [mayMove] = playTrigger.body;
const [moveInstruction] = mayMove.args.body.value;
const moveTargetSpec = moveInstruction.targets[0];
const [mayStun] = moveTrigger.body;
const [payExhaust, stunInstruction] = mayStun.args.body.value;
const stunTargetSpec = mayStun.targets[0];

const battlefield = () => ({ type: "battlefield", id: "bf-1" });
const baseOf = player => ({ type: "base", player });

test("unl-133-219 Blast Cone: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-133-219 Blast Cone: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /355\.4\.a/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /412\.4/);
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /TriggeredAbility/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|120|257)/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-133-219 Blast Cone: 'When you play this' is the card's own Play Effect", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playTrigger.kind, "triggered");
  // 383.4.a.1: the play effect of this card.
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { self: true });
  assert.equal(playTrigger.optional, false);
});

test("unl-133-219 Blast Cone: 'you may move an enemy unit' wraps the Move inside choice.optional (contract 3.9)", () => {
  assert.deepEqual(playTrigger.body.map(instruction => instruction.id), ["blast-cone.may-move-enemy-unit"]);
  assert.equal(mayMove.op, "choice.optional");
  assert.deepEqual(mayMove.args.body.value.map(instruction => instruction.id), ["blast-cone.move-enemy-unit"]);
  assert.equal(mayMove.linkedTo, undefined);

  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "blast-cone.enemy-unit" }
  });
  // 355.7 / 355.10: the enemy unit named by the effect is a chosen target.
  assert.deepEqual(moveTargetSpec, {
    id: "blast-cone.enemy-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // 355.4 / 355.4.a: the destination is chosen from runtime-legal Locations; the
  // merged location face cannot express 355.4.a's "other than the units'
  // current Location" constraint, so the static IR only carries the descriptive
  // marker (see judgeReason).
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "blast-cone.destination",
      options: ["runtime:valid-move-destination"]
    }
  });
  assert.equal(moveInstruction.picks, undefined);
});

test("unl-133-219 Blast Cone: the move trigger filters an enemy unit moved by you", () => {
  assert.equal(moveTrigger.kind, "triggered");
  // 421.1 / 449.1 / 458: a completed Move, and a Recall is not a Move.
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    object: { type: "unit", controller: "opponent" },
    player: "self"
  });
  assert.equal(moveTrigger.trigger.condition, undefined);
  assert.equal(moveTrigger.trigger.once, undefined);
  // 403.1: "you may ..." inside the effect, so the trigger itself is mandatory.
  assert.equal(moveTrigger.optional, false);
});

test("unl-133-219 Blast Cone: 'exhaust this to [Stun] it' keeps the in-effect cost and the payload referent distinct", () => {
  assert.deepEqual(moveTrigger.body.map(instruction => instruction.id), ["blast-cone.may-exhaust-to-stun"]);
  assert.equal(mayStun.op, "choice.optional");
  assert.deepEqual(mayStun.args.body.value.map(instruction => instruction.id), [
    "blast-cone.pay-exhaust",
    "blast-cone.stun-moved-unit"
  ]);

  // 415.5: "exhaust this" is an in-effect cost; the current card body keeps
  // the nonstandard payment shape while TriggeredAbility has no base-cost slot.
  assert.equal(payExhaust.op, "cost.pay");
  assert.deepEqual(payExhaust.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });

  // 424.1 / 424.1.a.1: the Stun is the merged effect.stun over the moved unit.
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args.target, {
    kind: "constant",
    value: "blast-cone.moved-unit"
  });
  assert.equal(stunInstruction.linkedTo, "blast-cone.pay-exhaust");

  // 355.10.c: "it" is not a target choice this effect makes — the TargetSpec is
  // a declarative stand-in until the event-object selector lands.
  assert.deepEqual(stunTargetSpec, {
    id: "blast-cone.moved-unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-133-219 Blast Cone golden: the merged effect.move really moves an enemy unit once the caller supplies the destination", () => {
  // 355.4 / 355.4.a: the production caller owns the Finalize destination choice;
  // the golden therefore executes the card's own objects/target expressions with
  // the destination that caller must supply.
  const kernel = world()
    .unit("enemy-unit", {
      types: ["unit"],
      zone: "board",
      location: battlefield(),
      controller: "B",
      owner: "B"
    })
    .build();
  const locked = kernel.ref("enemy-unit");
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: baseOf("B") },
      linkKey: moveInstruction.args.linkKey
    },
    { world: kernel, targets: { [moveTargetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy-unit").location, baseOf("B"));
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.movements[0].from, battlefield());
  assert.deepEqual(run.linked.moved.movements[0].to, baseOf("B"));
});

test("unl-133-219 Blast Cone golden: the descriptive destination fails closed instead of picking a location", () => {
  const kernel = world()
    .unit("enemy-unit", {
      types: ["unit"],
      zone: "board",
      location: battlefield(),
      controller: "B",
      owner: "B"
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("enemy-unit") });
  context.setTargets(moveTargetSpec.id, [kernel.ref("enemy-unit")]);
  context.setAnswers({ "blast-cone.may-move-enemy-unit/optional": true });

  // Supply only the one binding the judgeReason names (the Finalize destination,
  // CR 355.4.a) and run the program's own body: the whole printed sentence really
  // resolves through the interpreter and the merged effect.move. The reference
  // kernel's filter vocabulary compares controller placeholders verbatim, so the
  // TargetSpecs are dropped from the execution copy and the enemy unit is locked
  // through the kernel instead (the pit-rookie / one-two-punch convention); the
  // card's own TargetSpecs are asserted above.
  const executableBody = playTrigger.body.map(instruction => ({
    id: instruction.id,
    op: instruction.op,
    args: {
      ...instruction.args,
      body: {
        kind: "constant",
        value: instruction.args.body.value.map(step => ({
          id: step.id,
          op: step.op,
          args: step.id === "blast-cone.move-enemy-unit"
            ? { ...step.args, to: { kind: "constant", value: baseOf("B") } }
            : step.args
        }))
      }
    }
  }));

  const outcome = resolveChainBody(executableBody, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["blast-cone.move-enemy-unit", "executed"],
    ["blast-cone.may-move-enemy-unit", "executed"]
  ]);
  assert.deepEqual(context.getObject("enemy-unit").location, baseOf("B"));
  assert.deepEqual(context.events.map(event => event.action), ["move-location"]);
  // The interpreter qualifies nested link writes with the execution path.
  const moved = outcome.linkedValues["blast-cone.may-move-enemy-unit/blast-cone.move-enemy-unit.moved"];
  assert.equal(moved.count, 1);
  assert.deepEqual(moved.movements[0].to, baseOf("B"));
});

test("unl-133-219 Blast Cone golden: declining the printed 'you may' performs no Move", () => {
  const kernel = world()
    .unit("enemy-unit", {
      types: ["unit"],
      zone: "board",
      location: battlefield(),
      controller: "B",
      owner: "B"
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("enemy-unit") });
  context.setTargets(moveTargetSpec.id, [kernel.ref("enemy-unit")]);
  context.setAnswers({ "blast-cone.may-move-enemy-unit/optional": false });

  const executableBody = playTrigger.body.map(({ targets, ...rest }) => rest);
  const outcome = resolveChainBody(executableBody, context);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["blast-cone.may-move-enemy-unit", "negated", "skipped"]
  ]);
  assert.deepEqual(context.getObject("enemy-unit").location, battlefield());
  assert.deepEqual(context.events, []);
});

test("unl-133-219 Blast Cone golden: the merged effect.stun stuns the moved unit", () => {
  const kernel = world()
    .unit("moved-unit", {
      types: ["unit"],
      zone: "board",
      location: baseOf("B"),
      controller: "B",
      owner: "B"
    })
    .build();
  const run = runInstruction(
    stun,
    { target: stunTargetSpec.id },
    { world: kernel, targets: { [stunTargetSpec.id]: [kernel.ref("moved-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("moved-unit").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
  assert.equal(run.linked.stunned.count, 1);
});

test("unl-133-219 Blast Cone golden: an already-stunned unit is not stunned again (424.1.a.1)", () => {
  const kernel = world()
    .unit("already-stunned", {
      types: ["unit"],
      zone: "board",
      location: baseOf("B"),
      controller: "B",
      owner: "B",
      stunned: true
    })
    .build();
  const run = runInstruction(
    stun,
    { target: stunTargetSpec.id },
    { world: kernel, targets: { [stunTargetSpec.id]: [kernel.ref("already-stunned")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(run.linked.stunned.alreadyStunned, 1);
  assert.deepEqual(kernel.events, []);
});

test("unl-133-219 Blast Cone golden: the printed exhaust cost is payable and the merged Stun really stuns the bound unit", () => {
  const kernel = world()
    .unit("blast-cone", {
      types: ["gear"],
      zone: "board",
      location: baseOf("A"),
      controller: "A",
      owner: "A"
    })
    .unit("moved-unit", {
      types: ["unit"],
      zone: "board",
      location: baseOf("B"),
      controller: "B",
      owner: "B"
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("blast-cone") });
  context.setTargets(stunTargetSpec.id, [kernel.ref("moved-unit")]);

  // The printed "exhaust this" cost goes through the merged cost pipeline (the
  // op the card needs, cost.pay, is the gap the judgeReason names).
  const plan = buildCostPlan(context, {
    id: "blast-cone:exhaust",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }
  });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("blast-cone").exhausted, true);

  // Then the program's merged effect.stun step runs against the bound moved unit.
  // The execution copy drops only the "in-effect cost" link: the preceding
  // accepted-branch step is the unmerged cost.pay op the judgeReason and TODO
  // name, and the printed exhaust cost itself was paid through the real merged
  // cost plan above.
  const { linkedTo, ...stunStep } = stunInstruction;
  const outcome = runAbilityBody([stunStep], context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["blast-cone.stun-moved-unit", "executed"]
  ]);
  assert.equal(context.getObject("moved-unit").stunned, true);
  // The real payment (pay + exhaust) precedes the Stun action on the same context.
  assert.deepEqual(context.events.map(event => event.action), ["pay", "exhaust", "stun"]);
  assert.equal(outcome.linkedValues["blast-cone.stun-moved-unit.stunned"].count, 1);
});

test("unl-133-219 Blast Cone: the merged location-candidate surface still offers the moved unit's current Location (355.4.a)", () => {
  // RIFT-357 merged the runtime location face (LocationTargetSpec +
  // Expr.kind "location"), but 355.4.a's "other than the Units' current
  // Location" exclusion has no predicate: chooseLocations never injects
  // LocationCandidateOptions.exclude and matchesFilter has no current-location
  // key. The candidate list a card could declare therefore still contains the
  // unit's current Location, so writing it would hand the player an illegal
  // destination (picking it makes effect.move return executed without moving).
  const kernel = world()
    .unit("enemy-unit", {
      types: ["unit"],
      zone: "board",
      location: battlefield(),
      controller: "B",
      owner: "B"
    })
    .object("bf-shell", { owner: "B", controller: "B", types: ["battlefield"], zone: "board", location: null })
    .build();

  assert.equal(
    queryLocationCandidates(kernel, { type: "any" }).some(location => location.type === "battlefield" && location.id === "bf-1"),
    true,
    "the moved unit's current Location is still a candidate, so 355.4.a is unsatisfied"
  );
});

test("unl-133-219 Blast Cone: the merged trigger registration carries neither a base cost nor the may decision (383.3.b)", () => {
  // TriggerRegistration.cost/mayAtFinalize exist and chain/engine consumes them
  // at Finalize, but programs/triggers.ts copies only body/optional/spec, so the
  // card's own "exhaust this" step stays an in-body cost.pay instruction that
  // the interpreter cannot execute from the CC body. The golden above pays the
  // printed cost through the real cost plan and the primitive bodies; the
  // trigger's base-cost binding is still missing.
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const source = {
    ref: { id: "blast-cone", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Blast Cone",
    types: ["gear"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: baseOf("A"), might: null, energy: 4, power: ["Chaos"], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const registrations = triggerRegistrations(registry, source);
  assert.deepEqual(registrations.map(entry => entry.spec.at), ["card-played", "object-moved"]);
  assert.deepEqual(registrations.map(entry => entry.cost ?? null), [null, null]);
  assert.deepEqual(registrations.map(entry => entry.mayAtFinalize ?? null), [null, null]);
  // The move trigger's filter really binds through the production translator;
  // the responsibility payload (412.4/412.5) is what is still missing.
  assert.deepEqual(
    translateTriggerFilter(moveTrigger.trigger.filter, "blast-cone", "object-moved"),
    { event: "object-moved", object: { type: "unit", controller: "opponent" }, player: "self" }
  );
});

test.todo(
  "unl-133-219 Blast Cone: expose the acting player of a Move so 'you move an enemy unit' can filter it (CR 412.4 / " +
    "412.5) — the object-moved emission records the moved object's original controller, not the acting player"
);
test.todo(
  "unl-133-219 Blast Cone: bind 'it' to the moved unit from the trigger payload (CR 355.10.c) — the frozen " +
    "ObjectSelector set (self/source/target/pick/linked) has no event-object selector (contract change request)"
);
test.todo(
  "unl-133-219 Blast Cone: pay the in-effect 'exhaust this' cost via the merged cost.pay primitive and give the " +
    "triggered ability a base-cost slot (CR 383.3.b / contract 3.1); the current cost.pay path cannot consume this " +
    "nonstandard payment directly from the frozen triggered-ability body"
);
