import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/ashe-focused.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createProgramBinding, registerProgramTriggers } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7f00252b4eaff7bcfcf3dff60f4ba8007ee573667f1912bed0ba0a6301e33a27";
const SOURCE_TEXT =
  "When you play me, choose an opponent. They reveal their hand. Choose a card revealed this way and banish it. " +
  "When they hold, return it to their hand (even if I'm no longer on the board).";
const REVEAL_HAND = "ashe-focused.reveal-hand";
const BANISH_CHOSEN = "ashe-focused.banish-chosen";
const RETURN_BANISHED = "ashe-focused.return-banished";
const BANISH_CHOICE = "ashe-focused.banish-choice";
const BANISHED_TARGET = "ashe-focused.banished-card";

const [playEffect, holdEffect] = program.abilities;
const [revealInstruction, banishInstruction] = playEffect.body;
const [returnInstruction] = holdEffect.body;
const banishedTargetSpec = returnInstruction.targets[0];

/**
 * The production chain normalizes the "self"/"opponent" controller/owner
 * selectors in its query override (chain/engine.ts context()). The reference
 * kernel compares filter fields literally, so the golden installs the same
 * normalization rule instead of rewriting the card's declared filter.
 */
function withProductionQuery(kernel, controller = "A") {
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self" || normalized[key] === "opponent") delete normalized[key];
    }
    const objects = raw(normalized);
    if (filter.owner === "opponent") return objects.filter(object => object.owner !== controller);
    if (filter.controller === "opponent") return objects.filter(object => object.controller !== controller);
    if (filter.controller === "self") return objects.filter(object => object.controller === controller);
    if (filter.owner === "self") return objects.filter(object => object.owner === controller);
    return objects;
  };
  return kernel;
}

test("unl-169-219 Ashe, Focused: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-169-219 Ashe, Focused: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.7/);
  assert.match(program.judgeReason, /391\.5/);
  assert.match(program.judgeReason, /registerDelayedTrigger/);
  // Third-sweep refresh: the delayed engine entry is merged (pipeline skips the
  // activeZones filter for delayed registrations), and the authored hold
  // placeholder cannot even register - the closed event vocabulary spells the
  // timing "held" and the player selector has no chosen-opponent form.
  assert.match(program.judgeReason, /events\/pipeline\.ts/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /linkKey/);
  assert.doesNotMatch(program.judgeReason, /已有引擎入口/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The judgeReason must name the concrete missing pieces (contract 3.1).
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-169-219 Ashe, Focused: the play effect is a card-played self trigger of reveal-hand then banish (383.4.a)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playEffect.kind, "triggered");
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playEffect.optional, false);

  // 425.1 / 425.3.a: revealing the whole hand carries no count.
  assert.equal(revealInstruction.id, REVEAL_HAND);
  assert.equal(revealInstruction.op, "effect.reveal");
  assert.deepEqual(revealInstruction.args.zone, { kind: "constant", value: "hand" });
  assert.equal(revealInstruction.args.count, undefined);
  // The player-target binding for "choose an opponent" is missing, so the
  // placeholder is recorded verbatim rather than resolved to a seat.
  assert.deepEqual(revealInstruction.args.player, { kind: "constant", value: "opponent" });
  assert.equal(revealInstruction.linkedTo, undefined);

  // 355.10.a: a hand card is not in a public zone, so this is a resolve-time
  // non-target choice feeding the merged banish primitive (428.1).
  assert.equal(banishInstruction.id, BANISH_CHOSEN);
  assert.equal(banishInstruction.op, "effect.banish");
  assert.equal(banishInstruction.linkedTo, REVEAL_HAND);
  assert.deepEqual(banishInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(banishInstruction.args.linkKey, { kind: "constant", value: "asheBanished" });
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: {
      choose: BANISH_CHOICE,
      filter: { zone: "hand", owner: "opponent" },
      chooser: "self",
      visibility: "public"
    }
  });
  assert.equal(banishInstruction.targets, undefined);
  assert.equal(banishInstruction.picks, undefined);
});

test("unl-169-219 Ashe, Focused: the hold effect is the delayed linked return of the banished card (383.4.d / 391.5)", () => {
  assert.equal(holdEffect.kind, "triggered");
  assert.equal(holdEffect.trigger.at, "hold");
  // The chooser scope ("they") has no IR player selector; the placeholder is
  // recorded, not resolved to any seat.
  assert.deepEqual(holdEffect.trigger.filter, { event: "hold", player: "chosen-opponent" });
  assert.equal(holdEffect.optional, false);
  assert.equal(holdEffect.body.length, 1);

  assert.equal(returnInstruction.id, RETURN_BANISHED);
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args.target, { kind: "constant", value: BANISHED_TARGET });
  // 448.2 / 108.7.a: a zone change to the owner's hand, not a Move.
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.equal(returnInstruction.picks, undefined);

  // 108.6 / 428.1: the recalled card sits in Banishment; "banished this way"
  // narrowing is the unmerged Linked Ability scope (see judgeReason).
  assert.deepEqual(banishedTargetSpec, {
    id: BANISHED_TARGET,
    filter: { zone: "banishment" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "even if I'm no longer on the board": the destination does not depend on
  // the source still being live (359.3.e.13).
  assert.equal(returnInstruction.condition, undefined);
});

test("unl-169-219 Ashe, Focused golden: revealing the chosen opponent's hand presents exactly those cards (425.3.a)", () => {
  const kernel = world()
    .hand("b-spell", { owner: "B", types: ["spell"] })
    .hand("b-unit", { owner: "B", types: ["unit"] })
    .hand("a-card", { owner: "A", types: ["unit"] })
    .build();
  const run = runInstruction(
    reveal,
    { player: { kind: "constant", value: "B" }, zone: revealInstruction.args.zone },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  // 425.1.a.2: revealed cards stay in their zone. Only B's hand is presented,
  // never the caster's.
  assert.deepEqual(run.linked.revealed.map(ref => ref.id), ["b-spell", "b-unit"]);
  assert.equal(kernel.getObject("b-spell").zone, "hand");
  assert.equal(kernel.getObject("a-card").zone, "hand");
});

test("unl-169-219 Ashe, Focused golden: the chosen revealed card is really banished (428.1)", () => {
  const kernel = withProductionQuery(
    world()
      .hand("b-spell", { owner: "B", types: ["spell"] })
      .hand("b-unit", { owner: "B", types: ["unit"] })
      .build()
  );
  // The card body runs through the production argument adapter
  // (chain/engine.ts -> resolveChainBody) with its own declared constant choose
  // selector; only the link back to the reveal half is dropped here, since that
  // instruction is asserted structurally and run separately above.
  const banishOnly = { ...banishInstruction };
  delete banishOnly.linkedTo;
  kernel.setAnswers({ ["ashe-focused.banish-chosen/" + BANISH_CHOICE]: [kernel.ref("b-spell")] });
  const outcome = resolveChainBody([banishOnly], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 428.2.a / 428.1: a banish moves the card to its owner's Banishment; the
  // unchosen card stays in hand.
  assert.equal(kernel.getObject("b-spell").zone, "banishment");
  assert.equal(kernel.getObject("b-unit").zone, "hand");
  assert.equal(outcome.linkedValues["ashe-focused.banish-chosen.asheBanishedCount"], 1);
  assert.deepEqual(outcome.linkedValues["ashe-focused.banish-chosen.asheBanishedObjects"], [
    { id: "b-spell", zoneEntryId: 2 }
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["banish"]);
});

test("unl-169-219 Ashe, Focused golden: the returned card comes back from Banishment to its owner's hand (108.7.a)", () => {
  const kernel = world()
    .card("banished-card", { owner: "B", types: ["spell"], zone: "banishment" })
    .player("B")
    .build();
  const run = runInstruction(
    zone,
    {
      target: returnInstruction.args.target.value,
      to: returnInstruction.args.to,
      amount: returnInstruction.args.amount
    },
    { world: kernel, targets: { [BANISHED_TARGET]: [kernel.ref("banished-card")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("banished-card").zone, "hand");
  // The owner keeps ownership even across the banish round trip (428.2.a).
  assert.equal(kernel.getObject("banished-card").owner, "B");
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["banished-card"]);
});

test("unl-169-219 Ashe, Focused: the merged delayed-trigger entry still fires after the source left the board (391.5)", () => {
  // The card cannot yet declare this trigger itself (see judgeReason), but the
  // engine entry the delay needs is real: a registration marked delayed skips the
  // activeZones filter in events/pipeline.ts, so the source leaving the Board does
  // not cancel it. This pins that half of the dependency before the command-side
  // declaration lands.
  const f = fixture({ cards: [{ id: "ashe", types: ["unit"], energy: 1, power: [] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("ashe"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  const source = f.kernel.getObject("ashe");
  f.engine.pipeline.registerTrigger({
    id: "delayed:1",
    source,
    controller: "A",
    delayed: true,
    // EventPatternType spells the scoring event "held" (trigger-spec.ts); the
    // TriggerSpec timing point itself is "hold".
    spec: { at: "hold", filter: { event: "held" } },
    body: [{ id: "return-banished", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }]
  });
  // 359.3.e.13 / “even if I'm no longer on the board”: the source leaves first.
  f.engine.commit({ type: "move-zone", object: source.ref, to: "hand" });
  assert.equal(f.kernel.getObject("ashe").zone, "hand");

  f.engine.emit({ timingPoint: "hold", player: "A" });

  assert.equal(f.engine.items.length, 1);
  // The pending trigger item carries the registration of the delayed ability;
  // its body is what resolves after the source is long gone.
  assert.deepEqual(f.engine.items[0].body.map(step => step.id), ["return-banished"]);
  assert.equal(f.engine.items[0].trigger.registration.delayed, true);
});

test.todo("ashe-focused: lock a chosen opponent as a player target and bind reveal/banish/hold to that player (CR 355.7/355.9.a)");

test.todo("ashe-focused: declare the delayed linked hold return from card data with the exact banished incarnation (CR 391.5/391.5.a) — the engine entry that survives source exit is covered above");

test("unl-169-219 Ashe, Focused: the authored hold placeholder cannot register under the closed trigger vocabulary (383.4.d)", () => {
  // Evidence for gap (2): the printed "When they hold" is not yet expressible.
  // The closed EventPattern vocabulary spells the timing "held", and
  // PlayerSelector only accepts self/opponent/any/{playerId}; the card records
  // the printed meaning as a placeholder. Binding the real program therefore
  // fails as a whole, so no seat is silently guessed.
  assert.throws(
    () => assertTriggerSpec({ at: holdEffect.trigger.at, filter: holdEffect.trigger.filter }),
    error => error.name === "TriggerSpecValidationError" && /trigger\.filter\.event/.test(error.message)
  );

  const executable = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const f = fixture({ cards: [{ id: "ashe", cardId: CANONICAL_ID, types: ["unit"], energy: 1, power: [] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("ashe"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  // programs/triggers.ts translates the declared filter and the pipeline's
  // assertTriggerSpec then rejects the placeholder, so the whole program fails
  // to bind instead of silently subscribing some other seat.
  assert.throws(() => registerProgramTriggers(binding.registry, f.engine, f.kernel.getObject("ashe")),
    /trigger\.filter\.event/);
});
