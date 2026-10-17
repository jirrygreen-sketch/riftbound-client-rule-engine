import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/elnuk-herd.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

const CARD_ID = "card.hash-7451c4c0dfc182af5e8953981779aa897fa4d429f1fbddbbee5cf2c7ba59abe6";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, give another friendly unit +3 :rb_might: this turn, then recycle me if I was played from face down.";

function grantContext(scoped) {
  // Bind the ability controller to the reference kernel's absolute-player
  // query; source exclusion remains the original interpreter filter.
  return bindResolveContext(scoped, {
    query: filter => scoped.query({ ...filter, ...(filter.controller === "controller" ? { controller: scoped.controller } : {}) })
  });
}

test("rad-081-167 Elnuk Herd: validates, identity and registry entry", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /playedFromFaceDown/);
  assert.match(program.judgeReason, /811\.1\.d/);
  assert.match(program.judgeReason, /历史来源事实到 recycle 条件的绑定/);
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
    filter: { type: "unit", controller: "controller", exclude: "self", zone: "board" },
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

test("rad-081-167 Elnuk Herd: +3 Might this turn registers an arithmetic modifier through the real interpreter", () => {
  // The merged continuous.might primitive (RIFT-258) registers the arithmetic
  // modification with an end-of-turn duration; the layers engine applies it to
  // the chosen unit only. The interpreter checks the original TargetSpec,
  // including the source exclusion, against the bound controller query.
  const [grant] = program.abilities[1].body;
  const kernel = world().unit("elnuk", { might: 5 }).unit("ally", { might: 2 }).build();
  kernel.setTargets("elnuk-herd.another-unit", [kernel.ref("ally")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });

  const outcome = runAbilityBody([grant], grantContext(scoped));

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
  const kernel = world().unit("elnuk", { might: 5 }).build();
  kernel.setTargets("elnuk-herd.another-unit", []);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });

  const outcome = runAbilityBody([grant], grantContext(scoped));

  // 359.2.c: the instruction is mandatory but has no legal choice, so it
  // ignores rather than approximating a target.
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.continuousEffects.length, 0);
});

test("Elnuk Herd: the original Might target filter excludes this source and enemy units", () => {
  const [grant] = program.abilities[1].body;
  for (const selected of ["elnuk", "enemy"]) {
    const kernel = world().unit("elnuk", { might: 5 }).unit("enemy", { owner: "B", might: 3 }).build();
    kernel.setTargets("elnuk-herd.another-unit", [kernel.ref(selected)]);
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("elnuk") });
    const outcome = runAbilityBody([grant], grantContext(scoped));
    assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
    assert.equal(scoped.continuousEffects.length, 0);
  }
});

test.todo('Elnuk Herd: bind Hidden Hide/reaction/ignored-base-cost lifecycle and facedown play provenance to the recycle condition (CR 811.1.d)');
test.todo('Elnuk Herd: translate exclude:self target scope through production Finalize (another friendly unit)');
