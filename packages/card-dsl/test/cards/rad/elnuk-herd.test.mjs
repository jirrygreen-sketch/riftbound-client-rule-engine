import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/elnuk-herd.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-7451c4c0dfc182af5e8953981779aa897fa4d429f1fbddbbee5cf2c7ba59abe6";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, give another friendly unit +3 :rb_might: this turn, then recycle me if I was played from face down.";

test("rad-081-167 Elnuk Herd: validates, identity and registry entry", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /811\.1\.d/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("rad-081-167 Elnuk Herd: [Hidden] keyword plus a card-played trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "hidden" });

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "elnuk-herd.grant-might",
    "elnuk-herd.recycle"
  ]);
});

test("rad-081-167 Elnuk Herd: +3 Might this turn targets one other friendly unit", () => {
  const [grant, recycleInstruction] = program.abilities[1].body;
  assert.equal(grant.op, "continuous.might");
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // The merged primitive's symbolic selector form (contract 3.6).
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "elnuk-herd.another-unit" }
  });
  assert.equal(grant.targets.length, 1);
  assert.deepEqual(grant.targets[0], {
    id: "elnuk-herd.another-unit",
    filter: { type: "unit", controller: "controller", other: true, zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "then recycle me if I was played from face down": the recycled object is the
  // ability source (355.10.d programmatic selection), never a TargetSpec.
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "object-property",
    object: "source",
    property: "ref"
  });
  assert.equal(recycleInstruction.targets, undefined);
  assert.equal(recycleInstruction.linkedTo, undefined);
  assert.deepEqual(recycleInstruction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "source", property: "playedFromFaceDown" },
    operator: "eq",
    right: { kind: "constant", value: true }
  });
});

test("rad-081-167 Elnuk Herd: the recycle gate fails closed while no facedown provenance exists", () => {
  const [, recycleInstruction] = program.abilities[1].body;
  const kernel = world()
    .unit("elnuk", { might: 5, zone: "board", location: { type: "base", player: "A" } })
    .deck("bottom-card")
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });
  const outcome = runAbilityBody([recycleInstruction], scoped);
  // The source snapshot has no 'playedFromFaceDown' characteristic: the read
  // throws MissingInformation, the interpreter turns it into ignored/mistargeted
  // and the unit is NOT recycled unconditionally (fail closed, never a silent
  // unconditional recycle).
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(scoped.getObject("elnuk").zone, "board");
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["bottom-card"]);
  assert.deepEqual(outcome.events, []);
});

test("rad-081-167 Elnuk Herd: recycle-me resolves through the merged effect.recycle primitive", () => {
  const [, recycleInstruction] = program.abilities[1].body;
  const kernel = world()
    .unit("elnuk", { might: 5, zone: "board", location: { type: "base", player: "A" } })
    .deck("bottom-card")
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });
  const run = runInstruction(recycle, recycleInstruction.args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.equal(run.linked.recycled[0].id, "elnuk");
  // 417.1.a: the source owned by A recycles to the bottom of A's Main Deck.
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["bottom-card", "elnuk"]);
  assert.equal(run.events[0].action, "recycle");
});

test.todo(
  "elnuk-herd: registering the card-played trigger (and its continuous.might / effect.recycle body) from the" +
    " card program — shared wiring owned by the RIFT-257 card-program binding workstream"
);
test.todo(
  "elnuk-herd: 'if I was played from face down' provenance (CR v1.5 811.1.d / 355.10.a.1 Facedown Zone)" +
    " once [Hidden]'s cost.hidden expansion and the card-played payload record it (RIFT-84)"
);

test("rad-081-167 Elnuk Herd: +3 Might this turn registers an arithmetic modifier through the real interpreter", () => {
  // The merged continuous.might primitive (RIFT-258) registers the arithmetic
  // modification with an end-of-turn duration; the layers engine applies it to
  // the chosen unit only. The Finalize-locked target comes from the kernel (its
  // filter comparison is literal), so the card's TargetSpec stays asserted
  // structurally above — the same approach as demacian-illuminators.
  const [grant] = program.abilities[1].body;
  const bodyWithoutTargets = [{ ...grant, targets: undefined }];
  const kernel = world().unit("elnuk", { might: 5 }).unit("ally", { might: 2 }).build();
  kernel.setTargets("elnuk-herd.another-unit", [kernel.ref("ally")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });

  const outcome = runAbilityBody(bodyWithoutTargets, scoped);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.equal(registration.effect.filter.objectId, "ally");

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 5);
  assert.equal(engine.evaluate(kernel.ref("elnuk")).might, 5);
  // 317.2.c: the this-turn modifier expires at the turn-end timing.
  engine.expireAt("turn-end", "A");
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 2);
});

test("rad-081-167 Elnuk Herd: no other friendly unit leaves the Might grant ignored", () => {
  const [grant] = program.abilities[1].body;
  const bodyWithoutTargets = [{ ...grant, targets: undefined }];
  const kernel = world().unit("elnuk", { might: 5 }).build();
  kernel.setTargets("elnuk-herd.another-unit", []);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });

  const outcome = runAbilityBody(bodyWithoutTargets, scoped);

  // 359.2.c: the instruction is mandatory but has no legal choice, so it
  // ignores rather than approximating a target.
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.continuousEffects.length, 0);
});
