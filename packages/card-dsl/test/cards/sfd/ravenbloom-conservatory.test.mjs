import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ravenbloom-conservatory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82.
// The real Combat designation emits defense-declared once under
// 383.4.f.2/466.2, and "here" resolves against this Battlefield incarnation.
// Its mandatory trigger is Pending, Finalize locks the top Main Deck card under
// 355.5, both players receive the ordinary Priority window, and Resolve under
// 359.3.d reveals it (425). A Spell goes to hand; any other card recycles under
// 417.1.a. The two branches are exclusive card-text conditions, not Priority.
// The interaction occurs in a real Combat Showdown, whose existing Focus and
// Priority are consumed normally. Resolve reads the revealed live card; no
// departed-object LKI is used.

const CANONICAL = "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82";
const SOURCE_TEXT =
  "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.";

// Official evidence for the production path below:
// - Core Rules v1.5 (updated 2026-10-09), especially 053.3, 323.2,
//   383.4.f.2, 425.1/425.2.a, and 466.2:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Official Radiance rules update, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// Source catalog: sfd-215-221.
//
// Timeline: a real effect Move opens Combat -> CombatFlow establishes roles
// and emits one defense-declared batch -> ProgramBinding lifecycle registers
// the original here/self trigger -> EventPipeline compares the event
// battlefield with this card's live location -> ChainEngine Finalize locks the
// real deck top -> the original linked reveal/type condition executes exactly
// one branch.

const [ability] = program.abilities;
const [revealInstruction, toHand, recycle] = ability.body;
const field = id => ({ type: "battlefield", id });

function cardSnapshot(id, values = {}) {
  const owner = values.owner ?? "A";
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: values.cardId ?? `card:${id}`,
    name: values.name ?? id,
    types: values.types ?? ["unit"],
    tags: values.tags ?? [],
    keywords: values.keywords ?? [],
    owner,
    controller: values.controller ?? owner,
    zone: values.zone ?? "deck",
    location: values.location ?? null,
    combatRole: null,
    might: values.might ?? 1,
    energy: values.energy ?? null,
    power: values.power ?? null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
}

function deckIds(player, count = 8) {
  return Array.from({ length: count }, (_, index) => `${player}:deck:${index}`);
}

function runeIds(player, count = 8) {
  return Array.from({ length: count }, (_, index) => `${player}:rune:${index}`);
}

function hostFor(kernel, choose) {
  return createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
}

function settle(f, budget = 30) {
  let guard = 0;
  while (f.flow.chain.items.length) {
    assert.ok(++guard < budget, "the production Chain must settle");
    f.flow.pass(f.flow.chain.priority);
  }
}

function productionFixture({ topTypes = ["spell"], targetField = "bf1" } = {}) {
  const kernel = world().player("A").player("B")
    .battlefield("conservatory", {
      cardId: CANONICAL,
      types: ["battlefield"],
      controller: "B",
      location: { type: "base", player: "B" },
      energy: null,
      power: null
    })
    .unit("attacker", {
      owner: "A",
      controller: "A",
      might: 4,
      location: { type: "base", player: "A" }
    })
    .unit("defender", {
      owner: "B",
      controller: "B",
      might: 3,
      location: field(targetField)
    })
    .deck(deckIds("A"), { owner: "A" })
    .rune(runeIds("A"), { owner: "A" })
    .deck(deckIds("B"), { owner: "B" })
    .rune(runeIds("B"), { owner: "B" })
    .build();
  kernel.addObject(cardSnapshot("top-card", {
    owner: "B",
    types: topTypes,
    cardId: "card:top",
    name: "Top Card"
  }), "deck");

  const choices = [];
  const choose = request => {
    choices.push(request);
    if (request.type === "mode") return request.options[0];
    if (request.type === "order") return [...request.options];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = hostFor(kernel, choose);
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [
      { id: "bf1", controller: "B" },
      { id: "bf2", controller: targetField === "bf2" ? "B" : null }
    ]
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const errors = [];
  binding.attachLifecycle(flow.chain, error => errors.push(error));
  // The real Board-to-Battlefield entry installs the trigger through lifecycle.
  assert.equal(flow.chain.commit({
    type: "move-zone",
    object: kernel.ref("conservatory"),
    to: "battlefield",
    location: field("bf1")
  }).status, "done");
  assert.equal(flow.chain.pipeline.checkpoint().triggers.has("program:conservatory:2:0"), true);
  flow.start();
  for (let guard = 0; flow.phase !== "main" && guard < 100; guard++) flow.advance();
  assert.equal(flow.phase, "main");
  return { kernel, flow, choices, errors };
}

function attackAt(f, targetField) {
  f.flow.execute({
    id: `attack-${targetField}`,
    controller: "A",
    source: f.kernel.getObject("attacker"),
    kind: "activated",
    speed: "normal",
    body: [{
      id: `move-${targetField}`,
      op: "effect.move",
      args: { to: { kind: "constant", value: field(targetField) } }
    }]
  });
  // Resolve the move, close its Chain, then let TurnFlow advance Combat and
  // Finalize/Resolve the Defend Trigger through ordinary Priority passes.
  f.flow.pass(f.flow.chain.priority);
  f.flow.pass(f.flow.chain.priority);
  settle(f);
}

test("sfd-215-221 Ravenbloom Conservatory: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-215-221 Ravenbloom Conservatory: identity, executable status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-215-221 Ravenbloom Conservatory: printed Defend Effect has a supported here/self binding", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "defense-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "defense-declared",
    here: true,
    player: "self"
  });
  assert.equal(ability.optional, false);
  assert.equal(validateTriggerSpec(ability.trigger).ok, true);
  assert.deepEqual(
    translateTriggerFilter(ability.trigger.filter, "conservatory", "defense-declared"),
    { event: "defense-declared", here: true, player: "self" }
  );
});

test("sfd-215-221 Ravenbloom Conservatory: reveal, type test, hand branch, and recycle branch stay literal", () => {
  assert.deepEqual(ability.body.map(instruction => [instruction.id, instruction.op]), [
    ["ravenbloom.reveal", "effect.reveal"],
    ["ravenbloom.to-hand", "effect.zone"],
    ["ravenbloom.recycle", "effect.recycle"]
  ]);
  assert.deepEqual(revealInstruction.args.pick, {
    kind: "constant",
    value: "ravenbloom.revealed-card"
  });
  assert.deepEqual(revealInstruction.picks, [{
    id: "ravenbloom.revealed-card",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
  }]);
  assert.deepEqual(toHand.picks, [{
    id: "ravenbloom.revealed-hand",
    options: [],
    ordered: true,
    selection: "all",
    linked: { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
  }]);
  const spellMember = {
    kind: "compare",
    left: { kind: "constant", value: "spell" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "ravenbloom.reveal" },
      property: "types"
    }
  };
  assert.deepEqual(toHand.condition, spellMember);
  assert.deepEqual(recycle.condition, { kind: "not", condition: spellMember });
  assert.deepEqual(toHand.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "ravenbloom.reveal",
    key: "revealed"
  });
});

test("sfd-215-221 Ravenbloom Conservatory production golden: defended here, revealed spell goes to hand", () => {
  const f = productionFixture({ topTypes: ["spell"] });
  attackAt(f, "bf1");

  const defenses = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "defense-declared");
  assert.deepEqual(defenses.map(event => [event.object.ref.id, event.player, event.details.battlefieldId]), [
    ["defender", "B", "bf1"]
  ]);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 1);
  assert.deepEqual(f.kernel.linked("ravenbloom.reveal.revealed").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(f.kernel.linked("ravenbloom.reveal.revealedCount"), 1);
  assert.deepEqual(f.kernel.zone("B", "hand").map(ref => ref.id), ["top-card"]);
  assert.equal(f.kernel.zone("B", "deck").some(ref => ref.id === "top-card"), false);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-recycled").length, 0);
  assert.deepEqual(f.choices, []);
  assert.deepEqual(f.errors, []);
});

test("sfd-215-221 Ravenbloom Conservatory production golden: a revealed non-spell is recycled instead", () => {
  const f = productionFixture({ topTypes: ["unit"] });
  attackAt(f, "bf1");

  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 1);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-recycled").length, 1);
  assert.deepEqual(f.kernel.linked("ravenbloom.reveal.revealed").map(ref => ref.id), ["top-card"]);
  assert.equal(f.kernel.zone("B", "hand").some(ref => ref.id === "top-card"), false);
  assert.equal(f.kernel.zone("B", "deck").at(-1).id, "top-card");
  assert.deepEqual(f.choices, []);
  assert.deepEqual(f.errors, []);
});

test("sfd-215-221 Ravenbloom Conservatory production negative: defending at another Battlefield does not trigger here", () => {
  const f = productionFixture({ topTypes: ["spell"], targetField: "bf2" });
  attackAt(f, "bf2");

  const defenses = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "defense-declared");
  assert.deepEqual(defenses.map(event => [event.object.ref.id, event.player, event.details.battlefieldId]), [
    ["defender", "B", "bf2"]
  ]);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 0);
  assert.equal(f.kernel.zone("B", "hand").some(ref => ref.id === "top-card"), false);
  assert.equal(f.kernel.zone("B", "deck").some(ref => ref.id === "top-card"), true);
  assert.deepEqual(f.choices, []);
  assert.deepEqual(f.errors, []);
});
