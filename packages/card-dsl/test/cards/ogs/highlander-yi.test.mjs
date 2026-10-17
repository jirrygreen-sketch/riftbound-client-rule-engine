import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/highlander-yi.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { planReplacementBody } from "../../../../engine-core/dist/replacement/planner.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID = "card.hash-65c099c33a6f39283027cbf4532037cbd7fe982a1e896afd5bf5d35e0fc16512";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit. The next time it dies this turn, recall it exhausted instead. (Send it to base. This isn't a move.)";

const [speed, play] = program.abilities;
const [replacement] = play.body;
const [recall, exhaust] = replacement.args.instead.value;

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
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /457-460/);
  assert.match(program.judgeReason, /replacement\.object/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
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
  // replacement.event wrapper's one-shot window.
  assert.deepEqual(replacement.args.window, { kind: "constant", value: "next-time-this-turn" });
  // "it" names the intercepted object (355.10.c): the chosen unit, referred to
  // by the declared TargetSpec selector because no replaced-event selector exists.
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
    value: { target: "highlander-yi.chosen-unit" }
  });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });

  // 460.1: a Recall does not change the permanent's status, so the printed
  // "exhausted" is an explicit exception applied by the replacement body.
  assert.equal(exhaust.id, "highlander-yi.exhaust-recalled");
  assert.equal(exhaust.op, "effect.exhaust");
  assert.deepEqual(exhaust.args.target, {
    kind: "constant",
    value: "highlander-yi.chosen-unit"
  });
  // "it" is not a new target choice, and the exhaustion follows the recall.
  assert.equal(exhaust.linkedTo, "highlander-yi.recall");
});

test("ogs-020-024 Highlander, Yi golden: Recall remains blocked rather than approximated as a Move", () => {
  const kernel = world().unit("friendly", { owner: "A", location: { type: "battlefield", id: "bf-1" } }).build();
  const run = runInstruction(
    move,
    { objects: recall.args.objects, to: recall.args.to, mode: recall.args.mode },
    {
      world: kernel,
      // The replacement names the previously chosen unit through its declared
      // TargetSpec (355.10.c), so this direct primitive check uses the same
      // selector binding while preserving the unsupported Recall behavior.
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
});

test("ogs-020-024 Highlander, Yi golden: the card's own body fails on the unregistered replacement opcode", () => {
  // 复核 2026-10-17: replacement.event is implemented inside the binder, but it
  // is NOT an instruction opcode, so the card's own play body cannot run at all
  // once its declared target is satisfiable.
  const kernel = world().unit("friendly", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } }).build();
  kernel.setTargets("highlander-yi.chosen-unit", [kernel.ref("friendly")]);
  // The reference kernel compares "self" literally, so bind the acting player
  // for the card's controller: "self" filter (the same convention the other
  // goldens in this suite use for production-bound filters).
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("friendly"),
    controller: "A",
    query: (filter) => kernel.query({ ...filter, ...(filter.controller === "self" ? { controller: "A" } : {}) })
  });
  assert.equal(instructionDefinitionsById.has("replacement.event"), false);
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), false);
  assert.throws(
    () => resolveChainBody(play.body, context),
    /Unregistered instruction opcode: replacement\.event/
  );
});

test("ogs-020-024 Highlander, Yi golden: the merged planner still blocks the Recall half", () => {
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
  assert.equal(instructionDefinitionsById.has("effect.recall"), false);
});

test("ogs-020-024 Highlander, Yi golden: the exhausted half cannot be bound from the chosen unit either", () => {
  // Even replacing the already-blocked Recall with a legal destination, the
  // second instruction's object selector ({ target: ... }) is not resolvable in
  // the binder: it has no Finalize-locked TargetSpec binding for replacement
  // bodies (only the replaced event's object is exposed).
  assert.throws(
    () => planReplacementBody(
      [exhaust],
      { hostRef: { id: "friendly", zoneEntryId: 1 }, replacedObject: { id: "friendly", zoneEntryId: 1 }, usedWindow: false },
      {
        host: { object: () => null, objects: () => [], context: () => ({}) },
        controller: "A",
        evaluate: (expr) => expr && typeof expr === "object" ? expr.value : null
      }
    ),
    (error) => error.name === "BlockedReplacementError" &&
      /Unsupported object-valued replacement argument/.test(error.message)
  );
});

test.todo(
  "Highlander, Yi: card-level replacement registration (binding the chosen unit into the replaced death, honouring " +
    "the printed 'the next time' one-shot window) — needs a registration primitive that reachable CardProgram IR can " +
    "reference (trigger.delayed or an equivalent op) plus a Finalize-locked chosen-unit binding inside replacement bodies; " +
    "the merged binder exposes only the replaced event's object"
);

test.todo(
  "Highlander, Yi: a real Recall (457-460) plus the printed exhausted exception (460.1) needs a recall GameAction " +
    "distinct from move-location; effect.move deliberately blocks the approximation"
);

test.todo(
  "Highlander, Yi: the S-ORIGINS printing's '...would die this turn, heal it, exhaust it, and recall it instead' " +
    "wording (docs/plans/survey/data-issues-recheck.md) differs from this local printing; reconciliation is a " +
    "card-data task, and this program keeps the local sourceText verbatim"
);
