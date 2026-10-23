import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import goldProgram from "../../../dist/cards/sfd/gold.js";
import program from "../../../dist/cards/sfd/wages-of-pain.js";
import { cardProgramsById, cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { getTokenDefinition, TOKEN_DEFINITIONS } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { projectFor } from "../../../../engine-core/dist/projection/v2/index.js";
import { createProgramBinding, withHiddenSource } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { createHiddenState } from "../../../../engine-core/dist/zones/hidden/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";

const CARD_ID = "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c";
const GOLD_ID = "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted.";

// Official evidence checked on 2026-10-23 against the repository's verified
// manifests and captured source snapshots. The Spiritforged errata snapshot
// contains no entry for this canonical card id or SFD-070, so there is no
// applicable source replacement for the captured card text.
const RULE_EVIDENCE = {
  policyId: "official-effect-order-20261019",
  canonicalCardId: CARD_ID,
  core: {
    version: "1.5",
    dated: "2026-10-09",
    effective: "2026-10-16",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  },
  sources: {
    radianceRulings: {
      url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
      published: "2026-10-09",
      effective: "2026-10-16",
      applicableToThisCard: false,
      relevance: "Reviewed: no Wages of Pain, Gold token, or 187.5 ruling changes CR v1.5."
    },
    spiritforgedErrata: {
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/",
      applicableToThisCard: false,
      relevance: "Reviewed: no SFD-070 or Wages of Pain correction."
    },
    spiritforgedRulings: {
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/",
      applicableToThisCard: false,
      relevance: "Reviewed: no card-specific Wages of Pain or Gold replacement."
    }
  },
  rules: {
    hidden: ["811.1.b", "811.1.c", "811.1.d.2", "811.1.d.3", "811.6"],
    action: ["806.1.b", "806.1.c.1"],
    resolution: ["359.3.d", "359.3.e.5", "359.3.e.6"],
    gold: ["163.2.b", "184.1", "185.2.a", "185.2.d", "185.3.a.1", "187.5", "430.1", "430.2", "430.3", "813.1.c.2"]
  },
  timeline: {
    normalPlay: [
      "Play pending", "Finalize locks a Battlefield Unit", "Pay 3 Energy",
      "Resolve the damage instruction before the Gold instruction",
      "Play one Gold token exhausted to its controller's Base", "Move Wages of Pain to Trash"
    ],
    hidden: [
      "Hide pays one [A] without opening a Chain", "The card moves privately facedown to the controlled Battlefield",
      "The next turn grants Reaction and lets the owner play it ignoring its base cost",
      "Finalize chooses only a Unit at the Hidden Battlefield", "Resolve uses top-to-bottom order, then gold",
      "Opponent projection omits the concealed identity"
    ],
    gold: [
      "Created Gold binds its canonical 187.5 program", "Reaction activation plans Exhaust then Kill",
      "Kill moves the token to Trash", "Resolve adds one Universal Power [A]"
    ]
  }
};

const INTERACTION_EVIDENCE = [
  {
    id: "normal-action",
    productionTest: "production boundary: pays 3, damages, creates Gold, but loses exhausted entry",
    rules: ["051", "303.2.a", "337.1", "340.1", "359.3.d", "359.3.e.5", "359.3.e.6", "184.1"],
    priorityFocus: "The turn player has Priority in Main. After Play it becomes Pending; Finalize locks the target and pays three Energy; other players may react while the spell remains on the Chain.",
    responseWindow: "CR 303.2.a supplies no universal ordering; this one investment has one play and resolves after ordinary Pass. Reactions remain legal in the Chain's Execute step.",
    replacement: "No replacement or prevention clause applies to these instructions. A stale target follows 359.3.e.5 and only that damage instruction is ignored.",
    layers: "No continuous effect is needed to choose the target, cost, damage amount, or Gold destination.",
    lki: "The target is rechecked at Resolve. Moving it off a Battlefield makes the locked damage target illegal; the later independent Gold instruction still executes.",
    timeline: ["Play/Pending", "Finalize target and pay 3 Energy", "Resolve deal 3", "Resolve Gold create/Play", "Ready state contradicts 184.1", "spell to Trash"],
    assertions: ["energy becomes 0", "victim damage becomes 3", "base-only damage stays 0", "Gold reaches controller's Base", "Gold ends ready instead of exhausted"]
  },
  {
    id: "hidden",
    productionTest: "Hidden production: [A] Hide is private and opens no Chain",
    rules: ["422.1", "422.2", "811.1.b", "811.1.c", "811.1.c.2", "811.1.d.2", "811.6", "811.6.a"],
    priorityFocus: "Hide requires the turn player's Open State and is a Discretionary Action; it consumes one [A] and does not open a Chain.",
    responseWindow: "CR 811.1.c.2 gives no response window for Hide. The later facedown Play opens a Chain and grants Reaction beginning next turn (811.1.c.3, 811.6).",
    replacement: "No replacement or prevention is involved in Hide or the scope of this card's target choice.",
    layers: "The facedown Reaction grant is turn-scoped permission, not a global numeric Priority. CR 811.6.a keeps it non-public.",
    lki: "The source Battlefield remains the target scope for the spell. The exact target-only probe proves only bf1 Units satisfy 811.1.d.2.",
    timeline: ["Hide/Pending discretionary action", "Pay one [A]", "private facedown state", "opponent projection hides identity", "next turn Reaction", "Finalize target restricted to bf1"],
    assertions: ["chain stays empty after Hide", "Power becomes empty", "private sidecar has one bf1 card", "owner sees identity and opponent does not", "target-only probe scopes target to bf1"]
  },
  {
    id: "hidden-gold-scope-gap",
    productionTest: "Hidden production: Reaction Play applies damage and exposes the Gear-scope gap",
    rules: ["811.1.d.2", "811.1.d.5", "811.2", "359.2.d"],
    priorityFocus: "After the next-turn unlock, the facedown card's Reaction Play is Pending and its source-Battlefield target restriction is finalized before Resolve.",
    responseWindow: "The facedown Play opens the ordinary Chain under 811.1.c.3 and may receive legal Reactions; no special card-defined window exists.",
    replacement: "No replacement applies; the missing behavior is an incorrect destination rewrite rather than a replacement ordering question.",
    layers: "No layer ordering can make a Gold Gear token a Unit. The engine currently applies a Unit-only source-Battlefield restriction to every token.",
    lki: "The source Battlefield is known, but this Gear token must keep its Base destination under its own instruction and 359.2.d.",
    timeline: ["next-turn Hidden Play", "Finalize source scope", "engine rewrites Gold destination to bf1", "non-Deploy Gear is rejected", "atomic rejection preserves facedown source"],
    assertions: ["Binding rejects Hidden Gear token gold", "no Gold token is created", "source remains in the Hidden sidecar", "target Units are untouched"]
  },
  {
    id: "gold-187-5",
    productionTest: "played Gold binds 187.5 and Adds one Universal Power",
    rules: ["135.2.e.5.b", "163.2.b", "187.5", "430.2", "430.2.a", "430.3", "813.1.c.2"],
    priorityFocus: "Gold's Reaction activated Add uses its own reaction permission. The Add finalizes and resolves immediately without passing Priority or Focus (430.2.a).",
    responseWindow: "CR 430.3 permits activation when resources are needed during Pay Costs; the Add itself cannot be reacted to.",
    replacement: "No replacement or prevention applies to the Kill/exhaust cost or Universal Power Add.",
    layers: "Universal Power remains a distinct source identity and is never represented as a named Domain.",
    lki: "The cost consumes the current Gold incarnation into Trash before the Add resolves; no stale source object is reused.",
    timeline: ["describeActivate", "Finalize Exhaust then Kill", "Gold moves to Trash", "Resolve +1 [A]"],
    assertions: ["draft is reaction Add", "pay event precedes exhaust/kill", "Gold is in Trash", "player Power gains one universal"]
  }
];

const play = program.abilities.find((ability) => ability.kind === "play");
const dealInstruction = play.body[0];
const tokenInstruction = play.body[1];
const targetSpec = dealInstruction.targets[0];

// Preserve the shipping judge-required gate while exercising the exact authored
// normal-play body through the real registry, binding, Finalize and Chain.
const admittedProbeProgram = { ...program, status: "executable", judgeReason: undefined };

function wagesScene({ answers = { "target:damaged-unit": ["victim"] }, energy = 3 } = {}) {
  return productionPlay({
    programs: [admittedProbeProgram, goldProgram],
    answers,
    build: (builder) => builder
      .player("A", { energy, power: [] })
      .player("B", { energy: 0, power: [] })
      .object("wages", {
        owner: "A",
        controller: "A",
        cardId: CARD_ID,
        name: "Wages of Pain",
        types: ["spell"],
        zone: "hand",
        energy: 3,
        power: null,
        might: null,
        location: null
      })
      .unit("victim", {
        owner: "B",
        controller: "B",
        name: "Battlefield victim",
        might: 5,
        location: { type: "battlefield", id: "bf1" }
      })
      .unit("base-only", {
        owner: "B",
        controller: "B",
        name: "Base-only unit",
        might: 5,
        location: { type: "base", player: "B" }
      })
  });
}

test("sfd-070-221 Wages of Pain: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-070-221 Wages of Pain: official CR, errata and processing evidence is pinned", () => {
  assert.equal(RULE_EVIDENCE.policyId, "official-effect-order-20261019");
  assert.equal(RULE_EVIDENCE.core.version, "1.5");
  assert.equal(RULE_EVIDENCE.core.dated, "2026-10-09");
  assert.equal(RULE_EVIDENCE.core.effective, "2026-10-16");
  assert.equal(RULE_EVIDENCE.core.url,
    "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf");
  assert.match(RULE_EVIDENCE.core.localSha256, /^[0-9a-f]{64}$/);
  assert.equal(RULE_EVIDENCE.canonicalCardId, program.canonicalCardId);
  assert.equal(RULE_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(RULE_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(RULE_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.equal(RULE_EVIDENCE.sources.spiritforgedRulings.applicableToThisCard, false);
  assert.deepEqual(RULE_EVIDENCE.timeline.normalPlay, [
    "Play pending", "Finalize locks a Battlefield Unit", "Pay 3 Energy",
    "Resolve the damage instruction before the Gold instruction",
    "Play one Gold token exhausted to its controller's Base", "Move Wages of Pain to Trash"
  ]);
  assert.deepEqual(RULE_EVIDENCE.timeline.hidden, [
    "Hide pays one [A] without opening a Chain", "The card moves privately facedown to the controlled Battlefield",
    "The next turn grants Reaction and lets the owner play it ignoring its base cost",
    "Finalize chooses only a Unit at the Hidden Battlefield", "Resolve uses top-to-bottom order, then gold",
    "Opponent projection omits the concealed identity"
  ]);
  assert.deepEqual(RULE_EVIDENCE.timeline.gold, [
    "Created Gold binds its canonical 187.5 program", "Reaction activation plans Exhaust then Kill",
    "Kill moves the token to Trash", "Resolve adds one Universal Power [A]"
  ]);
  assert.deepEqual(INTERACTION_EVIDENCE.map((entry) => entry.id), [
    "normal-action", "hidden", "hidden-gold-scope-gap", "gold-187-5"
  ]);
  for (const interaction of INTERACTION_EVIDENCE) {
    assert.ok(interaction.productionTest.length > 0);
    assert.ok(interaction.rules.length > 0);
    assert.ok(interaction.timeline.length > 0);
    assert.ok(interaction.assertions.length > 0);
  }
});

test("sfd-070-221 Wages of Pain: names the two exact remaining production gaps", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /effect\.token\.ts:343-371/);
  assert.match(program.judgeReason, /chain\/engine\.ts:1593-1595/);
  assert.match(program.judgeReason, /programs\/play\.ts:126-165/);
  assert.match(program.judgeReason, /811\.1\.d\.5/);
  assert.match(program.judgeReason, /Gold gear token/);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(goldProgram.status, "executable");
  assert.equal(goldProgram.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-070-221 Wages of Pain structure: Hidden + Action keywords, damage then exhausted Gold", () => {
  const keywords = program.abilities.filter((ability) => ability.kind === "keyword");
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" }
  ]);

  assert.equal(play.body.length, 2);
  assert.equal(dealInstruction.id, "deal-3");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 3 });
  assert.equal(dealInstruction.linkedTo, undefined);

  assert.deepEqual(dealInstruction.targets, [{
    id: "damaged-unit",
    filter: { type: "unit", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  }]);

  assert.equal(tokenInstruction.id, "play-gold-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(tokenInstruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(tokenInstruction.linkedTo, undefined);
  for (const instruction of [dealInstruction, tokenInstruction]) {
    assert.equal(instructionDefinitionsById.has(instruction.op), true, instruction.op);
  }
});

test("sfd-070-221 Wages of Pain: GameAction create-token carries the exhausted entry stipulation", () => {
  const kernel = world().player("A").unit("source").build();
  const actions = [];
  const context = {
    ...kernel.clone({ sourceSnapshot: kernel.getObject("source"), controller: "A" }),
    evaluate: (expression) => expression.value,
    link: (key, value) => kernel.link(key, value),
    query: (filter) => kernel.query(filter),
    object: (ref) => {
      const object = kernel.objects.find((candidate) =>
        candidate.ref.id === ref.id && candidate.ref.zoneEntryId === ref.zoneEntryId);
      return object ?? null;
    },
    choose: (request) => { throw new AwaitChoice(request); },
    perform: (action) => {
      actions.push(structuredClone(action));
      return kernel.perform(action);
    }
  };
  const result = token.execute(context, {
    token: { kind: "constant", value: "recruit" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "create" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    entersExhausted: { kind: "constant", value: true }
  });
  assert.equal(result.status, "executed");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "create-token");
  assert.equal(actions[0].token.exhausted, true);
  assert.equal(kernel.getObject("token-1").exhausted, true);
  assert.equal(actions[0].token.energy, null);
  assert.equal(actions[0].token.power, null);
});

test("sfd-070-221 Wages of Pain golden execution: the damage half deals 3 to the locked battlefield unit", () => {
  const kernel = world().unit("battlefield-unit").build();
  const locked = kernel.ref("battlefield-unit");
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 3);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
  assert.equal(run.result.linkedValues.dealt, 3);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("sfd-070-221 Wages of Pain golden execution: a stale battlefield target is ignored, not redirected", () => {
  const kernel = world().unit("battlefield-unit").build();
  const stale = kernel.ref("battlefield-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("sfd-070-221 Wages of Pain production boundary: pays 3, damages, creates Gold, but loses exhausted entry", () => {
  const f = wagesScene();
  const draft = f.describe("wages");
  assert.equal(draft.kind, "spell");
  assert.equal(draft.speed, "action");

  f.engine.execute(draft);
  f.settle();

  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("victim").damage, 3);
  assert.equal(f.kernel.getObject("base-only").damage, 0);
  assert.equal(f.kernel.getObject("wages").zone, "trash");
  assert.equal(f.targetRequests().length, 1);
  assert.deepEqual(f.targetRequests()[0].options, [f.kernel.ref("victim")]);

  const [gold] = f.kernel.objects.filter((object) => object.isToken && object.cardId === GOLD_ID);
  assert.ok(gold, "Wages of Pain creates and plays its Gold carrier");
  assert.equal(f.kernel.events.some((event) => event.action === "ready"), true,
    "ChainEngine applies its Gear-entry ready commit");
  const receipt = f.kernel.linked("play-gold-token.goldToken");
  assert.equal(receipt.amount, 1);
  assert.equal(receipt.createdAmount, 1);
  assert.deepEqual(receipt.objects, [{ id: gold.ref.id, zoneEntryId: 1 }]);
  assert.deepEqual(receipt.createdObjects, [{ id: gold.ref.id, zoneEntryId: 1 }]);
  assert.equal(receipt.objectsComplete, true);
  assert.equal(receipt.blockedReason, undefined);
  assert.equal(gold.zone, "board");
  assert.deepEqual(gold.location, { type: "base", player: "A" });
  assert.equal(f.kernel.getObject(gold.ref.id).exhausted, false);
  assert.equal(gold.energy, null);
  assert.equal(gold.power, null);
  assert.equal(f.binding.activationAbilities(gold).length, 1,
    "the created token is bound to the canonical Gold command program");
  assert.deepEqual(
    f.kernel.events.map((event) => event.action).filter(Boolean),
    ["move-zone", "pay", "damage", "create-token", "move-zone", "pay", "ready", "move-zone"]
  );
  const damageEvent = f.kernel.events.find((event) => event.action === "damage");
  assert.equal(damageEvent.reason, "damage");
  assert.equal(damageEvent.seq, 3);
  const damageIndex = f.kernel.events.indexOf(damageEvent);
  const goldCreationIndex = f.kernel.events.findIndex((event) => event.action === "create-token");
  assert.ok(damageIndex >= 0 && damageIndex < goldCreationIndex,
    "the damage instruction resolves before the Gold instruction (top-to-bottom)");
  const creation = f.kernel.events.find((event) => event.action === "create-token");
  assert.equal(creation.objectId, gold.ref.id);
  assert.equal(draft.cost.cost.kind, "printed");
  assert.equal(f.engine.trace.some((entry) => entry.step === "resolved"), true);
  assert.equal(f.engine.trace.some((entry) => entry.step === "priority-granted"), true);
});

test("sfd-070-221 Wages of Pain production boundary: a target moved before Resolve is rechecked and ignored", () => {
  const f = wagesScene();
  f.engine.execute(f.describe("wages"));
  const moved = f.kernel.perform({
    type: "move-location",
    object: f.kernel.ref("victim"),
    to: { type: "base", player: "B" }
  });
  assert.equal(moved.status, "done");
  f.settle();

  assert.equal(f.kernel.getObject("victim").damage, 0);
  assert.equal(f.kernel.getObject("wages").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 0);
  // The target was locked at Finalize. Moving it off the Battlefield before
  // Resolve makes the damage instruction mistarget; no damage result/link is
  // written at all, and no fallback target is selected.
  assert.equal(f.kernel.linked("deal-3"), undefined);
  const receipt = f.kernel.linked("play-gold-token.goldToken");
  assert.equal(receipt.amount, 1);
  assert.equal(receipt.blockedReason, undefined);
  const [gold] = f.kernel.objects.filter((object) => object.isToken && object.cardId === GOLD_ID);
  assert.ok(gold, "the independent Gold instruction still executes after damage mistargets");
  assert.equal(f.kernel.getObject(gold.ref.id).exhausted, false);
  assert.equal(f.kernel.getObject("base-only").damage, 0);
});

test("sfd-070-221 Wages of Pain production boundary: no battlefield target fails before costs or movement", () => {
  const f = productionPlay({
    programs: [admittedProbeProgram, goldProgram],
    build: (builder) => builder
      .player("A", { energy: 3 })
      .player("B")
      .object("wages", {
        owner: "A", controller: "A", cardId: CARD_ID, name: "Wages of Pain",
        types: ["spell"], zone: "hand", energy: 3, power: null, might: null
      })
      .unit("base-only", {
        owner: "B", controller: "B", name: "Base-only unit", might: 5,
        location: { type: "base", player: "B" }
      })
  });
  const before = f.kernel.snapshot();
  const beforeEvents = structuredClone(f.kernel.events);
  assert.throws(
    () => f.play("wages"),
    (error) => error.name === "TargetSelectionError" && error.code === "no-legal-targets"
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.events, beforeEvents);
  assert.equal(f.kernel.getObject("wages").zone, "hand");
});

test("sfd-070-221 Wages of Pain production boundary: insufficient Energy is rejected before the spell starts", () => {
  const f = wagesScene({ energy: 1 });
  const before = f.kernel.snapshot();
  const beforeEvents = structuredClone(f.kernel.events);
  assert.throws(
    () => f.play("wages"),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.events, beforeEvents);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.equal(f.kernel.getObject("wages").zone, "hand");
});

test("sfd-070-221 Wages of Pain: Gold is defined as an executable canonical token program", () => {
  const gold = TOKEN_DEFINITIONS.find((definition) => definition.id === "gold");
  assert.ok(gold);
  assert.equal(getTokenDefinition("gold"), gold);
  assert.deepEqual(gold.spec, {
    cardId: GOLD_ID,
    name: "Gold",
    types: ["gear"],
    tags: [],
    keywords: [],
    might: null,
    energy: null,
    power: null
  });
  assert.deepEqual(gold.ruleRefs, ["187.5", "185.3.a", "149.1", "359.2.d"]);
  assert.equal(gold.defaultEntry, "ready");
  assert.equal(gold.abilityBinding, "canonical-card-program");
  assert.equal(gold.blockedReason, undefined);

  const kernel = world().build();
  const actions = [];
  const choose = (request) => { throw new AwaitChoice(request); };
  const context = {
    ...kernel.clone({ sourceSnapshot: kernel.getObject("source"), controller: "A" }),
    evaluate: (expression) => expression.value,
    link: (key, value) => kernel.link(key, value),
    query: (filter) => kernel.query(filter),
    object: (ref) => {
      const object = kernel.objects.find((candidate) =>
        candidate.ref.id === ref.id && candidate.ref.zoneEntryId === ref.zoneEntryId);
      return object ?? null;
    },
    choose,
    perform: (action) => {
      actions.push(structuredClone(action));
      return kernel.perform(action);
    }
  };
  const result = token.execute(context, tokenInstruction.args);
  assert.equal(result.status, "executed");
  assert.equal(kernel.linked("goldToken").blockedReason, undefined);
  assert.equal(kernel.linked("goldToken").createdAmount, 1);
  assert.deepEqual(actions.map((action) => action.type), ["create-token", "play"]);
  const [goldToken] = kernel.objects.filter((object) => object.isToken && object.cardId === GOLD_ID);
  assert.ok(goldToken);
  assert.equal(goldToken.exhausted, true);
});

test("sfd-070-221 Wages of Pain: played Gold binds 187.5 and Adds one Universal Power", () => {
  assert.equal(goldProgram.canonicalCardId, GOLD_ID);
  assert.equal(goldProgram.status, "executable");
  const [goldAbility] = goldProgram.abilities;
  assert.equal(goldAbility.kind, "activated");
  assert.equal(goldAbility.timing, "reaction");
  assert.deepEqual(
    goldAbility.cost.payments.map((payment) => [payment.kind, payment.object]),
    [["exhaust", "self"], ["kill", "self"]]
  );
  assert.equal(goldAbility.body.length, 1);
  assert.equal(goldAbility.body[0].op, "effect.resources");
  assert.deepEqual(goldAbility.body[0].args, {
    power: { kind: "constant", value: ["universal"] }
  });

  const f = productionPlay({
    programs: [goldProgram],
    build: (builder) => builder
      .player("A", { energy: 20, power: ["Mind"] })
      .player("B")
      .object("gold-token", {
        owner: "A",
        controller: "A",
        cardId: GOLD_ID,
        name: "Gold",
        isToken: true,
        types: ["gear"],
        tags: ["Token"],
        zone: "board",
        location: { type: "base", player: "A" },
        energy: null,
        power: null,
        might: null,
        exhausted: false
      })
  });
  const source = f.kernel.getObject("gold-token");
  const draft = f.binding.describeActivate(source, "A", 0);
  assert.equal(draft.kind, "add");
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(
    draft.cost.cost.payments.map((payment) => [payment.kind, payment.object]),
    [["exhaust", "self"], ["kill", "self"]]
  );
  f.engine.execute(draft);
  f.settle();

  assert.deepEqual(f.kernel.events.map((event) => event.action).filter(Boolean), [
    "pay", "exhaust", "kill", "gain-power"
  ]);
  assert.equal(f.engine.trace.some((entry) => entry.step === "priority-granted" && entry.item === draft.id), false,
    "an Add finalizes and resolves without passing Priority or Focus");
  assert.equal(f.kernel.getObject("gold-token").zone, "trash");
  assert.equal(f.kernel.getObject("gold-token").exhausted, true);
  assert.deepEqual(f.kernel.player("A").power, ["Mind", "universal"]);
  assert.equal(f.kernel.player("A").energy, 20);
});

const HIDDEN_BATTLEFIELD = { type: "battlefield", id: "bf1" };

function hiddenWagesScene({ power = ["Mind"], energy = 0 } = {}) {
  const builder = world()
    .player("A", { energy, power: [] })
    .player("B")
    .deck(["a1", "a2", "a3", "a4"], { owner: "A" })
    .deck(["b1", "b2", "b3", "b4"], { owner: "B" })
    .rune(["a-rune"], { owner: "A" })
    .rune(["b-rune"], { owner: "B" })
    .object("bf1", {
      owner: "A", controller: "A", types: ["battlefield"], zone: "board",
      location: HIDDEN_BATTLEFIELD, might: null, energy: null, power: null
    })
    .object("bf2", {
      owner: "B", controller: null, types: ["battlefield"], zone: "board",
      location: { type: "battlefield", id: "bf2" }, might: null, energy: null, power: null
    })
    .hand("wages", {
      owner: "A", controller: "A", cardId: CARD_ID, name: "Wages of Pain",
      types: ["spell"], energy: 3, power: null, might: null, location: null
    })
    .unit("hidden-guard", {
      owner: "A", controller: "A", name: "Friendly battlefield unit", might: 10,
      location: HIDDEN_BATTLEFIELD
    })
    .unit("remote-victim", {
      owner: "B", controller: "B", name: "Remote battlefield victim", might: 5,
      location: { type: "base", player: "B" }
    })
    .unit("base-victim", {
      owner: "B", controller: "B", name: "Base victim", might: 5,
      location: { type: "base", player: "B" }
    });
  const kernel = builder.build();
  const requests = [];
  const choose = (request) => {
    requests.push(structuredClone(request));
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    if (request.type === "select-objects" && request.id.startsWith("hidden-target:")) {
      return request.options.filter((option) => option.id === "hidden-victim");
    }
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [admittedProbeProgram, goldProgram] });
  const flow = new TurnFlow({
    host: { ...host, player: (id) => kernel.player(id) },
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: "A" }, { id: "bf2", controller: null }],
    victoryScore: 20,
    describePlay: binding.describePlay,
    hiddenState: createHiddenState([
      { battlefieldId: "bf1", controller: "A" }, { battlefieldId: "bf2", controller: null }
    ], 0)
  });
  binding.attachLifecycle(flow.chain, (error) => { throw error; });
  flow.start();
  for (let guard = 0; flow.phase !== "main"; guard++) {
    assert.ok(guard < 100, "TurnFlow must reach the Main Phase");
    flow.advance();
  }
  if (power.length) flow.chain.commit({ type: "gain-power", player: "A", power });
  const settle = () => {
    for (let guard = 0; guard < 30 && flow.chain.items.length; guard++) flow.pass(flow.chain.priority);
    for (let guard = 0; guard < 30 && flow.chain.focus !== null; guard++) flow.pass(flow.chain.focus);
    assert.equal(flow.chain.items.length, 0, "TurnFlow Chain must settle");
  };
  const hide = () => flow.hide({
    type: "hide",
    object: kernel.ref("wages"),
    player: "A",
    location: HIDDEN_BATTLEFIELD
  });
  const nextTurn = () => {
    settle();
    const hiddenTurn = flow.chain.pipeline.clock.turn;
    flow.pass("A");
    flow.pass("B");
    settle();
    assert.ok(flow.chain.pipeline.clock.turn > hiddenTurn);
    assert.equal(flow.turnPlayer, "A");
  };
  const concealed = () => flow.objects().find((object) => object.ref.id === "wages");
  const playHidden = () => {
    const source = kernel.getObject("wages");
    return withHiddenSource(flow, () => binding.describePlay(
      { type: "play", object: source.ref, player: "A" }, source
    ));
  };
  const addHiddenVictim = () => kernel.addObject({
    ...kernel.getObject("hidden-guard"),
    ref: { id: "hidden-victim", zoneEntryId: 1 }, cardId: "card:hidden-victim",
    owner: "B", controller: "B",
    name: "Hidden battlefield victim", types: ["unit"], tags: [], keywords: [],
    might: 5, energy: null, power: null, damage: 0, exhausted: false,
    location: HIDDEN_BATTLEFIELD, zone: "board", faceDown: false, isToken: false
  }, "board");
  const targetOnlyDraft = () => {
    const targetOnlyProgram = {
      ...program,
      status: "executable",
      judgeReason: undefined,
      abilities: program.abilities.map((ability) => ability.kind === "play"
        ? { ...ability, body: [ability.body[0]] }
        : ability)
    };
    const targetOnlyBinding = createProgramBinding({ cardPrograms: [targetOnlyProgram, goldProgram] });
    const hiddenCard = flow.hidden().zones.bf1.cards[0];
    const source = {
      ...kernel.getObject(hiddenCard.ref.id), ref: hiddenCard.ref, zone: "board", faceDown: true,
      location: HIDDEN_BATTLEFIELD, facedownLocation: HIDDEN_BATTLEFIELD
    };
    return withHiddenSource(flow, () => targetOnlyBinding.describePlay(
      { type: "play", object: hiddenCard.ref, player: "A" }, source
    ));
  };
  return { kernel, flow, binding, requests, settle, hide, nextTurn, concealed, playHidden, addHiddenVictim, targetOnlyDraft };
}

test("sfd-070-221 Wages of Pain Hidden production: [A] Hide is private and opens no Chain", () => {
  const f = hiddenWagesScene();
  const beforeTurn = f.flow.turnPlayer;
  const outcome = f.hide();
  assert.equal(outcome.status, "done");
  assert.deepEqual(outcome.plan.total.power, [{
    amount: 1,
    allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
  }]);
  assert.equal(outcome.costReceipt.paid, true);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(f.flow.chain.turnState, "neutral-open");
  assert.equal(f.flow.turnPlayer, beforeTurn);
  assert.equal(f.concealed().faceDown, true);
  assert.deepEqual(f.concealed().facedownLocation, HIDDEN_BATTLEFIELD);
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
  const authoritative = f.flow.chain.pipeline.events.find((event) => event.timingPoint === "card-hidden");
  assert.equal(authoritative.object.cardId, CARD_ID);
  assert.equal(authoritative.details.battlefieldId, "bf1");

  const face = f.concealed();
  const projectionState = {
    players: {
      A: { id: "A", facedown: [face] },
      B: { id: "B" }
    },
    objects: [face]
  };
  // The authoritative hidden event retains the private identity; projection
  // gives identity only to this controller while opponents see face-down data.
  assert.equal(projectFor(projectionState, "A").objects.find((object) => object.faceDown).visibility, "identity");
  const opponentFace = projectFor(projectionState, "B").objects.find((object) => object.faceDown);
  assert.equal(opponentFace.visibility, "face-down");
  assert.equal(opponentFace.cardId, undefined);
  assert.equal(opponentFace.name, undefined);
});

test("sfd-070-221 Wages of Pain Hidden production: Reaction Play applies damage and exposes the Gear-scope gap", () => {
  const f = hiddenWagesScene();
  f.hide();
  // Hidden is locked on the turn it is concealed; the full production call for
  // that same card is covered by engine-core/test/engine-gaps/m1-hidden.test.mjs.
  assert.equal(f.flow.hidden().turn, f.flow.hidden().zones.bf1.cards[0].hiddenTurn);
  f.nextTurn();
  f.addHiddenVictim();
  f.settle();
  assert.throws(
    () => f.playHidden(),
    (error) => error.name === "ProgramBindingError" && error.code === "judge-required" &&
      /Hidden Gear token gold cannot be played directly to a Battlefield/.test(error.message)
  );
  // The source-target rewrite itself is tested by the previous operation just
  // before the engine's Gear destination rejection. This card remains facedown
  // and unchanged because the failed Play is atomic.
  assert.equal(f.kernel.getObject("wages").zone, "board");
  assert.equal(f.concealed().faceDown, true);
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
  assert.equal(f.kernel.getObject("hidden-victim").damage, 0);
  assert.equal(f.kernel.objects.some((object) => object.isToken && object.cardId === GOLD_ID), false);
  const trace = f.flow.chain.trace;
  assert.equal(trace.some((entry) => entry.step === "priority-granted"), true,
    "the ordinary Chain still grants Priority at its legal response window");
});

test("sfd-070-221 Wages of Pain Hidden production: 811.1.d.2 scopes the target to bf1", () => {
  const f = hiddenWagesScene();
  f.hide();
  f.nextTurn();
  f.addHiddenVictim();
  // A temporary copy of the exact IR without the Gold sentence isolates the
  // independently implemented 811.1.d.2 target scope. It is never published.
  const draft = f.targetOnlyDraft();
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(draft.targets.map((target) => target.requirement.location), [HIDDEN_BATTLEFIELD]);
  assert.deepEqual(draft.cost.baseModifications, [{ kind: "ignore-base", ignore: "resources" }]);
  assert.equal(f.kernel.getObject("remote-victim").damage, 0);
  assert.equal(f.kernel.getObject("wages").zone, "board");
  assert.equal(f.flow.hidden().zones.bf1.cards.length, 1);
});
