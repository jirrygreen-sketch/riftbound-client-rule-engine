import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/back-alley-bar.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const [ability] = program.abilities;
const [instruction] = ability.body;
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const OTHER_BATTLEFIELD = { type: "battlefield", id: "battlefield-2" };

test("ogn-277-298 Back-Alley Bar: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-277-298 Back-Alley Bar: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-277-298) carries this text verbatim.
  assert.equal(program.sourceText, "When a unit moves from here, give it +1 :rb_might: this turn.");
  assert.match(program.judgeReason, /might/i);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("ogn-277-298 Back-Alley Bar: Move trigger filtered on this battlefield as the origin", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 421.1 / 449.1 / 449.2: Move is the location-changing action; the
  // object-moved timing point carries fromKind/fromLocationId. CR 458.1: a
  // Recall is not a Move, which is why the trigger is not a zone/location
  // change subscription.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    details: { fromKind: "battlefield", fromLocationId: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("ogn-277-298 Back-Alley Bar: the body asks for +1 Might this turn and targets no object", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "back-alley-bar.give-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  // RIFT-258 的 continuous.might：objects 用 target 选择符指名生效对象。这里的
  // TargetSpec 是触发载荷对象的结构性占位（CR 355.10.c：印刷文本从不做选择），
  // 直到事件对象选择器落地前不能当作可执行的完整语义。
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "back-alley-bar.moved-unit" }
  });
  assert.equal(instruction.targets.length, 1);
  assert.equal(instruction.targets[0].id, "back-alley-bar.moved-unit");
  assert.deepEqual(instruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-277-298 Back-Alley Bar: the merged Move primitive performs the move the trigger watches", () => {
  // The Move the trigger fires on is merged (events/action-adapter.ts emits
  // object-moved for a successful move-location): this asserts the movement
  // payload the trigger filter reads, including its origin location.
  const kernel = world()
    .unit("mover", { zone: "board", location: BATTLEFIELD })
    .build();
  const run = runInstruction(
    move,
    { objects: { kind: "constant", value: "source" }, to: { kind: "constant", value: OTHER_BATTLEFIELD } },
    { world: kernel.clone({ sourceSnapshot: kernel.getObject("mover") }) }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.equal(run.linked.moved.objects[0].id, "mover");
  assert.deepEqual(run.linked.moved.movements[0].from, BATTLEFIELD);
  assert.deepEqual(run.linked.moved.movements[0].to, OTHER_BATTLEFIELD);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("ogn-277-298 Back-Alley Bar: the merged continuous.might registers +1 for the stand-in and expires at cleanup (RIFT-258)", () => {
  const kernel = world().unit("mover", { owner: "A", controller: "A", might: 2 }).build();
  const run = runInstruction(
    might,
    {
      amount: instruction.args.amount,
      duration: instruction.args.duration,
      objects: instruction.args.objects.value
    },
    {
      world: kernel,
      targets: { "back-alley-bar.moved-unit": [kernel.ref("mover")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.layer, "arithmetic");
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });

  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("mover")).might, 3);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("mover")).might, 2);
});

test("ogn-277-298 Back-Alley Bar: a stand-in target that left the Board is ignored (359.3.e.6)", () => {
  const kernel = world().unit("mover", { owner: "A", controller: "A", might: 2 }).build();
  const stale = kernel.ref("mover");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    might,
    {
      amount: instruction.args.amount,
      duration: instruction.args.duration,
      objects: instruction.args.objects.value
    },
    { world: kernel, targets: { "back-alley-bar.moved-unit": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "ogn-277-298 Back-Alley Bar: naming the moved unit from the trigger payload needs an " +
    "event-object ObjectSelector (the frozen set is self/source/target/pick/linked)"
);

test.todo(
  "ogn-277-298 Back-Alley Bar: the object-moved trigger still cannot register: the card's nested " +
    "{ event, details } spelling is rejected by events/trigger-spec.ts and no merged consumer " +
    "binds a CardProgram's triggered ability into a TriggerRegistration (RIFT-257); the " +
    "origin-location payload and the Recall exclusion (CR 458.1) belong to RIFT-120."
);
