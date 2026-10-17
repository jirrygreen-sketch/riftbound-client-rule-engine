// Golden test for Consult the Heavens (rad-025-167).
//
// judge-required (see the program's judgeReason): the [Reaction] expansion is
// refused by the merged static binder, the Defender designation still has no
// producer. Predict uses the merged ordered-pick lifecycle, with real chain
// execution covering both recycle and keep for either controller.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/consult-the-heavens.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

/** Minimal engine so the production static binder can be exercised directly. */
function binderFor() {
  const kernel = world().player("A").player("B").unit("caster", { owner: "A", role: "unit" }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return createEngineStaticBinder(engine);
}

function sourceSnapshot() {
  return world().player("A").unit("caster", { owner: "A", types: ["unit"] }).build().getObject("caster");
}

const CANONICAL =
  "card.hash-9ce83ec71d8426d676f633ef7afbd7cd6b50566fd1e1404050adaf4c506e0faf";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)\n" +
  "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)";

const [reaction, play] = program.abilities;
const [grantShield, bindController, predictLook, predictRecycle] = play.body;

test("rad-025-167 Consult the Heavens: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-025-167 Consult the Heavens: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("combatRole"));
  assert.ok(program.judgeReason.includes("expr-ext"));
  assert.ok(program.judgeReason.includes("生命周期"));
  // README §2: Reaction timing and Defender designation remain blocked;
  // Predict now has an ordered source consumed by the real chain.
  assert.match(program.judgeReason, /Reaction/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /ChainEngine/);
  assert.match(program.judgeReason, /814\.1\.d\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  // The reported catalog data issue is recorded in the program header, not by
  // rewriting the text: this printing is catalogued as a Unit with no Might.
  assert.match(program.judgeReason, /cardType Unit/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-025-167 Consult the Heavens: [Reaction] plus a play body of grant + Predict", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => instruction.op),
    ["continuous.grant-keyword", "condition.value", "effect.inspect", "effect.recycle"]
  );
  // CR 813.1.c: Reaction is the closed-state permission keyword.
  assert.equal(reaction.keyword, "reaction");
});

test("rad-025-167 Consult the Heavens: the [Shield 2] grant names a unit, a value and a turn duration", () => {
  assert.equal(grantShield.op, "continuous.grant-keyword");
  assert.deepEqual(grantShield.args.keyword, { kind: "constant", value: "shield" });
  // CR 814.1.b.1/.b.2: the printed Shield Value is 2.
  assert.deepEqual(grantShield.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantShield.args.duration, { kind: "constant", value: "end-of-turn" });
  // CR 355.7/355.10.b: "a unit" is chosen, so it is a target.
  assert.equal(grantShield.targets.length, 1);
  const [target] = grantShield.targets;
  assert.equal(target.id, "consult-the-heavens.unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  // The selector is the merged primitive's symbolic form (contract 3.6); the
  // interpreter resolves it into the runtime ObjectRef at resolution time.
  assert.deepEqual(grantShield.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "consult-the-heavens.unit" }
  });
});

test("rad-025-167 Consult the Heavens: the [Predict] steps use the merged inspect + recycle primitives", () => {
  assert.equal(predictLook.op, "effect.inspect");
  // CR 437.3.a: Predict without a number looks at one card.
  assert.deepEqual(predictLook.picks, [{
    id: "consult-the-heavens.predicted",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
  }]);
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args, {
    value: { kind: "object-property", object: "source", property: "controller" },
    key: { kind: "constant", value: "controller" }
  });
  assert.equal(predictLook.linkedTo, bindController.id);
  assert.deepEqual(predictLook.args.player, {
    kind: "linked-value", instructionId: bindController.id, key: "controller"
  });
  assert.deepEqual(predictLook.args.choose, { kind: "constant", value: true });
  assert.deepEqual(predictLook.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  assert.equal(predictRecycle.op, "effect.recycle");
  assert.equal(predictRecycle.linkedTo, "consult-the-heavens.predict-look");
  assert.deepEqual(predictRecycle.args.objects, {
    kind: "linked",
    instructionId: "consult-the-heavens.predict-look",
    key: "consult-the-heavens.recycle"
  });
});

test("rad-025-167 Consult the Heavens: Predict really looks at the top card and recycles it on request", () => {
  // .deck([...]) adds an ordered block above the existing cards, so the second
  // call supplies the top (top-seen) and the first the card beneath it (rest).
  const kernel = world().hand("consult").deck(["rest"]).deck(["top-seen"]).build();
  const top = kernel.zone("A", "deck")[0];
  kernel.setPicks("consult-the-heavens.predicted", [top]);
  kernel.setAnswers({ "consult-the-heavens.predict-look/consult-the-heavens.predict": [top] });
  const looks = resolveChainBody([bindController, predictLook], kernel);
  assert.equal(looks.status, "executed");
  // CR 437.1: exactly one card was looked at, and the chosen one is the recycle candidate.
  assert.equal(looks.linkedValues["consult-the-heavens.predict-look.inspected"], 1);
  assert.deepEqual(looks.linkedValues["consult-the-heavens.predict-look.consult-the-heavens.predicted"], [top]);
  assert.deepEqual(looks.linkedValues["consult-the-heavens.predict-look.consult-the-heavens.recycle"], [top]);

  const recycled = runInstruction(
    recycle,
    { objects: { kind: "constant", value: looks.linkedValues["consult-the-heavens.predict-look.consult-the-heavens.recycle"] } },
    { world: kernel }
  );
  assert.equal(recycled.result.status, "executed");
  // CR 417.1.c: the recycled card goes to the bottom of its owner's Main Deck.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["rest", "top-seen"]);
});

test("rad-025-167 Consult the Heavens: declining to recycle leaves the deck untouched", () => {
  const kernel = world().hand("consult").deck(["rest"]).deck(["top-seen"]).build();
  const top = kernel.zone("A", "deck")[0];
  kernel.setPicks("consult-the-heavens.predicted", [top]);
  kernel.setAnswers({ "consult-the-heavens.predict-look/consult-the-heavens.predict": [] });
  const looks = resolveChainBody([bindController, predictLook], kernel);
  assert.equal(looks.status, "executed");
  assert.deepEqual(looks.linkedValues["consult-the-heavens.predict-look.consult-the-heavens.recycle"], []);
  const recycled = runInstruction(
    recycle,
    { objects: { kind: "constant", value: looks.linkedValues["consult-the-heavens.predict-look.consult-the-heavens.recycle"] } },
    { world: kernel }
  );
  // CR 055 / 437.1: choosing not to recycle performs nothing (zero cards moved)
  // and the card stays on top of the deck.
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 0);
  assert.deepEqual(recycled.linked.recycled, []);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["top-seen", "rest"]);
});

test("rad-025-167 Consult the Heavens: the [Shield 2] grant registers an ability-layer keyword through the real interpreter", () => {
  // CR 814.1.b.1/.c: the printed Shield Value is 2 and it is granted until the
  // end of the turn (317.2.c). The merged continuous.grant-keyword primitive
  // (RIFT-258) is the producer; the layers engine reads the granted keyword
  // back with its value.
  const kernel = world().unit("hero", { might: 2 }).unit("ally", { might: 3, combatRole: "defender" }).build();
  kernel.setTargets("consult-the-heavens.unit", [kernel.ref("ally")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hero") });

  const outcome = runAbilityBody([grantShield], scoped);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "shield");
  assert.equal(registration.effect.effect.keywordValue, 2);
  assert.equal(scoped.getObject("ally").combatRole, "defender");
  assert.equal(scoped.evaluate({ kind: "object-property", object: { target: "consult-the-heavens.unit" }, property: "combatRole" }), "defender");
  // The grant is applied to the chosen unit, not to the ability's own source.
  assert.equal(registration.effect.filter.objectId, "ally");

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.deepEqual(engine.evaluate(kernel.ref("ally")).keywords, [{ id: "shield", value: 2 }]);
  assert.deepEqual(engine.evaluate(kernel.ref("hero")).keywords, []);
  // 317.2.c / 468.7.c: the end-of-turn duration expires at the turn-end timing.
  engine.expireAt("turn-end", "A");
  assert.deepEqual(engine.evaluate(kernel.ref("ally")).keywords, []);
});

test("rad-025-167 Consult the Heavens: a stale unit target ignores the grant instead of granting something else", () => {
  const kernel = world().unit("hero", { might: 2 }).unit("ally", { might: 3 }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("consult-the-heavens.unit", [stale]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hero") });

  const outcome = runAbilityBody([grantShield], scoped);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.continuousEffects.length, 0);
  assert.deepEqual(kernel.getObject("ally").keywords, []);
});

test("rad-025-167 Consult the Heavens: the whole printed body runs in order through the production chain adapter", () => {
  // This adapter-level test supplies picks explicitly; the chain tests below
  // also cover Finalize's zoneSlice binding without modifying the printed body.
  const kernel = world().unit("hero", { might: 2 }).unit("ally", { might: 3 }).deck(["rest"]).deck(["top-seen"]).build();
  kernel.setTargets("consult-the-heavens.unit", [kernel.ref("ally")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hero") });
  const top = kernel.zone("A", "deck")[0];
  scoped.setPicks("consult-the-heavens.predicted", [top]);
  scoped.setAnswers({ "consult-the-heavens.predict-look/consult-the-heavens.predict": [top] });

  const outcome = resolveChainBody(play.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["consult-the-heavens.grant-shield", "executed"],
    ["consult-the-heavens.bind-controller", "executed"],
    ["consult-the-heavens.predict-look", "executed"],
    ["consult-the-heavens.predict-recycle", "executed"]
  ]);
  assert.equal(scoped.continuousEffects.length, 1);
  // 437.1: exactly one card was looked at, and 417.1.c put the chosen card at
  // the bottom of its owner's Main Deck.
  assert.equal(outcome.linkedValues["consult-the-heavens.predict-look.inspected"], 1);
  // The replay kernel clones state per resolution, so the recycled order is
  // read from the scoped context that actually ran the body.
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["rest", "top-seen"]);
});

test("rad-025-167 Consult the Heavens: declining to recycle performs an empty recycle and keeps the deck order", () => {
  const kernel = world().unit("hero", { might: 2 }).unit("ally", { might: 3 }).deck(["rest"]).deck(["top-seen"]).build();
  kernel.setTargets("consult-the-heavens.unit", [kernel.ref("ally")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hero") });
  const top = kernel.zone("A", "deck")[0];
  scoped.setPicks("consult-the-heavens.predicted", [top]);
  scoped.setAnswers({ "consult-the-heavens.predict-look/consult-the-heavens.predict": [] });

  const outcome = resolveChainBody(play.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["consult-the-heavens.predict-recycle.recycledCount"], 0);
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["top-seen", "rest"]);
});

test.todo(
  "Consult the Heavens: the [Shield 2] modifier applies +2 only while the unit holds the Defender designation " +
    "(814.1.d.1); combatRole exists, but designation alias consumption, granted-keyword expansion and combat role production remain unbound"
);

test("Consult the Heavens: the [Reaction] expansion is refused by the merged static binder", () => {
  // 813.1.c: Reaction grants closed-state play permission through a
  // continuous.timing static ability. The merged binder has no supported
  // appliesTo shape for it, so binding fails loudly rather than registering a
  // permission that applies to nothing.
  const reaction = keywordDefinitionsById.get("Reaction");
  assert.ok(reaction, "the merged Reaction KeywordDef is present");
  const [timingAbility] = reaction.expand({});
  assert.equal(timingAbility.kind, "static");
  assert.equal(timingAbility.effect.kind, "continuous.timing");
  assert.throws(
    () => binderFor().bindStatic(timingAbility, sourceSnapshot()),
    /Unsupported static appliesTo/
  );
});

test("Consult the Heavens: the [Shield 2] expansion does bind, while designation expression and granted-keyword lifecycle wiring remain", () => {
  // 814.1.c: Shield expands to the arithmetic-layer +Might that is gated on the
  // Defender designation. The merged binder accepts the static ability, so the
  // remaining gap is the missing designation characteristic, not the binding.
  const shield = keywordDefinitionsById.get("Shield");
  assert.ok(shield, "the merged Shield KeywordDef is present");
  const [mightAbility] = shield.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  assert.equal(mightAbility.kind, "static");
  assert.equal(mightAbility.effect.kind, "continuous.might");
  const handle = binderFor().bindStatic(mightAbility, sourceSnapshot());
  assert.equal(typeof handle.unbind, "function");
});

for (const controller of ["A", "B"]) {
  for (const shouldRecycle of [true, false]) {
    test(`Consult the Heavens: ChainEngine ${controller} ${shouldRecycle ? "recycles" : "keeps"} the actual top card (437.1)`, () => {
      const predictRequests = [];
      const f = fixture({
        turnPlayer: controller,
        cards: [{
          id: "consult", cardId: CANONICAL, owner: controller, controller,
          types: ["unit"], energy: 1, power: null, might: null
        }],
        choose: request => {
          if (request.id === "target:consult-the-heavens.unit") return [f.kernel.ref("source")];
          if (request.id === "consult-the-heavens.predict-look/consult-the-heavens.predict") {
            predictRequests.push(structuredClone(request));
            return shouldRecycle ? [...request.options] : [];
          }
          throw new Error(`Unexpected choice: ${request.id}`);
        }
      });
      const initialDeck = f.kernel.zone(controller, "deck");
      const opponent = controller === "A" ? "B" : "A";
      const opponentDeck = f.kernel.zone(opponent, "deck");
      const top = initialDeck[0];
      // The test world retains insertion order for query; only zoneSlice
      // supplies physical deck order. No setPicks or player substitution.
      assert.notEqual(f.kernel.query({ owner: controller, zone: "deck" })[0].ref.id, top.id);
      f.engine.advance();
      f.engine.execute(f.card("consult", { controller, kind: "unit", body: play.body }));

      assert.equal(f.engine.items.length, 0);
      assert.equal(f.kernel.getObject("consult").zone, "board");
      assert.equal(f.kernel.player(controller).energy, 19);
      assert.equal(f.kernel.getObject("consult").power, null);
      assert.equal(predictRequests.length, 1);
      assert.equal(predictRequests[0].chooser, controller);
      assert.equal(predictRequests[0].visibility, "chooser-only");
      assert.equal(predictRequests[0].min, 0);
      assert.equal(predictRequests[0].max, 1);
      assert.deepEqual(predictRequests[0].options, [top]);
      assert.equal(f.kernel.linked("consult-the-heavens.predict-look.inspected"), 1);
      assert.deepEqual(f.kernel.linked("consult-the-heavens.predict-look.consult-the-heavens.predicted"), [top]);
      assert.deepEqual(f.kernel.linked("consult-the-heavens.predict-look.consult-the-heavens.recycle"), shouldRecycle ? [top] : []);
      assert.equal(f.kernel.linked("consult-the-heavens.predict-recycle.recycledCount"), shouldRecycle ? 1 : 0);
      assert.deepEqual(f.kernel.zone(controller, "deck").map(ref => ref.id),
        (shouldRecycle ? [...initialDeck.slice(1), top] : initialDeck).map(ref => ref.id));
      assert.deepEqual(f.kernel.zone(opponent, "deck"), opponentDeck);
      assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("source")).keywords, [{ id: "shield", value: 2 }]);
      const events = f.engine.pipeline.events;
      const finalizeIndex = events.findIndex(event => event.timingPoint === "chain-item-finalize");
      const lookIndex = events.findIndex(event => event.timingPoint === "cards-looked-at");
      assert.ok(finalizeIndex >= 0 && lookIndex > finalizeIndex);
      assert.equal(events[lookIndex].player, controller);
      assert.equal(events.filter(event => event.timingPoint === "cards-looked-at").length, 1);
      assert.equal(events.filter(event => event.timingPoint === "card-recycled").length, shouldRecycle ? 1 : 0);
      // Only the printed unit is targeted; the deck-top pick is never a target.
      assert.deepEqual(events.filter(event => event.timingPoint === "became-target").map(event => event.target.ref.id), ["source"]);
    });
  }
}

test.todo(
  "Consult the Heavens: data issue (not changed) — the local catalog records printing rad-025-167 as cardType Unit with energy 1 / " +
    "power null / might null while its text is spell-shaped ([Reaction]/[Predict]), unlike the sibling rad-034-167 Hunker Down (Spell)"
);
