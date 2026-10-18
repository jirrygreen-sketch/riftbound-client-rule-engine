import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/illaoi-prophet-of-the-great-kraken.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-aab496105448f9073e9ec14bc0fc63bb55d3209146671be6e19899fb696a2bd2";
const SOURCE_TEXT =
  "When you play me or when I score, play a :rb_energy_1: :rb_might: Tentacle unit token from Bilgewater.\n" +
  "I have +1 :rb_might: for each token unit you control.";

const [playTrigger, scoreTrigger, mightAbility] = program.abilities;
const [playTentacle] = playTrigger.body;
const [scoreTentacle] = scoreTrigger.body;

const illaoiKernel = () => world().player("controller").build().clone({ controller: "controller" });

/** The program as the production registry sees it (status still judge-required). */
const executableView = { ...program, status: "executable", judgeReason: undefined };

test("ven-109-166 Illaoi: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-109-166 Illaoi: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /score/);
  assert.match(program.judgeReason, /scored/);
  assert.match(program.judgeReason, /473\.2/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /valueOf/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-109-166 Illaoi: the two printed triggers are separate, both playing the Tentacle token", () => {
  assert.deepEqual(playTrigger.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self" } }
  });
  // 470.3 / 473.2: the closed Scoring timing point (not "Score X points").
  assert.deepEqual(scoreTrigger.trigger, {
    at: "score",
    filter: { event: "score", filter: { source: "self" } }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(scoreTrigger.optional, false);

  // Instruction ids are unique inside one card; the two triggers share the text.
  assert.equal(playTentacle.id, "illaoi.play-tentacle-token");
  assert.equal(scoreTentacle.id, "illaoi-score.play-tentacle-token");
  for (const instruction of [playTentacle, scoreTentacle]) {
    assert.equal(instruction.op, "effect.token");
    // 187.10: Tentacle is a domainless 1 Might Bilgewater unit token.
    assert.deepEqual(instruction.args.token, { kind: "constant", value: "tentacle" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // 440.2.c / 185.2.a: a played token is created on the chain first.
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
    assert.deepEqual(instruction.args.location, {
      kind: "constant",
      value: { type: "base", player: "controller" }
    });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("ven-109-166 Illaoi: +1 Might for each token unit you control", () => {
  assert.equal(mightAbility.kind, "static");
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.equal(mightAbility.effect.appliesTo, "self");
  assert.equal(mightAbility.effect.amount.kind, "count");
  assert.equal(mightAbility.effect.amount.subject, "token-units-you-control");
  assert.deepEqual(mightAbility.effect.amount.filter, {
    type: "token",
    controller: "controller",
    zone: "board"
  });
  assert.equal(mightAbility.condition, undefined);
});

test("ven-109-166 golden: the printed Tentacle token is really created and played (187.10)", () => {
  const kernel = illaoiKernel();
  const run = runInstruction(token, playTentacle.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(
    run.events.map(event => [event.action, event.timingPoint]),
    [
      ["create-token", "chain-item-pending"],
      ["play", "card-played"]
    ]
  );

  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [tentacle] = created;
  assert.equal(tentacle.name, "Tentacle");
  assert.equal(tentacle.might, 1);
  assert.deepEqual(tentacle.tags, ["Bilgewater"]);
  assert.equal(tentacle.isToken, true);
  assert.equal(tentacle.controller, "controller");
  assert.deepEqual(tentacle.location, { type: "base", player: "controller" });
  // 185.3: tokens have no printed cost or domain - null means no printed value.
  assert.equal(tentacle.energy, null);
  assert.equal(tentacle.power, null);

  assert.equal(run.linked["tentacle.amount"], 1);
  assert.equal(run.linked["tentacle.objects"].length, 1);
  assert.deepEqual(kernel.pendingItems, []);
});

test("ven-109-166 golden: the score-trigger body drives the same token path", () => {
  const kernel = illaoiKernel();
  const run = runInstruction(token, scoreTentacle.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].tags, ["Bilgewater"]);
  assert.equal(created[0].might, 1);
});

test("ven-109-166 golden: the token definition stays domainless and never gains a printed cost", () => {
  // 185.3.a.1 treats a token's cost as zero for payment, but that is not a
  // printed value: the definition keeps null.
  const kernel = illaoiKernel();
  runInstruction(token, playTentacle.args, { world: kernel });
  const [tentacle] = kernel.query({ zone: "board", type: "unit" });
  assert.equal(tentacle.energy, null);
  assert.equal(tentacle.power, null);
  assert.notEqual(tentacle.energy, 0);
  assert.notEqual(tentacle.power, 0);
});

test("ven-109-166 golden: an opponent's base is not a legal unit Base destination", () => {
  // Contract 3.6: a unit token may only be created at its controller's Base.
  const kernel = world().player("controller").player("B").build().clone({ controller: "controller" });
  const run = runInstruction(
    token,
    {
      ...playTentacle.args,
      location: { kind: "constant", value: { type: "base", player: "B" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.query({ zone: "board" }), []);
});

test("ven-109-166 evidence: the authored score discriminant is not in the trigger vocabulary", () => {
  // 470.3/473.2: the closed vocabulary spells the scoring event "scored" and
  // maps it onto the score timing point; the card's "score" spelling is an
  // event class name that does not exist, so registration fails closed.
  const registry = new ProgramRegistry([executableView]);
  const { engine, kernel } = fixture({ cards: [{
    id: "illaoi", cardId: CANONICAL_ID, types: ["unit"], might: 4, energy: 6, power: null
  }] });
  assert.throws(
    () => registerProgramTriggers(registry, engine, kernel.getObject("illaoi")),
    (error) => error instanceof Error && /trigger\.filter\.event/.test(error.message)
  );
});

test("ven-109-166 evidence: even with the closed spelling, a real score never reaches the host", () => {
  // 473.2 wants the trigger anchored to the Battlefield that Scored. The score
  // emission carries only player/details.battlefieldId - no object - while the
  // translator turns source:"self" into an event-object self reference, so no
  // chain item is produced for a real scoring event.
  const patched = {
    ...executableView,
    abilities: program.abilities.map((ability, index) => index !== 1 ? ability : {
      ...ability,
      trigger: { at: "score", filter: { event: "scored", filter: { source: "self" } } }
    })
  };
  const registry = new ProgramRegistry([patched]);
  const { engine, kernel } = fixture({ cards: [{
    id: "illaoi", cardId: CANONICAL_ID, types: ["unit"], might: 4, energy: 6, power: null
  }] });
  engine.commit({ type: "move-zone", object: kernel.ref("illaoi"), to: "base" });
  registerProgramTriggers(registry, engine, kernel.getObject("illaoi"));
  engine.pipeline.emit({ timingPoint: "score", player: "A", details: { battlefieldId: "bf-1" } });
  assert.equal(engine.items.length, 0);
});

test("ven-109-166 evidence: the arithmetic count amount is never evaluated", () => {
  // "for each token unit you control": layers/engine.ts valueOf does not resolve
  // count, so the amount falls back to zero and the layered Might never moves.
  const { engine, kernel } = fixture({ cards: [{
    id: "illaoi", cardId: CANONICAL_ID, types: ["unit"], might: 4, energy: null, power: null
  }] });
  const binder = createEngineStaticBinder(engine);
  const handle = binder.bindStatic(mightAbility, kernel.getObject("illaoi"));
  engine.commit({
    type: "create-token", to: "board", player: "A", location: { type: "base", player: "A" },
    token: { name: "Tentacle", might: 1, types: ["unit"], isToken: true }
  });
  assert.equal(engine.layers.snapshot(kernel.ref("illaoi")).might, 4);
  handle.unbind();
});

test("ven-109-166 evidence: the type filter cannot express a token unit conjunction", () => {
  // The merged matcher treats "token" as one more type predicate, so token gear
  // (for example a Gold token) would be counted as a token unit too.
  const tokenObject = (types) => ({
    ref: { id: "t", zoneEntryId: 1 }, cardId: null, name: "t", types, tags: [], keywords: [],
    owner: "A", controller: "A", zone: "board", location: { type: "base", player: "A" },
    combatRole: null, might: 1, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: true
  });
  assert.equal(matchesObjectFilter({ type: "token", zone: "board" }, tokenObject(["unit"])), true);
  assert.equal(matchesObjectFilter({ type: "token", zone: "board" }, tokenObject(["gear"])), true);
});

test.todo(
  "ven-109-166 Illaoi: correlate 'when I score' with the host battlefield (470.3 / 473.2) - " +
    "turn/flow.ts emits score with details.battlefieldId, but the emission has no object and the " +
    "matcher needs a host-location <-> details.battlefieldId join"
);

test.todo(
  "ven-109-166 Illaoi: evaluate the count amount in the arithmetic layer and express the " +
    "'token unit' conjunction - layers/engine.ts valueOf ignores count and the merged filter " +
    "counts token gear as a token unit"
);

test.todo(
  "ven-109-166 Illaoi: accept the authored scoring discriminant in the closed event vocabulary " +
    "or spell it \"scored\" plus add the score anchor - the current \"score\" spelling is rejected " +
    "by registerTrigger"
);

