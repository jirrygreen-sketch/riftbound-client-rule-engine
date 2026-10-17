// Golden test for Shurelya's Requiem (sfd-192-221).
//
// Two merge-verified halves run for real: the card-played trigger body
// (effect.ready with the `{ kind: "query" }` set shape: ready your units, leave
// the opponent's) and the Equip expansion's attach body, both through the
// production interpreter adapter. Unique and the Equip printed-cost adapter
// remain judged gaps; [A] payment and trigger registration are supported.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/shurelyas-requiem.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan, payCostPlan, DUEL_DOMAINS } from "../../../../engine-core/dist/cost/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-d0752a11e22119fd9d027e757d45f90d57f3fb9dd7fb884daa19a97b0566dad3";
const SOURCE_TEXT =
  "[Unique] (Your deck can have only 1 card with this name.)\n" +
  "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)\n" +
  "When you play this, ready your units.";
const HOST = { canonicalCardId: CARD_ID };

const [unique, equip, playTrigger] = program.abilities;
const [readyUnits] = playTrigger.body;
const activation = keywordDefinitionsById.get("Equip").expand({ host: HOST })[0];

const requiemWorld = (resources = {}) => world()
  .player("A", resources)
  .object("shurelyas-requiem", {
    name: "Shurelya's Requiem",
    cardId: CARD_ID,
    types: ["gear"],
    tags: ["Ornn", "Equipment", "Signature"],
    keywords: [{ id: "Unique" }, { id: "Equip", value: 1 }],
    zone: "board",
    location: { type: "base", player: "A" },
    energy: 4,
    power: null,
    might: 2,
    controller: "A",
    owner: "A"
  })
  .unit("unit-a1", { exhausted: true, location: { type: "base", player: "A" } })
  .unit("unit-a2", {
    exhausted: true,
    location: { type: "battlefield", id: "battlefield-1" }
  })
  .unit("unit-b1", {
    exhausted: true,
    controller: "B",
    owner: "B",
    location: { type: "battlefield", id: "battlefield-1" }
  })
  .build();

/** The Gear as it sits on the Board; the printed costs are never coerced. */
const hostSnapshot = () => ({
  ref: { id: "shurelyas-requiem", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Shurelya's Requiem",
  types: ["gear"],
  tags: ["Ornn", "Equipment", "Signature"],
  keywords: [{ id: "Unique" }, { id: "Equip", value: 1 }],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "base", player: "A" },
  might: 2,
  energy: 4,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

/**
 * Execute the trigger body with the production filter matcher so the contract's
 * `controller: "self"` placeholder is bound to the ability controller, exactly
 * like the chain's own context does.
 */
const runReadyUnits = () => {
  const kernel = requiemWorld();
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("shurelyas-requiem"),
    controller: "A",
    query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
      Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "self" ? "A" : value])),
      object
    ))
  });
  return { kernel, outcome: resolveChainBody(playTrigger.body, bound) };
};

const runEquipBody = (chooseTarget) => {
  const kernel = requiemWorld();
  const bound = bindResolveContext(kernel, {
    // ResolveContext.source is the source snapshot (effect.attach reads its .ref).
    source: kernel.getObject("shurelyas-requiem"),
    sourceSnapshot: kernel.getObject("shurelyas-requiem"),
    controller: "A",
    query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
      Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "self" ? "A" : value])),
      object
    ))
  });
  kernel.setTargets("equip-target", chooseTarget ? [chooseTarget(kernel)] : []);
  return { kernel, outcome: resolveChainBody(activation.body, bound) };
};

test("sfd-192-221 Shurelya's Requiem: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-192-221 Shurelya's Requiem: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);

  assert.match(program.judgeReason, /Unique/);
  assert.match(program.judgeReason, /continuous\.deck/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /Equip 支付种类/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /TriggerRegistration/);
});

test("sfd-192-221 Shurelya's Requiem: Unique, rainbow Equip and a card-played play effect", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(unique, { kind: "keyword", keyword: "unique" });
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "rainbow");

  // 383.4.a.1: "When you play this" is the card's own Play Effect, filtered by
  // its canonical identity (v1.5 383.4.a.2 places it on the Chain after entry).
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: CARD_ID }
  });
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.optional, false);

  // 355.10.d: "your units" is a programmatic set, so no TargetSpec is declared;
  // 416.1/416.1.c: the Ready action runs through effect.ready.
  assert.equal(playTrigger.body.length, 1);
  assert.equal(readyUnits.id, "shurelyas-requiem.ready-units");
  assert.equal(readyUnits.op, "effect.ready");
  assert.deepEqual(readyUnits.args.objects, {
    kind: "constant",
    value: { kind: "query", filter: { type: "unit", controller: "self", zone: "board" } }
  });
  assert.equal(readyUnits.targets, undefined);
  assert.equal(readyUnits.picks, undefined);
  assert.equal(readyUnits.linkedTo, undefined);
});

test("sfd-192-221 golden: 'ready your units' readies the controller's units and skips the opponent's", () => {
  const { kernel, outcome } = runReadyUnits();
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["shurelyas-requiem.ready-units", "executed"]
  ]);

  assert.equal(kernel.getObject("unit-a1").exhausted, false);
  assert.equal(kernel.getObject("unit-a2").exhausted, false);
  // "your units" never reaches the opponent's ready units.
  assert.equal(kernel.getObject("unit-b1").exhausted, true);
  // 416.1.b/416.1.c: only actually readied objects are linked.
  assert.deepEqual(outcome.linkedValues["shurelyas-requiem.ready-units.readied"], {
    count: 2,
    objects: [kernel.ref("unit-a1"), kernel.ref("unit-a2")]
  });
  assert.deepEqual(kernel.events.map((event) => event.action), ["ready", "ready"]);
});

test("sfd-192-221 golden: an already-ready unit is a no-op and is not counted (CR 416.1.c)", () => {
  const kernel = requiemWorld();
  // Ready one unit up front so the instruction sees a mixed set (getObject
  // returns a copy, so the state is rewritten through the kernel's own API).
  kernel.addObject({ ...kernel.getObject("unit-a1"), exhausted: false }, "board");
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("shurelyas-requiem"),
    controller: "A",
    query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
      Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "self" ? "A" : value])),
      object
    ))
  });
  const outcome = resolveChainBody(playTrigger.body, bound);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("unit-a2").exhausted, false);
  assert.deepEqual(outcome.linkedValues["shurelyas-requiem.ready-units.readied"], {
    count: 1,
    objects: [kernel.ref("unit-a2")]
  });
});

test("sfd-192-221 golden: the Equip body attaches the requiem to a locked unit you control", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: keywordDefinitionsById.get("Equip").expand({ host: HOST }),
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);

  const attached = runEquipBody((kernel) => kernel.ref("unit-a1"));
  assert.equal(attached.outcome.status, "executed");
  assert.deepEqual(attached.kernel.getObject("shurelyas-requiem").attachedTo, attached.kernel.ref("unit-a1"));
  assert.deepEqual(attached.outcome.events.map((event) => event.action), ["attach"]);
});

test.todo(
  "sfd-192-221 Shurelya's Requiem: [Unique] (CR 825.1/825.3) needs a Unique KeywordDef plus a layer/deckbuilding " +
    "consumer for the merged continuous.deck shape; keywords/registry.generated.ts lists 26 entries and none of " +
    "them is Unique, the card-side static binder has no continuous.deck mapping, and CardProgram.deckbuilding has " +
    "no deck-construction consumer. The missing KeywordDef also blocks the whole program's expandProgram " +
    "(see the golden below)"
);

test.todo(
  "sfd-192-221 Shurelya's Requiem: paying the printed Equip cost (one [A] Power, CR 135.2.e.5 / 818.1.c.2) is " +
    "blocked on the Equip printed-cost parameter flow and conversion of its equip placeholder into the existing " +
    "power payment with all six allowedDomains (CR 135.2.e.5.a)"
);

test("sfd-192-221 Shurelya's Requiem: each Domain can pay the printed one-Power Equip requirement", () => {
  // Exercise the cost representation independently of the still-blocked Equip
  // expansion. A requirement accepting any Domain needs no new resource type.
  for (const domain of DUEL_DOMAINS) {
    const kernel = requiemWorld({ energy: 0, power: [domain] });
    const context = bindResolveContext(kernel, { source: kernel.getObject("shurelyas-requiem") });
    const plan = buildCostPlan(context, {
      id: `requiem-equip-requirement:${domain}`,
      cost: { payments: [{ kind: "power", amount: { kind: "constant", value: equip.value }, allowedDomains: DUEL_DOMAINS }] }
    });
    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
    assert.equal(plan.total.energy, 0);
    const receipt = payCostPlan(context, plan);
    assert.equal(receipt.paid, true);
    assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: domain, amount: 1 }]);
    assert.deepEqual(receipt.actions.map(entry => entry.action), [{
      type: "pay", player: "A", plan: { finalized: true, energy: 0, power: [domain] }
    }]);
    assert.deepEqual(kernel.events.map(event => event.action), ["pay"]);
  }
});

test("sfd-192-221 Shurelya's Requiem: the merged cost pipeline refuses the declared Equip payment kind (CR 818.1.b)", () => {
  // The still-current blocker: the printed Equip activation cost reaches
  // Finalize as { kind: "equip" }, which cost/plan-values.ts does not support.
  const kernel = requiemWorld();
  const context = bindResolveContext(kernel, { source: kernel.getObject("shurelyas-requiem") });
  assert.throws(
    () => buildCostPlan(context, {
      id: "requiem-equip-activation",
      cost: { payments: [{ kind: "equip", value: { kind: "source" } }] }
    }),
    (error) => {
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
});

test("sfd-192-221 Shurelya's Requiem: the merged static binder has no continuous.deck layer for [Unique] (CR 825.3.a)", () => {
  const { engine, kernel } = fixture({ cards: [{ id: "requiem", cardId: CARD_ID, types: ["gear"], might: 2 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("requiem"), to: "base", location: { type: "base", player: "A" } });
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic({
      kind: "static",
      effect: { kind: "continuous.deck", mode: "max", name: "Shurelya's Requiem" }
    }, kernel.getObject("requiem")),
    (error) => {
      assert.equal(error.name, "ProgramBindingError");
      assert.match(error.message, /continuous\.deck has no layer mapping/);
      return true;
    }
  );
});

test("sfd-192-221 golden: the merged binding layer expands and registers the card-played play effect", () => {
  // Any merged trigger registration must go through expandProgram, which
  // resolves the program's keywords. Because [Unique] has no KeywordDef the
  // whole program stops there today; this locks the durable contract by
  // exercising the same path with the Unique declaration removed (the fixture
  // never claims the shipped program is executable) and asserting that the
  // card-played play effect binds to this card's own identity.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  // Both the declared keyword ability and the live snapshot's printed keyword
  // list route through expandProgram. Until the Unique KeywordDef lands, the
  // expansion must fail closed (judge-required; never a partial expansion), so
  // record that outcome and only continue with an expansion that really
  // succeeded.
  const expansionAttempt = (() => {
    try {
      const expanded = expandProgram(lifted, hostSnapshot());
      return { ok: true, expanded };
    } catch (error) {
      return { ok: false, error };
    }
  })();
  if (!expansionAttempt.ok) {
    assert.equal(expansionAttempt.error.code, "judge-required");
    assert.match(expansionAttempt.error.message, /Keyword unique has no executable KeywordDef/);
 }

  const withoutUnique = { ...lifted, abilities: lifted.abilities.filter((ability) => ability.keyword !== "unique") };
  const binding = createProgramBinding({ cardPrograms: [withoutUnique] });
  const { engine, kernel } = fixture({ cards: [{
    id: "shurelyas-requiem", cardId: CARD_ID, types: ["gear"], might: 2, keywords: [{ id: "Equip", value: 1 }]
  }] });
  engine.commit({ type: "move-zone", object: kernel.ref("shurelyas-requiem"), to: "base", location: { type: "base", player: "A" } });
  const equipOnlySnapshot = kernel.getObject("shurelyas-requiem");
  const ids = binding.registerProgramTriggers(engine, equipOnlySnapshot);
  const registrations = ids.map(id => engine.pipeline.checkpoint().triggers.get(id));
  assert.equal(ids.length, 1);
  assert.equal(registrations[0].spec.at, "card-played");
  assert.deepEqual(registrations[0].spec.filter, {
    event: "card-played",
    object: { canonicalCardId: CARD_ID }
  });
  assert.equal(registrations[0].optional, false);

  // The registered filter really discriminates on this card's identity.
  const event = { timingPoint: "card-played", kind: "card-played", object: equipOnlySnapshot, player: "A" };
  assert.equal(matchesTriggerEvent(registrations[0].spec.filter, event, "A"), true);
  assert.equal(
    matchesTriggerEvent({ event: "card-played", object: { canonicalCardId: "other-card" } }, event, "A"),
    false
  );
});
