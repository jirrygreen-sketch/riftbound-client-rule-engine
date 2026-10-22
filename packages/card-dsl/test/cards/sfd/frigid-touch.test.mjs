import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/frigid-touch.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL =
  "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9";
const CORE_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit -2 :rb_might: this turn.";

// Pinned to the repository snapshots listed in
// shared/rules/official-order/source-snapshots.json. Neither the effective
// Radiance notes nor the Spiritforged errata contains a Frigid Touch entry.
const OFFICIAL_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CANONICAL,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      published: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_URL,
      localSha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      applicableToThisCard: false,
      result: "reviewed: no Frigid Touch-specific ruling"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Frigid Touch correction"
    })
  })
});

const PRODUCTION_EVIDENCE = Object.freeze({
  reactionTiming: Object.freeze({
    canonicalCardId: CANONICAL,
    clauses: Object.freeze([
      "[Reaction] (Play any time, even before spells and abilities resolve.)"
    ]),
    ruleRefs: Object.freeze([
      "309.1", "312", "338.1.a", "338.1.a.1", "338.1.a.2", "354.1",
      "359.3.a", "359.3.c", "813", "813.1", "813.1.c.1", "813.2"
    ]),
    timeline: Object.freeze([
      "A starts the opener Play; moving it to the Chain creates Pending and closes the state.",
      "The opener Finalizes; before Resolve, A has Priority in the Closed State and may play a legally timed Reaction.",
      "Frigid Touch moves to the Chain as a second Pending item, Finalizes with its target and Repeat choice, and only then enters the ordinary pass/resolve sequence."
    ]),
    priorityFocus: "The pending opener keeps the state Closed. Reaction is the permission needed to make this discretionary Play while A has ordinary Priority; this Neutral Main-phase interaction grants no Focus.",
    responseWindow: "The production trace Finalizes the opener, accepts Frigid Touch as a Reaction, resolves the newest item first, then resolves the opener.",
    lki: "Not applicable: the selected unit stays on the Board through its execution; the target legality boundary is handled by 359.3.e in the Repeat interaction below.",
    regression: "production: Reaction can be played before a pending spell resolves"
  }),
  repeatMight: Object.freeze({
    canonicalCardId: CANONICAL,
    clauses: Object.freeze([
      "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)",
      "Give a unit -2 :rb_might: this turn."
    ]),
    ruleRefs: Object.freeze([
      "002", "051", "054.1", "303.2.a", "309.1", "355.1.a", "355.5",
      "355.7", "355.9.a", "355.9.a.1", "355.15", "356.4.f.1", "357",
      "359.3.d", "359.3.e.1", "359.3.e.2", "359.3.e.5", "468.7.c",
      "478.1", "479.4", "479.4.e", "479.4.e.2", "820.1", "820.1.b",
      "820.1.c.1", "820.1.d", "820.1.d.1", "820.2", "820.2.a", "820.3",
      "820.3.a"
    ]),
    timeline: Object.freeze([
      "Play moves Frigid Touch to the Chain as Pending and closes the state.",
      "Finalize asks A whether to pay Repeat and collects the 2-Energy Energy payment with the base 2-Energy payment.",
      "Finalize makes the usual target choices, locking one Board unit for execution 0 and a second independently for execution 1; legal Reaction responses follow the finalized choice and payment.",
      "Resolve revalidates and applies each execution in order, registering two arithmetic continuous.might effects; a stale execution target is ignored without suppressing the other.",
      "The card is played once even when both instructions execute; both -2 Might registrations expire at end of turn without adding Buff counters."
    ]),
    priorityFocus: "A makes both the optional additional-cost and target choices during the limited Make Relevant Choices step. After Finalize, A and B receive Priority in turn order before the spell resolves; no Focus is created outside a Showdown.",
    responseWindow: "After Frigid Touch Finalizes and before Resolve, the Chain is Closed; other players may add legally timed Reactions. The finalization action itself is not a discretionary response.",
    lki: "The original and additional executions retain separate frozen target locks. At Resolve each lock is revalidated; if one chosen unit changed non-Board Zones, only that execution is ignored under 359.3.e.2/.5, while the other still executes.",
    regression: "production: decline pays one effect; pay 4 total and choose first then second units for two -2 Might registrations; stale second lock is ignored"
  })
});

const [reaction, repeatKeyword, play] = program.abilities;
const [mightInstruction] = play.body;
const targetSpec = mightInstruction.targets[0];

function scene({
  paid,
  selections = { original: ["first-unit"], repeat: ["first-unit"] }
} = {}) {
  return productionPlay({
    programs: [program],
    turnPlayer: "A",
    answers: {
      "target:": (kernel, request) => {
        const ids = request.id.endsWith(":repeat:1") ? selections.repeat : selections.original;
        return ids.map((id) => kernel.ref(id));
      },
      // The optional cost request is owned by the frozen cost plan and is the
      // only Finalize question whose id contains this stable segment.
      "cost:": () => paid
    },
    build: (w) => w
      .player("A", { energy: 4, power: [] })
      .player("B", { energy: 4, power: [] })
      .hand("spell", {
        owner: "A",
        controller: "A",
        cardId: program.canonicalCardId,
        types: ["spell"],
        energy: 2,
        power: null
      })
      .unit("first-unit", {
        owner: "B",
        controller: "B",
        might: 6,
        location: { type: "base", player: "B" }
      })
      .unit("second-unit", {
        owner: "B",
        controller: "B",
        might: 6,
        location: { type: "base", player: "B" }
      })
      .hand("hand-unit", {
        owner: "B",
        controller: "B",
        types: ["unit"],
        might: 6,
        energy: null,
        power: null
      })
  });
}

const mightEffects = (f) => f.engine.layers.registry
  .list()
  .filter((entry) => entry.effect.effect.kind === "continuous.might");

const effectiveMight = (f, id) => f.might(id);

test("sfd-066-221 Frigid Touch validates, is registered, and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-066-221 Frigid Touch: official evidence and production timelines are pinned", () => {
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, CANONICAL);
  assert.deepEqual(OFFICIAL_EVIDENCE.sources.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_URL,
    localSha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.match(OFFICIAL_EVIDENCE.sources.radianceRulings.result, /no Frigid Touch-specific ruling/);
  assert.equal(OFFICIAL_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.match(OFFICIAL_EVIDENCE.sources.spiritforgedErrata.result, /no Frigid Touch correction/);
  assert.deepEqual(Object.keys(PRODUCTION_EVIDENCE), ["reactionTiming", "repeatMight"]);
  for (const interaction of Object.values(PRODUCTION_EVIDENCE)) {
    assert.equal(interaction.canonicalCardId, CANONICAL);
    assert.ok(interaction.ruleRefs.length > 0);
    assert.ok(interaction.timeline.length >= 3);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /response|window|Finalize/i);
    assert.ok(interaction.regression.startsWith("production:"));
  }
  for (const rule of ["820.1.d.1", "820.2", "820.2.a", "820.3.a", "359.3.e.5"]) {
    assert.ok(PRODUCTION_EVIDENCE.repeatMight.ruleRefs.includes(rule), `${rule} is pinned`);
  }
});

test("sfd-066-221 Frigid Touch: printed keywords and the payable Repeat declaration", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(repeatKeyword, { kind: "keyword", keyword: "repeat" });

  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  assert.equal(payment.choice.id, "repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");
});

test("sfd-066-221 Frigid Touch: the body is only the faithful Might modification", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "give-minus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "affected-unit" }
  });
  assert.deepEqual(targetSpec, {
    id: "affected-unit",
    filter: { type: "unit", zone: "board" },
    selection: "one"
  });

  // A fixed count is not authored into the card. Paid-instance repetition is
  // owned by the production receipt bridge, so this card needs no effect.repeat
  // action template (and especially no Buff action as a Might substitute).
  assert.equal(play.body.some((instruction) => instruction.op === "effect.repeat"), false);
});

test("sfd-066-221 Frigid Touch production: declining Repeat pays the base 2 and executes once", () => {
  const f = scene({ paid: false });
  const draft = f.play("spell", "A");

  assert.equal(draft.speed, "reaction");
  assert.equal(f.kernel.player("A").energy, 2);
  assert.equal(f.engine.layers.registry.list().length, 1);
  assert.equal(mightEffects(f).length, 1);
  assert.equal(effectiveMight(f, "first-unit"), 4);
  assert.equal(effectiveMight(f, "second-unit"), 6);
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
  const targetRequest = f.requests.find((request) => request.id.startsWith(`target:${targetSpec.id}`));
  assert.deepEqual(targetRequest.options.map((ref) => ref.id), ["first-unit", "second-unit"]);
  assert.equal(
    f.engine.pipeline.events.filter((event) => event.timingPoint === "card-played").length,
    1,
    "CR 820.3.a: Repeat is not another play"
  );
});

test("sfd-066-221 Frigid Touch production: Reaction can be played before a pending spell resolves", () => {
  const opener = {
    canonicalCardId: "synthetic:rift-917-reaction-opener",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    sourceText: "[Reaction]\nDo nothing.",
    abilities: [
      { kind: "keyword", keyword: "reaction" },
      {
        kind: "play",
        cost: { kind: "cost.printed", energy: { kind: "constant", value: 1 } },
        body: []
      }
    ]
  };
  const f = productionPlay({
    programs: [program, opener],
    turnPlayer: "A",
    answers: {
      [`target:${targetSpec.id}`]: (kernel) => [kernel.ref("first-unit")],
      "cost:": () => false
    },
    build: (w) => w
      .player("A", { energy: 4, power: [] })
      .player("B", { energy: 4, power: [] })
      .hand("spell", {
        owner: "A",
        controller: "A",
        cardId: program.canonicalCardId,
        types: ["spell"],
        energy: 2,
        power: null
      })
      .hand("opener", {
        owner: "A",
        controller: "A",
        cardId: opener.canonicalCardId,
        types: ["spell"],
        energy: 1,
        power: null
      })
      .unit("first-unit", {
        owner: "B",
        controller: "B",
        might: 6,
        location: { type: "base", player: "B" }
      })
  });

  const opening = f.describe("opener", "A");
  assert.equal(opening.speed, "reaction");
  f.engine.execute(opening);
  assert.equal(f.engine.turnState, "neutral-closed");
  assert.equal(f.engine.items.length, 1);

  const response = f.describe("spell", "A");
  assert.equal(response.speed, "reaction");
  f.engine.execute(response);
  assert.equal(f.engine.items.length, 2);
  f.settle();

  assert.equal(f.kernel.player("A").energy, 1);
  assert.equal(effectiveMight(f, "first-unit"), 4);
  assert.equal(f.engine.trace.filter((entry) => entry.step === "resolved").length, 2);
});

test("sfd-066-221 Frigid Touch production golden: Repeat reselects first and second units", () => {
  const f = scene({
    paid: true,
    selections: { original: ["first-unit"], repeat: ["second-unit"] }
  });
  const draft = f.describe("spell", "A");
  f.engine.execute(draft);
  const item = f.engine.items.find((entry) => entry.source.ref.id === "spell");
  assert.ok(item, "Frigid Touch reached Finalize");

  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(item.payment.paid, true);
  assert.deepEqual(
    item.targetPlans.map((plan) => [plan.repeatIndex, plan.selected.map((ref) => ref.id)]),
    [[0, ["first-unit"]], [1, ["second-unit"]]]
  );
  assert.deepEqual(
    f.targetRequests().map((request) => request.id),
    [`target:${targetSpec.id}`, `target:${targetSpec.id}:repeat:1`]
  );

  f.settle();
  assert.equal(mightEffects(f).length, 2);
  assert.equal(effectiveMight(f, "first-unit"), 4);
  assert.equal(effectiveMight(f, "second-unit"), 4);
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
  assert.equal(f.kernel.getObject("second-unit").buffs, 0);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "card-played").length, 1);
});

test("sfd-066-221 Frigid Touch production boundary: only a stale second target is ignored", () => {
  const f = scene({
    paid: true,
    selections: { original: ["first-unit"], repeat: ["second-unit"] }
  });
  f.engine.execute(f.describe("spell", "A"));
  const stale = f.kernel.ref("second-unit");
  assert.equal(f.kernel.perform({ type: "kill", object: stale }).status, "done");
  f.settle();

  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(mightEffects(f).length, 1);
  assert.equal(effectiveMight(f, "first-unit"), 4);
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
  assert.equal(f.kernel.getObject("second-unit").zone, "trash");
  assert.equal(f.kernel.getObject("second-unit").buffs, 0);
});

test("sfd-066-221 Frigid Touch production boundary: Repeat may choose the same unit twice", () => {
  const f = scene({
    paid: true,
    selections: { original: ["first-unit"], repeat: ["first-unit"] }
  });
  const draft = f.describe("spell", "A");
  f.engine.execute(draft);
  const item = f.engine.items.find((entry) => entry.source.ref.id === "spell");
  assert.deepEqual(
    item.targetPlans.map((plan) => [plan.repeatIndex, plan.selected.map((ref) => ref.id)]),
    [[0, ["first-unit"]], [1, ["first-unit"]]]
  );
  f.settle();

  assert.equal(effectiveMight(f, "first-unit"), 2);
  assert.equal(effectiveMight(f, "second-unit"), 6);
  assert.equal(mightEffects(f).length, 2);
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
});

test("sfd-066-221 Frigid Touch golden: the Might registration expires in the end-of-turn layer cleanup", () => {
  const kernel = world().unit("target-unit", { owner: "B", controller: "B", might: 6 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("target-unit")]);

  const outcome = resolveChainBody([mightInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(({ id, result }) => [id, result.status]), [
    ["give-minus-2-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 4);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 6);
  assert.equal(kernel.getObject("target-unit").buffs, 0);
});
