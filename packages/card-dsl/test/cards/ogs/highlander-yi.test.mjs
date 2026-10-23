import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/highlander-yi.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import replacementEvent from "../../../../engine-core/dist/effects/instructions/replacement.event.js";
import { planReplacementBody } from "../../../../engine-core/dist/replacement/planner.js";
import { BlockedReplacementError } from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createTestWorld } from "../../../../engine-core/dist/effects/testing/test-kernel.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID = "card.hash-65c099c33a6f39283027cbf4532037cbd7fe982a1e896afd5bf5d35e0fc16512";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit. The next time it dies this turn, recall it exhausted instead. (Send it to base. This isn't a move.)";

const [speed, play] = program.abilities;
const [replacement] = play.body;
const [recall, exhaustInstruction] = replacement.args.instead.value;
const constant = (value) => ({ kind: "constant", value });

function addUnit(kernel, id, options = {}) {
  return kernel.addObject({
    ref: { id, zoneEntryId: 1 },
    cardId: `card:${id}`,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: options.owner ?? "A",
    controller: options.controller ?? "A",
    zone: "board",
    location: options.location ?? { type: "battlefield", id: "bf-1" },
    might: 2,
    energy: 2,
    power: ["Calm"],
    exhausted: options.exhausted ?? false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
}

/**
 * A reference-kernel world with the merged EventPipeline, mirroring the way
 * engine-core/test/effects/instructions/replacement.helpers.mjs wires the
 * RIFT-595 harness: the pipeline is real, the replacement dependencies are
 * injected because no production adapter supplies them yet.
 */
function mergedWorld({ withDependencies = true } = {}) {
  const kernel = createTestWorld();
  addUnit(kernel, "chosen");
  addUnit(kernel, "bystander");
  addUnit(kernel, "enemy", { owner: "B", controller: "B" });
  kernel.addObject({
    ref: { id: "source", zoneEntryId: 1 },
    cardId: "card:source",
    name: "Source",
    types: ["spell"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "chain",
    location: null,
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  const pipeline = new EventPipeline({
    checkpoint: () => kernel.snapshot(),
    restore: checkpoint => kernel.restore(checkpoint),
    execute: action => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => kernel,
    objects: () => kernel.objects,
    choose: request => request.type === "mode" ? request.options[0] : true
  }, ["A", "B"], "A");
  if (withDependencies) {
    Object.defineProperty(kernel, "replacement", {
      value: {
        host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
        pipeline
      },
      configurable: true
    });
  }
  const source = kernel.getObject("source");
  const context = bindResolveContext(kernel, {
    source,
    controller: "A",
    // The reference kernel compares "self" literally, so bind the acting
    // player for the card's controller: "self" filter (the same convention
    // other goldens in this suite use for production-bound filters).
    query: filter => kernel.query({ ...filter, ...(filter.controller === "self" ? { controller: "A" } : {}) })
  });
  kernel.setTargets("highlander-yi.chosen-unit", [kernel.ref("chosen")]);
  return { kernel, pipeline, context };
}

test("ogs-020-024 Highlander, Yi: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing pieces and the dependent tasks.
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /355\.10\.c/);
  assert.match(program.judgeReason, /Finalize target adapter/);
  assert.match(program.judgeReason, /replacement\.object/);
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /457-460/);
  // RIFT-595 registered the instruction, so the old "unregistered opcode"
  // claim must not persist.
  assert.doesNotMatch(program.judgeReason, /Unregistered instruction opcode/);
  assert.doesNotMatch(program.judgeReason, /trigger\.delayed/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-020-024 Highlander, Yi: [Reaction] keyword plus the printed 4 energy cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 }
  });
});

test("ogs-020-024 Highlander, Yi: the chosen friendly unit is a target, not a replacement clause", () => {
  // 355.10.c's own example: "Choose a friendly unit. The next time it would die
  // this turn, ... instead" targets the friendly unit because the choice is not
  // part of the replacement effect.
  assert.equal(play.body.length, 1);
  assert.equal(replacement.id, "highlander-yi.register-death-replacement");
  assert.equal(replacement.op, "replacement.event");
  assert.equal(replacement.targets.length, 1);
  const [spec] = replacement.targets;
  assert.equal(spec.id, "highlander-yi.chosen-unit");
  assert.deepEqual(spec.filter, { type: "unit", controller: "self" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("ogs-020-024 Highlander, Yi: the replacement is a one-shot death replacement for this turn", () => {
  assert.deepEqual(replacement.args.event, { kind: "constant", value: { event: "object-killed" } });
  // The printed "the next time ... this turn" window is represented by the
  // replacement.event wrapper's one-shot window (391.3).
  assert.deepEqual(replacement.args.window, { kind: "constant", value: "next-time-this-turn" });
  // The death pattern is anchored to the previously chosen unit (355.10.c).
  assert.deepEqual(replacement.args.object, { kind: "constant", value: "highlander-yi.chosen-unit" });
});

test("ogs-020-024 Highlander, Yi: the instead-body recalls the unit and applies the printed exhausted", () => {
  assert.equal(replacement.args.instead.kind, "constant");
  assert.equal(replacement.args.instead.value.length, 2);

  // 457: a Recall relocates the permanent to its Base without being a Move.
  assert.equal(recall.id, "highlander-yi.recall");
  assert.equal(recall.op, "effect.move");
  assert.deepEqual(recall.args.objects, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });

  // 460.1: a Recall does not change the permanent's status, so the printed
  // "exhausted" is an explicit exception applied by the replacement body.
  assert.equal(exhaustInstruction.id, "highlander-yi.exhaust-recalled");
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.deepEqual(exhaustInstruction.args.target, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });
  // "it" is not a new target choice, and the exhaustion follows the recall.
  assert.equal(exhaustInstruction.linkedTo, "highlander-yi.recall");
});

test("ogs-020-024 Highlander, Yi golden: the merged registration executes the one-shot death window", () => {
  // RIFT-595 registered replacement.event; this is the merged path taken
  // verbatim from the card's window/event args with the body's exhausted half
  // (the only half the planner can express today).
  const { pipeline, context, kernel } = mergedWorld();
  const result = replacementEvent.execute(context, {
    event: replacement.args.event,
    window: replacement.args.window,
    instead: constant([
      { id: "highlander-yi.exhaust-recalled", op: "effect.exhaust", args: exhaustInstruction.args }
    ])
  });
  assert.equal(result.status, "executed");
  assert.equal(result.linkedValues.duration, "next-time-this-turn");
  assert.equal(result.linkedValues.window, "next-time-this-turn");
  assert.equal(result.linkedValues.replacementId, "replacement:source:1");

  // The first death this turn is replaced by the body and never happens. The
  // replacement registration survives on the Chain-zone source (370.3/370.4).
  const first = pipeline.commit({ type: "kill", object: kernel.ref("chosen") });
  assert.equal(first.status, "replaced");
  assert.equal(kernel.getObject("chosen").zone, "board");
  assert.equal(kernel.getObject("chosen").exhausted, true);

  // 391.3: "the next time" is one-shot, so the second death this turn happens.
  const second = pipeline.commit({ type: "kill", object: kernel.ref("bystander") });
  assert.equal(second.status, "done");
  assert.equal(kernel.getObject("bystander").zone, "trash");

  // The window is this-turn only: the next turn's death also happens.
  pipeline.clock.turn += 1;
  const third = pipeline.commit({ type: "kill", object: kernel.ref("enemy") });
  assert.equal(third.status, "done");
  assert.equal(kernel.getObject("enemy").zone, "trash");
});

test("ogs-020-024 Highlander, Yi golden: the card's own body is blocked by the missing chosen-unit anchor", () => {
  // The declaration still names args.object, and RIFT-595's instruction rejects
  // that argument outright: no Finalize-locked TargetSpec -> pattern object
  // binding exists, and the argument is deliberately not approximated.
  const { context } = mergedWorld();
  assert.throws(
    () => resolveChainBody(play.body, context),
    (error) => error instanceof BlockedReplacementError &&
      /replacement\.event object binding needs a Finalize target adapter/.test(error.message)
  );
});

test("ogs-020-024 Highlander, Yi golden: dropping the anchor would match any object's death", () => {
  // Why the anchor cannot be dropped: without args.object the merged pattern is
  // "any object-killed this turn", so an enemy unit's death is replaced too.
  const { pipeline, context, kernel } = mergedWorld();
  const result = replacementEvent.execute(context, {
    event: replacement.args.event,
    window: replacement.args.window,
    instead: constant([
      { id: "highlander-yi.exhaust-recalled", op: "effect.exhaust", args: exhaustInstruction.args }
    ])
  });
  assert.equal(result.status, "executed");
  const enemyDeath = pipeline.commit({ type: "kill", object: kernel.ref("enemy") });
  assert.equal(enemyDeath.status, "replaced");
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.equal(kernel.getObject("enemy").exhausted, true);
});

test("ogs-020-024 Highlander, Yi golden: a controller-scoped filter cannot name the chosen unit", () => {
  // The pattern's filter vocabulary can only describe characteristics, not the
  // previously chosen instance (355.10.c), so a "friendly unit" filter would
  // consume the one-shot window on whichever friendly unit dies first.
  const { pipeline, context, kernel } = mergedWorld();
  const result = replacementEvent.execute(context, {
    event: constant({ event: "object-killed", filter: { type: "unit", controller: "self" } }),
    window: replacement.args.window,
    instead: constant([
      { id: "highlander-yi.exhaust-recalled", op: "effect.exhaust", args: exhaustInstruction.args }
    ])
  });
  assert.equal(result.status, "executed");

  // The unchosen friendly unit dies first and eats the window.
  const unchosenDeath = pipeline.commit({ type: "kill", object: kernel.ref("bystander") });
  assert.equal(unchosenDeath.status, "replaced");
  assert.equal(kernel.getObject("bystander").zone, "board");
  assert.equal(kernel.getObject("bystander").exhausted, true);

  // The chosen unit then dies for real, which the printed card must prevent.
  const chosenDeath = pipeline.commit({ type: "kill", object: kernel.ref("chosen") });
  assert.equal(chosenDeath.status, "done");
  assert.equal(kernel.getObject("chosen").zone, "trash");
});

test("ogs-020-024 Highlander, Yi golden: the chain interpreter drops the replacement dependency extension", () => {
  // Even with the kernel exposing the merged dependencies, the chain
  // interpreter rebuilds the instruction ResolveContext without forwarding
  // them, so the registration fails closed before touching the pipeline.
  const { context, pipeline, kernel } = mergedWorld({ withDependencies: true });
  const { object: _object, ...args } = replacement.args;
  assert.throws(
    () => resolveChainBody([{ ...replacement, args }], context),
    (error) => error instanceof BlockedReplacementError &&
      /requires ResolveContext\.replacement dependencies/.test(error.message)
  );
  // The failed registration installed nothing.
  assert.equal(pipeline.commit({ type: "kill", object: kernel.ref("chosen") }).status, "done");
  assert.equal(kernel.getObject("chosen").zone, "trash");
});

test("ogs-020-024 Highlander, Yi golden: Recall remains blocked rather than approximated as a Move", () => {
  const kernel = world().unit("friendly", { owner: "A", location: { type: "battlefield", id: "bf-1" } }).build();
  const run = runInstruction(
    move,
    {
      // The card records the body selector as { linked: "replacement.object" }
      // (355.10.c), which is the replacement-body spelling the merged planner
      // resolves; the frozen effect.move primitive itself only accepts
      // source/target/pick/choose, so this direct primitive check names the
      // same unit through the declaration's TargetSpec (the anchored death
      // pattern's object is that unit).
      objects: { kind: "constant", value: { target: "highlander-yi.chosen-unit" } },
      to: recall.args.to,
      mode: recall.args.mode
    },
    {
      world: kernel,
      targets: { "highlander-yi.chosen-unit": [kernel.ref("friendly")] }
    }
  );
  // 457-460: Recall is a distinct action and effect.move fails closed rather
  // than silently submitting an ordinary move-location action.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.match(run.linked.moved.blockedReason, /Recall/);
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.getObject("friendly").location, { type: "battlefield", id: "bf-1" });
  assert.equal(kernel.getObject("friendly").exhausted, false);
  assert.equal(instructionDefinitionsById.has("effect.recall"), false);
});

test("ogs-020-024 Highlander, Yi golden: the merged planner blocks the Recall half", () => {
  // The binder's planner is merged and is the authoritative cell for this
  // replacement body; it refuses mode "recall" by rule 457-460 instead of
  // silently substituting a Move (which would fire Move triggers, 458.1).
  assert.throws(
    () => planReplacementBody(
      [recall],
      { hostRef: { id: "friendly", zoneEntryId: 1 }, replacedObject: { id: "friendly", zoneEntryId: 1 }, usedWindow: false },
      {
        host: { object: () => null, objects: () => [], context: () => ({}) },
        controller: "A",
        evaluate: (expr) => expr && typeof expr === "object" ? expr.value : null
      }
    ),
    (error) => error.name === "BlockedReplacementError" && /Recall/.test(error.message)
  );
});

test("ogs-020-024 Highlander, Yi golden: the merged exhaust half plans against the replaced object", () => {
  // The other half of the printed outcome is expressible: the planner maps
  // effect.exhaust over { linked: "replacement.object" } to a closed exhaust
  // action on the intercepted unit (355.10.c), and the primitive executes it.
  const actions = planReplacementBody(
    [exhaustInstruction],
    { hostRef: { id: "source", zoneEntryId: 1 }, replacedObject: { id: "friendly", zoneEntryId: 1 }, usedWindow: false },
    {
      host: { object: () => null, objects: () => [], context: () => ({}) },
      controller: "A",
      evaluate: (expr) => expr && typeof expr === "object" ? expr.value : null
    }
  );
  assert.deepEqual(actions, [{ type: "exhaust", object: { id: "friendly", zoneEntryId: 1 } }]);

  const kernel = world().unit("friendly", { owner: "A", location: { type: "battlefield", id: "bf-1" } }).build();
  const run = runInstruction(
    exhaust,
    { target: "highlander-yi.chosen-unit" },
    { world: kernel, targets: { "highlander-yi.chosen-unit": [kernel.ref("friendly")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly").exhausted, true);
});

test.todo(
  "Highlander, Yi: card-level replacement registration anchored to the chosen unit (355.10.c) — needs a " +
    "Finalize-locked TargetSpec binding that replacement.event will accept as its pattern object " +
    "(the merged instruction fails closed with 'replacement.event object binding needs a Finalize target adapter')"
);

test.todo(
  "Highlander, Yi: a real Recall (457-460) plus the printed exhausted exception (460.1) needs a recall GameAction " +
    "distinct from move-location; effect.move deliberately blocks the approximation"
);

test.todo(
  "Highlander, Yi: the production chain must forward the replacement dependencies into the instruction " +
    "ResolveContext (merged bindReplacement seam has no production caller); until then the card's play body " +
    "fails closed with 'replacement instruction requires ResolveContext.replacement dependencies (host + pipeline)'"
);

test.todo(
  "Highlander, Yi: the local printing still reads 'dies ... recall it exhausted' while the refresh marks the " +
    "S-ORIGINS errata wording as resolved (docs/plans/survey/data-issues-recheck.md); reconciliation is a " +
    "card-data task, and this program keeps the local sourceText verbatim"
);
