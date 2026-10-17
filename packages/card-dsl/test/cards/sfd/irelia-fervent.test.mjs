import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/irelia-fervent.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CARD_ID = "card.hash-cdc4606d9f9f7a0a63ed596fdbdee4a120ac153f9b1a74dd38db8c4c34616644";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When you choose or ready me, give me +1 :rb_might: this turn.";

const [deflectAbility, chooseTrigger, readyTrigger] = program.abilities;

/**
 * Production installs the card-program binding on a real ChainEngine
 * (RIFT-257: createProgramBinding + registerProgramTriggers). The golden
 * builds the same pair on the reference kernel so the triggers subscribe to
 * real emissions and the body resolves through the real interpreter.
 */
function ireliaFixture() {
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .unit("irelia", {
      owner: "A",
      cardId: CARD_ID,
      might: 4,
      exhausted: true,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const decide = () => { throw new AwaitChoice({ id: "x", type: "optional" }); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  // ProgramRegistry.get refuses judge-required programs before binding; the
  // local executable clone isolates the two halves this card already executes
  // (the merged continuous.might body and the RIFT-257 trigger registration),
  // while the shipped program keeps its judgeReason for the [Deflect] half.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const triggerIds = binding.registerProgramTriggers(engine, kernel.getObject("irelia"));
  return { kernel, engine, binding, triggerIds };
}

function resolveAll(fixture, { limit = 12 } = {}) {
  fixture.engine.advance();
  let guard = 0;
  while (fixture.engine.items.length && guard++ < limit) fixture.engine.pass(fixture.engine.priority);
}

test("sfd-057-221 Irelia, Fervent: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-057-221 Irelia, Fervent: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  // No merged task is still named as an outstanding dependency: RIFT-90/
  // RIFT-89/261 landed, only their remaining wiring gaps are named.
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|257|258|261)\b/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-057-221 Irelia, Fervent: [Deflect] plus two parallel trigger subscriptions for \"or\"", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  // 383.4.b / 383.4.b.1: "When you choose me" is a Targeting Effect, so it
  // subscribes to the became-target timing point; the anchor names this host
  // (objectId: "self") and the chooser (player: "self").
  assert.equal(chooseTrigger.kind, "triggered");
  assert.equal(chooseTrigger.trigger.at, "became-target");
  assert.deepEqual(chooseTrigger.trigger.filter, {
    event: "became-target",
    objectId: "self",
    player: "self"
  });
  assert.equal(chooseTrigger.optional, false);

  // 416 / 412.4: "or ready me" is a second, independent subscription — the
  // printed "or" joins trigger conditions, it is not a 355.11 mode choice.
  assert.equal(readyTrigger.kind, "triggered");
  assert.equal(readyTrigger.trigger.at, "object-readied");
  assert.deepEqual(readyTrigger.trigger.filter, {
    event: "object-readied",
    objectId: "self",
    player: "self"
  });
  assert.equal(readyTrigger.optional, false);
});

test("sfd-057-221 Irelia, Fervent: each trigger grants +1 Might this turn via a Might modification (not a Buff)", () => {
  for (const [trigger, id] of [
    [chooseTrigger, "irelia-fervent.choose-plus-1-might"],
    [readyTrigger, "irelia-fervent.ready-plus-1-might"]
  ]) {
    assert.equal(trigger.body.length, 1);
    const [instruction] = trigger.body;
    assert.equal(instruction.id, id);
    // 143.2.a / 475-477: temporary Might belongs to the arithmetic layer.
    assert.equal(instruction.op, "continuous.might");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
    // "me" is the ability host: the appliesTo "self" shorthand (contract 3.6),
    // not a fresh target choice.
    assert.deepEqual(instruction.args.appliesTo, { kind: "constant", value: "self" });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("sfd-057-221 Irelia, Fervent golden: a real became-target event on the host grants +1 Might this turn", () => {
  const fixture = ireliaFixture();
  // The merged chain emits became-target from TargetPlan finalization with the
  // targeted object as both object and target (chain/engine.ts); the trigger
  // subscribes with the same payload shape.
  fixture.engine.emit({
    timingPoint: "became-target",
    object: fixture.kernel.getObject("irelia"),
    target: fixture.kernel.getObject("irelia"),
    source: fixture.kernel.getObject("enemy"),
    player: "A"
  });
  resolveAll(fixture);

  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("irelia")).might, 5);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("enemy")).might, 3);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("irelia")).buffs, 0);
  assert.ok(fixture.engine.pipeline.events.some(event => event.timingPoint === "chain-item-resolve"));

  // 317.1.a / 468.7.c: expires at end of turn.
  fixture.engine.layers.expireAt("turn-end");
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("irelia")).might, 4);
});

test("sfd-057-221 Irelia, Fervent golden: a real ready action on the host grants +1 Might this turn", () => {
  const fixture = ireliaFixture();
  fixture.engine.commit({ type: "ready", object: fixture.kernel.ref("irelia") });
  resolveAll(fixture);

  assert.equal(fixture.kernel.getObject("irelia").exhausted, false);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("irelia")).might, 5);
  assert.ok(fixture.engine.pipeline.events.some(event => event.timingPoint === "object-readied"));
});

test("sfd-057-221 Irelia, Fervent golden: an enemy-controlled targeting does not trigger 'you choose me'", () => {
  const fixture = ireliaFixture();
  // player: "self" means the ability controller (events/pipeline-match.ts
  // playerMatches); an opponent doing the choosing must not fire the trigger.
  fixture.engine.emit({
    timingPoint: "became-target",
    object: fixture.kernel.getObject("irelia"),
    target: fixture.kernel.getObject("irelia"),
    source: fixture.kernel.getObject("enemy"),
    player: "B"
  });
  resolveAll(fixture);

  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("irelia")).might, 4);
});

test("sfd-057-221 Irelia, Fervent: the Deflect keyword definition stays a target tax, never a Might bonus", () => {
  assert.equal(deflect.keyword, "Deflect");
  const [tax] = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.effect.kind, "target.tax");
});

test("sfd-057-221 Irelia, Fervent: the merged static binder refuses the Deflect target tax", () => {
  // 809.1.a/809.1.d: [Deflect] expands to a static target.tax. The merged
  // production binder (programs/statics.ts layerFor) has no layer for that kind,
  // so it fails closed rather than silently dropping the additional cost. This is
  // the executed evidence for the single remaining gap in the judgeReason.
  const fixture = ireliaFixture();
  const source = fixture.kernel.getObject("irelia");
  const [tax] = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.effect.kind, "target.tax");
  assert.throws(
    () => createEngineStaticBinder({ layers: fixture.engine.layers }).bindStatic(tax, source),
    /Static ability kind target\.tax has no layer mapping/
  );
});

test.todo(
  "sfd-057-221 Irelia, Fervent: collect [Deflect]'s tax as any-domain Power when an opponent chooses this " +
    "unit (809.1.c.1) — needs a target.tax consumer that derives the tax from the permanent's static " +
    "effect (programs/statics.ts layerFor refuses target.tax) and an any-Domain Power booking instead of " +
    "the chain's Energy constant"
);
