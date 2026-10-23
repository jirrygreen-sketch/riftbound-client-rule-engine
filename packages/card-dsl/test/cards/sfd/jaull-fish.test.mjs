// Jaull-Fish production evidence. Every gameplay test below uses the original
// registry-shaped CardProgram with productionPlay: createProgramBinding,
// ChainEngine, the default action pipeline host, and attachLifecycle.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/jaull-fish.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CARD_ID = "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732";
const CORE_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL = "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
  "I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)";
const PRINTED = Object.freeze({
  id: "sfd-103-221",
  cardType: "Unit",
  domains: ["Body"],
  energy: 7,
  power: 2
});

// Pinned official evidence for the production assertions in this file. The
// source snapshots are recorded in
// shared/rules/official-order/source-snapshots.json. Neither the effective
// Radiance patch nor the Spiritforged errata contains a Jaull-Fish entry or a
// correction to its printed text.
const OFFICIAL_EVIDENCE = Object.freeze({
  canonicalCardId: CARD_ID,
  coreRules: Object.freeze({
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_URL
  }),
  radianceRulings: Object.freeze({
    published: "2026-10-09",
    effective: "2026-10-16",
    url: RADIANCE_URL,
    applicableToThisCard: false,
    result: "reviewed: no Jaull-Fish ruling changes the CR v1.5 treatment"
  }),
  spiritforgedErrata: Object.freeze({
    url: SFD_ERRATA_URL,
    applicableToThisCard: false,
    result: "reviewed: no Jaull-Fish correction"
  })
});

const PRODUCTION_EVIDENCE = Object.freeze({
  mightyDiscount: Object.freeze({
    canonicalCardId: CARD_ID,
    rules: Object.freeze(["143.2", "356.4.a", "356.4.b", "356.4.g", "356.6", "706", "707", "708", "710"]),
    timeline: Object.freeze([
      "Play",
      "Pending",
      "Finalize asks whether to pay Accelerate",
      "Finalize counts each friendly Board Unit with layered current Might >= 5",
      "Freeze one 2-Energy discount per Mighty Unit subject to the total Energy floor of 0",
      "Pay the frozen Energy plan",
      "Resolve / move to Board"
    ]),
    priorityFocus: "Payment-plan construction is a Limited Action controlled by A during Finalize. Passive cost modification creates no Focus; A's ordinary Main-phase Priority does not create another discretionary window.",
    responseWindow: "No player may respond to the static discount itself. After the item is Finalized, only Reaction-speed items may be added while the Chain is Closed.",
    lki: "Not applicable: 356.4.g freezes a value computed from live Board characteristics during Finalize; the card Query must not read Might from a departed or prior incarnation.",
    regression: "production: current layered Might yields 7/5/3/0 and is frozen at Finalize"
  }),
  accelerate: Object.freeze({
    canonicalCardId: CARD_ID,
    rules: Object.freeze([
      "143.4", "143.4.a", "303", "309", "312", "337.1.a", "337.2",
      "355.1.a", "356.4.f.1", "805.1.b", "805.1.b.1", "805.2.b", "805.6", "805.6.a"
    ]),
    timeline: Object.freeze([
      "Play",
      "Pending",
      "Priority holder A receives the ordinary Play with no target choice",
      "Finalize asks A whether to pay [1][Body]",
      "Receipt binds the paid optional cost to this exact play and plan",
      "Default exhausted entry is frozen before the Board move",
      "Only a paid receipt matches the delayed entry replacement",
      "Direct ready entry emits no object-readied timing"
    ]),
    priorityFocus: "A holds ordinary Main-phase Priority when starting the Play and makes the Limited optional-cost choice during Finalize. This interaction creates no Focus. The unit resolves immediately after Finalize under CR 337.2, without passing Priority.",
    responseWindow: "There is no post-Finalize response window for this Unit Play: CR 337.2 sends a finalized Unit directly to Resolve. The optional-cost decision and payment are parts of Finalize, not discretionary responses.",
    lki: "Not applicable to this interaction: the paid receipt and source id + zoneEntryId bind the delayed replacement to the same play. No left-Board characteristic is read.",
    regression: "production: decline enters exhausted; pay adds [1][Body] and enters ready without object-readied"
  })
});

function assertEvidence(entry) {
  assert.equal(entry.canonicalCardId, CARD_ID);
  assert.ok(entry.rules.length > 0);
  assert.ok(entry.timeline.length >= 3);
  assert.ok(entry.regression.length > 0);
}

function producedScene({
  mighty = 0,
  layeredMighty = 0,
  acceptAccelerate = false,
  energy = 20,
  power = ["Body", "Body", "Body"]
} = {}) {
  const f = productionPlay({
    programs: [program],
    answers: { "cost:play": () => acceptAccelerate },
    build: (builder) => {
      let scene = builder
        .player("A", { energy, power })
        .player("B", { energy: 10, power: ["Body"] });
      for (let index = 0; index < mighty; index++) {
        scene = scene.unit(`mighty-${index}`, {
          owner: "A",
          controller: "A",
          types: ["unit"],
          might: 5,
          location: { type: "base", player: "A" }
        });
      }
      for (let index = 0; index < layeredMighty; index++) {
        scene = scene.unit(`layered-mighty-${index}`, {
          owner: "A",
          controller: "A",
          types: ["unit"],
          might: 4,
          buffs: 1,
          location: { type: "base", player: "A" }
        });
      }
      return scene
        .unit("near-mighty", { owner: "A", controller: "A", types: ["unit"], might: 4 })
        .unit("enemy-mighty", { owner: "B", controller: "B", types: ["unit"], might: 8 })
        .hand("jaull", {
          cardId: CARD_ID,
          name: "Jaull-Fish",
          types: ["unit"],
          energy: 7,
          // ObjectSnapshot.power is the distinct Domain set. The numeric
          // printed Power amount is the trusted catalog projection below.
          power: ["Body"],
          might: 6
        });
    }
  });
  const source = f.kernel.getObject("jaull");
  const described = f.describe("jaull");
  const draft = { ...described, cost: { ...described.cost, printed: PRINTED } };
  let finalized = null;
  const observe = f.engine.pipeline.onEvent;
  f.engine.pipeline.onEvent = (event) => {
    observe?.(event);
    if (event.timingPoint === "chain-item-finalize" && event.object?.ref.id === "jaull") {
      const item = f.engine.items.find((candidate) => candidate.source.ref.id === "jaull");
      if (item?.costPlan !== undefined && item.payment !== undefined) {
        finalized = structuredClone({ plan: item.costPlan, receipt: item.payment });
      }
    }
  };
  return { f, source, described, draft, finalized: () => finalized };
}

function playProduced(scene) {
  scene.f.engine.execute(scene.draft);
  scene.f.settle();
  return scene;
}

test("sfd-103-221 Jaull-Fish validates, is registered, and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-103-221 Jaull-Fish: official evidence and production timelines are pinned", () => {
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, CARD_ID);
  assert.deepEqual(OFFICIAL_EVIDENCE.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_URL
  });
  assert.equal(OFFICIAL_EVIDENCE.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.radianceRulings.applicableToThisCard, false);
  assert.match(OFFICIAL_EVIDENCE.radianceRulings.result, /no Jaull-Fish ruling/);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.applicableToThisCard, false);
  assert.match(OFFICIAL_EVIDENCE.spiritforgedErrata.result, /no Jaull-Fish correction/);
  assert.deepEqual(Object.keys(PRODUCTION_EVIDENCE), ["mightyDiscount", "accelerate"]);
  for (const entry of Object.values(PRODUCTION_EVIDENCE)) assertEvidence(entry);
  assert.ok(PRODUCTION_EVIDENCE.mightyDiscount.rules.includes("356.4.g"));
  assert.ok(PRODUCTION_EVIDENCE.accelerate.rules.includes("805.6.a"));
  assert.match(PRODUCTION_EVIDENCE.accelerate.priorityFocus, /Priority/);
  assert.match(PRODUCTION_EVIDENCE.accelerate.responseWindow, /no post-Finalize response window/i);
  assert.match(PRODUCTION_EVIDENCE.accelerate.responseWindow, /337\.2/);
});

test("sfd-103-221 Jaull-Fish structure: Accelerate keyword and one discounted Mighty count", () => {
  assert.deepEqual(program.abilities.map((ability) => ability.kind), ["keyword", "static"]);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  const discount = program.abilities[1];
  assert.deepEqual(discount.effect, {
    kind: "continuous.cost-modification",
    stage: "discount",
    resource: "energy",
    appliesTo: "self",
    amount: {
      kind: "arithmetic",
      operator: "multiply",
      operands: [
        { kind: "constant", value: 2 },
        {
          kind: "count",
          subject: "units",
          filter: { type: "unit", controller: "self", zone: "board", mightGte: 5 }
        }
      ]
    }
  });
});

test("sfd-103-221 Jaull-Fish: the merged Accelerate expansion preserves cost and paid-entry replacement", () => {
  const source = {
    ref: { id: "jaull", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Jaull-Fish",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 6,
    energy: 7,
    power: ["Body"],
    exhausted: true,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expansion = expandProgram(program, source).expanded;
  assert.deepEqual(expansion.map((ability) => ability.kind), ["static", "replacement"]);
  assert.deepEqual(expansion[0].effect.cost.payments.map((payment) => payment.kind), ["energy", "power"]);
  assert.equal(expansion[0].effect.cost.optional, true);
  assert.equal(expansion[1].replaces.event, "object-enters-board");
  assert.equal(expansion[1].condition.result, "accelerate.accelerate-cost-paid");
  assert.deepEqual(expansion[1].with.map((instruction) => instruction.op), ["effect.ready"]);
});

test("sfd-103-221 Jaull-Fish production: zero Mighty units pay 7; one pays 5", () => {
  const zero = playProduced(producedScene({ mighty: 0 }));
  assert.equal(zero.finalized().plan.total.energy, 7);
  assert.deepEqual(zero.finalized().plan.discounts, []);
  assert.equal(zero.f.kernel.player("A").energy, 13);

  const one = playProduced(producedScene({ mighty: 1 }));
  assert.equal(one.finalized().plan.total.energy, 5);
  assert.deepEqual(one.finalized().plan.discounts.map((discount) => [discount.amount, discount.before, discount.after]), [[2, 7, 5]]);
  assert.equal(one.f.kernel.player("A").energy, 15);
  assert.equal(one.f.kernel.getObject("jaull").zone, "board");
  assert.equal(one.f.kernel.getObject("jaull").exhausted, true);
  assert.equal(one.f.kernel.player("B").energy, 10, "opponent resources are untouched");
});

test("sfd-103-221 Jaull-Fish production: only friendly current-Mighty units count and each adds two", () => {
  const { f, finalized } = playProduced(producedScene({ mighty: 2 }));
  assert.equal(f.might("near-mighty"), 4);
  assert.equal(f.might("enemy-mighty"), 8);
  assert.equal(finalized().plan.total.energy, 3);
  assert.deepEqual(finalized().plan.discounts.map((discount) => discount.amount), [4]);
  assert.equal(f.kernel.player("A").energy, 17);
});

test("sfd-103-221 Jaull-Fish production CR 710: a printed Might 4 unit with one Buff is current Might 5 and counts", () => {
  const { f, finalized } = playProduced(producedScene({ layeredMighty: 1 }));
  assert.equal(f.might("layered-mighty-0"), 5);
  assert.equal(finalized().plan.total.energy, 5);
  assert.deepEqual(finalized().plan.discounts.map((discount) => discount.amount), [2]);
});

test("sfd-103-221 Jaull-Fish production: four Mighty units discount eight from seven and floor Energy at zero", () => {
  const { f, finalized } = playProduced(producedScene({ mighty: 4 }));
  assert.equal(finalized().plan.total.energy, 0);
  assert.deepEqual(finalized().plan.discounts.map((discount) => [discount.amount, discount.before, discount.after]), [[8, 7, 0]]);
  assert.equal(f.kernel.player("A").energy, 20);
});

test("sfd-103-221 Jaull-Fish production golden: paying Accelerate adds its costs and enters ready without object-readied", () => {
  const { f, finalized } = playProduced(producedScene({ mighty: 1, acceptAccelerate: true }));
  const final = finalized();
  assert.deepEqual(final.plan.total, {
    energy: 6,
    power: [
      { amount: 2, allowedDomains: ["Body"] },
      { amount: 1, allowedDomains: ["Body"] }
    ],
    xp: 0,
    actions: []
  });
  assert.deepEqual(final.plan.discounts.map((discount) => discount.amount), [2]);
  assert.deepEqual(final.plan.selectedAdditional.map((cost) => cost.kind), ["accelerate"]);
  assert.deepEqual(final.plan.declinedAdditional, []);
  assert.equal(final.receipt.paid, true);
  assert.deepEqual(final.receipt.total, final.plan.total);
  assert.ok(final.receipt.additional.some((cost) => cost.kind === "accelerate" && cost.paid));
  assert.equal(f.kernel.player("A").energy, 14);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("jaull").zone, "board");
  assert.equal(f.kernel.getObject("jaull").exhausted, false);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "object-readied").length, 0);
  assert.equal(f.requests.filter((request) => request.type === "optional").length, 1);
  assert.equal(f.requests.some((request) => request.type === "select-objects"), false,
    "Accelerate makes a Limited choice and does not target");
  assert.ok(f.engine.trace.some((entry) => entry.step === "pending" && entry.item.startsWith("play:jaull")));
  assert.ok(f.engine.trace.some((entry) => entry.step === "finalized" && entry.item.startsWith("play:jaull")));
  assert.ok(f.engine.trace.some((entry) => entry.step === "resolve-start" && entry.item.startsWith("play:jaull")));
  assert.ok(f.engine.trace.some((entry) => entry.step === "resolved" && entry.item.startsWith("play:jaull")));
  const trace = f.engine.trace;
  assert.deepEqual(trace[0], { step: "priority-granted", player: "A" });
  const finalizedAt = trace.findIndex((entry) => entry.step === "finalized" && entry.item.startsWith("play:jaull"));
  const resolveAt = trace.findIndex((entry) => entry.step === "resolve-start" && entry.item.startsWith("play:jaull"));
  assert.ok(finalizedAt >= 0 && resolveAt > finalizedAt);
  assert.equal(trace.slice(finalizedAt, resolveAt).some((entry) => entry.step === "pass"), false,
    "CR 337.2 resolves the finalized Unit immediately without a Priority pass");
});

test("sfd-103-221 Jaull-Fish production boundary: declining Accelerate still applies the Mighty discount and enters exhausted", () => {
  const { f, finalized } = playProduced(producedScene({ mighty: 1, acceptAccelerate: false }));
  const final = finalized();
  assert.deepEqual(final.plan.selectedAdditional, []);
  assert.equal(final.plan.declinedAdditional.length, 1);
  assert.deepEqual(final.receipt.additional, []);
  assert.equal(final.plan.total.energy, 5);
  assert.deepEqual(final.plan.total.power, [{ amount: 2, allowedDomains: ["Body"] }]);
  assert.equal(f.kernel.player("A").energy, 15);
  assert.deepEqual(f.kernel.player("A").power, ["Body"]);
  assert.equal(f.kernel.getObject("jaull").zone, "board");
  assert.equal(f.kernel.getObject("jaull").exhausted, true);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "object-readied").length, 0);
});

test("sfd-103-221 Jaull-Fish production boundary: failed Accelerate payment rolls back the entire Play", () => {
  const scene = producedScene({ mighty: 1, acceptAccelerate: true, power: ["Body"] });
  const before = scene.f.kernel.snapshot();
  const beforeEvents = scene.f.engine.pipeline.events.length;
  assert.throws(() => scene.f.engine.execute(scene.draft), /insufficient matching Power/);
  assert.deepEqual(scene.f.kernel.snapshot(), before);
  assert.equal(scene.f.kernel.getObject("jaull").zone, "hand");
  assert.equal(scene.f.kernel.getObject("jaull").exhausted, false);
  assert.equal(scene.f.kernel.player("A").energy, 20);
  assert.deepEqual(scene.f.kernel.player("A").power, ["Body"]);
  assert.equal(scene.f.engine.items.length, 0);
  assert.equal(scene.f.engine.pipeline.events.length, beforeEvents,
    "the failed Finalize leaves no Board-entry or ready event");
  assert.equal(scene.finalized(), null, "a failed payment never exposes a successful receipt");
});
