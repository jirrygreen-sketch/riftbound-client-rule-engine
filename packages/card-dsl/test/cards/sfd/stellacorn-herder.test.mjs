import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/stellacorn-herder.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { assertTriggerSpec, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CARD_ID = "card.hash-00a882b72ff4d8c644400fb6de458749cbdda6c6b7141ca71544931161253781";
const SOURCE_TEXT = "When I move, draw 1.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

test("sfd-048-221 Stellacorn Herder: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-048-221 Stellacorn Herder: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /fromKind|fromLocationId/);
  assert.match(program.judgeReason, /421\.1/);
  assert.match(program.judgeReason, /458/);
  assert.match(program.judgeReason, /registerProgramTriggers/);
  assert.match(program.judgeReason, /path=trigger\.filter\.event/);
  // RIFT-39/RIFT-257 merged before this sweep, and RIFT-120 (which only covered
  // the chain/event batch) is merged as well, so none may stay listed as a
  // dependency; the live gaps are the closed event vocabulary and the movement
  // payload itself.
  assert.ok(!/RIFT-39|RIFT-120|RIFT-257/.test(program.judgeReason), "merged task ids must not remain listed");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-048-221 Stellacorn Herder: object-moved self trigger with one draw of 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 458: a Move, not a Recall.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "stellacorn-herder.draw-1");
  assert.equal(drawOne.op, "effect.draw");
  // 414.3: printed "Draw 1"; the drawer defaults to the ability controller (190.6.d).
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.condition, undefined);
});

test("sfd-048-221 Stellacorn Herder golden: the body draws the top card through the interpreter", () => {
  const kernel = world().unit("stellacorn", { might: 3 }).deck(["deep", "top"]).build();
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["stellacorn-herder.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  // An array deck block is listed top-to-bottom, so "deep" is the top card.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deep"]);
  assert.equal(outcome.linkedValues["stellacorn-herder.draw-1.drawn"], 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
});

test("sfd-048-221 Stellacorn Herder golden: an empty Main Deck links the actual count of 0 (414.4)", () => {
  const kernel = world().unit("stellacorn", { might: 3 }).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("sfd-048-221 Stellacorn Herder: the merged program binding resolves the self anchor to this card", () => {
  // translateTriggerFilter resolves the inner anchor filter: { source: "self" }
  // into the moved object's objectId anchor, so "this card moved" identity is
  // consumed by the merged binding and is not itself the gap.
  const translated = translateTriggerFilter(ability.trigger.filter, "stellacorn", "object-moved");
  assert.deepEqual(translated, {
    event: "object-moved",
    object: { objectId: "stellacorn" }
  });
});

test("sfd-048-221 Stellacorn Herder: the translated object-moved filter is accepted by the trigger validator", () => {
  // object-moved is a closed EventPattern type and the host anchor survives
  // production translation.
  const translated = translateTriggerFilter(ability.trigger.filter, "stellacorn", "object-moved");
  const validated = validateTriggerSpec({ at: "object-moved", filter: translated });

  assert.equal(validated.ok, true);
  assert.deepEqual(validated.issues, []);
  assert.doesNotThrow(() => assertTriggerSpec({ at: "object-moved", filter: translated }));
});

test("sfd-048-221 Stellacorn Herder: a real Move publishes its origin and destination payload", () => {
  // 449.1/449.2: object-moved now carries both LocationRefs so a trigger can
  // distinguish the Move from a Recall and evaluate destination restrictions.
  const kernel = world().player("A").player("B")
    .unit("mover", { controller: "A", location: { type: "battlefield", id: "bf1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: (saved) => kernel.restore(saved),
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("the Move must not require a choice"); },
    context: () => kernel
  });

  const moved = host.execute({
    type: "move-location",
    object: kernel.ref("mover"),
    to: { type: "battlefield", id: "bf2" }
  });
  assert.equal(moved.outcome.status, "done");
  assert.deepEqual(kernel.getObject("mover").location, { type: "battlefield", id: "bf2" });

  const [event] = moved.emissions.filter((emission) => emission.timingPoint === "object-moved");
  assert.ok(event, "a real Move must publish object-moved");
  assert.equal(event.object.ref.id, "mover");
  assert.deepEqual(
    [event.details?.fromKind, event.details?.fromLocationId],
    ["battlefield", "bf1"]
  );
  assert.deepEqual(
    [event.details?.toKind, event.details?.toLocationId],
    ["battlefield", "bf2"]
  );
  assert.deepEqual(
    [event.fromZone, event.toZone, event.details?.objectIds, event.details?.objectCount],
    ["battlefield", "battlefield", ["mover"], 1]
  );
  // This layer derives the Move event alone: the object-leaves-*/object-enters-*
  // emissions that do describe the Locations come from the turn driver, so the
  // Move event itself stays unreadable for a "when I move" filter.
  assert.deepEqual(moved.emissions.map((emission) => emission.timingPoint), ["object-moved"]);
});
