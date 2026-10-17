// Golden test for Shurelya's Requiem (sfd-192-221).
//
// Two merge-verified halves run for real: the card-played trigger body
// (effect.ready with the `{ kind: "query" }` set shape: ready your units, leave
// the opponent's) and the Equip expansion's attach body, both through the
// production interpreter adapter. Unique, the `equip` payment kind and the
// card-program → TriggerRegistration adapter are the judged gaps.
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
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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

const requiemWorld = () => world()
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
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
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
  "sfd-192-221 Shurelya's Requiem: [Unique] (CR 825.1/825.3) needs a Unique KeywordDef and a continuous.deck " +
    "consumer; keywords/registry.generated.ts lists 26 entries and none of them is Unique, and contract 3.1/3.3 " +
    "has no deck-constraint semantics. The missing KeywordDef also blocks the whole program's expandProgram " +
    "(see the golden below)"
);

test.todo(
  "sfd-192-221 Shurelya's Requiem: paying the printed Equip cost (one [A] Power, CR 135.2.e.5 / 818.1.c.2) is " +
    "blocked on the `equip` payment kind in cost/plan-values.ts and on a contract representation for Universal Power " +
    "(CR 163.2.b; in-progress RIFT-261)"
);

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
  const registrations = [];
  const equipOnlySnapshot = { ...hostSnapshot(), keywords: [{ id: "Equip", value: 1 }] };
  const ids = binding.registerProgramTriggers(
    { pipeline: { registerTrigger: (registration) => registrations.push(registration), unregisterTrigger: () => {} } },
    equipOnlySnapshot
  );
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
