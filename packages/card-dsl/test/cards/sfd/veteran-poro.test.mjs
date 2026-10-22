import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/veteran-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CARD_ID = "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7";
const BASE = { type: "base", player: "A" };
const constant = value => ({ kind: "constant", value });
const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const equipKeyword = (amount, domains = ["any"]) => ({
  id: "Equip",
  value: amount,
  params: {
    cost: {
      kind: "activated",
      payments: [{
        kind: "power",
        amount: constant(amount),
        allowedDomains: domains
      }]
    }
  }
});

const veteranPoroBoard = ({
  equip = true,
  energy = 20,
  power = ["Body", "Order"],
  equipDomains = ["any"],
  equipAmount = 2,
  equipKeywords,
  enemyEquipment = false,
  oldHost = false
} = {}) => w => {
  let table = w
    .player("A", { energy, power })
    .player("B", { energy: 20, power: ["Body"] })
    .unit("poro", {
      owner: "A", controller: "A", cardId: CARD_ID, name: "Veteran Poro",
      types: ["unit"], tags: ["Poro"], zone: "hand", location: null,
      energy: 2, power: [], might: 2
    });
  if (equip) table = table.object("sword", {
    owner: "A", controller: "A", cardId: "card:long-sword", name: "Long Sword",
    types: ["gear"], tags: ["Equipment"], zone: "board", location: BASE,
    energy: null, power: null, might: null,
    keywords: equipKeywords ?? [equipKeyword(equipAmount, equipDomains)]
  });
  if (oldHost) table = table.unit("old-host", {
    owner: "A", controller: "A", cardId: "card:old-host", name: "Old Host",
    types: ["unit"], tags: [], zone: "board", location: BASE, might: 2
  });
  if (enemyEquipment) table = table.object("enemy-sword", {
    owner: "B", controller: "B", cardId: "card:enemy-sword", name: "Enemy Sword",
    types: ["gear"], tags: ["Equipment"], zone: "board",
    location: { type: "base", player: "B" }, energy: null, power: null, might: null,
    keywords: [equipKeyword(1)]
  });
  return table;
};

const attachFirst = (f, equipment = "sword", host = "old-host") => {
  assert.equal(f.kernel.perform({
    type: "attach", object: f.kernel.ref(equipment), host: f.kernel.ref(host)
  }).status, "done");
};

const runProduction = ({
  answers = { "target:weaponmaster-equipment": ["sword"] },
  board = veteranPoroBoard(),
  beforePlay
} = {}) => {
  const f = productionPlay({ programs: [program], answers, build: board });
  beforePlay?.(f);
  const draft = f.play("poro");
  return { f, draft };
};

test("sfd-099-221 Veteran Poro: program validates, is registered and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
  );
});

test("sfd-099-221 Veteran Poro: exactly one unvalued Weaponmaster keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "weaponmaster");
  assert.equal(ability.value, undefined);
});

test("sfd-099-221 Veteran Poro: the Weaponmaster expansion is structurally valid EffectIR", () => {
  const definition = keywordDefinitionsById.get("Weaponmaster");
  assert.ok(definition, "effects/keywords/Weaponmaster.ts must be registered");
  const [ability] = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  const [choice] = ability.body;
  assert.equal(choice.op, "sequence");
  assert.deepEqual(choice.targets, [{
    id: "weaponmaster-equipment",
    filter: { type: "gear", controller: "self", tags: ["Equipment"] },
    min: 0,
    max: 1,
    selection: "up-to"
  }]);
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.op), [
    "cost.modify",
    "cost.pay",
    "effect.attach"
  ]);
});

// Official evidence used by every production assertion in this file:
// - Core Rules v1.5, last updated 2026-10-09, effective 2026-10-16:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes effective 2026-10-16; reviewed for relevant rulings:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// - Spiritforged errata; this card has no applicable text change:
//   https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
// canonicalCardId: card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7
// Rules: 821.1.b-.d and 821.1.c.1-.7. The optional choice and its Pending
// trigger are established at Play/card-played; Finalize locks the Equipment;
// Resolve reads its authoritative Equip CostSpec, applies only the one-[A]
// discount, pays atomically, attaches, and leaves an unpayable target in place.
// The shipping registry program is bound by productionPlay:
// createProgramBinding + ChainEngine + attachLifecycle, not a manual fixture.
test("sfd-099-221 Veteran Poro production golden: pays the discounted Equip cost and attaches the chosen Equipment", () => {
  const { f, draft } = runProduction();
  assert.equal(draft.speed, "normal");
  assert.equal(f.kernel.player("A").energy, 18, "only Poro's printed 2 Energy is paid");
  assert.deepEqual(f.kernel.player("A").power, ["Order"], "one of the two [A] remains after the Weaponmaster discount");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("poro").ref);
  assert.deepEqual(f.targetRequests().map(request => ({
    id: request.id, min: request.min, max: request.max, options: request.options
  })), [{
    id: "target:weaponmaster-equipment", min: 0, max: 1, options: [f.kernel.ref("sword")]
  }]);
  assert.deepEqual(f.kernel.events.filter(event => event.action === "pay").map(event => ({
    energy: event.energy, power: event.power
  })), [
    { energy: 2, power: [] },
    { energy: 0, power: ["Body"] }
  ], "the Unit cost and discounted Equip cost are separate real payments");
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "card-played" && event.object.ref.id === "poro").length,
    1
  );
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "object-attached" && event.object.ref.id === "sword").length,
    1
  );
  assert.deepEqual(f.engine.items, []);
});

test("sfd-099-221 Veteran Poro: declining the optional Equipment leaves it where it was", () => {
  const { f } = runProduction({
    answers: { "target:weaponmaster-equipment": [] },
    board: veteranPoroBoard({ oldHost: true }),
    beforePlay: f => attachFirst(f)
  });
  assert.equal(f.kernel.player("A").energy, 18, "only Poro's printed 2 Energy is paid");
  assert.deepEqual(f.kernel.player("A").power, ["Body", "Order"]);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.ref("old-host"));
  assert.equal(f.kernel.events.filter(event => event.action === "attach").length, 1, "only the setup attachment ran");
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-attached"), false);
  assert.deepEqual(f.targetRequests().map(request => request.id), ["target:weaponmaster-equipment"]);
  assert.deepEqual(f.engine.items, []);
});

test("sfd-099-221 Veteran Poro: no Equipment produces only the empty optional choice", () => {
  const { f } = runProduction({
    answers: { "target:weaponmaster-equipment": [] },
    board: veteranPoroBoard({ equip: false })
  });
  assert.equal(f.kernel.player("A").energy, 18);
  assert.deepEqual(f.kernel.player("A").power, ["Body", "Order"]);
  assert.equal(f.kernel.getObject("poro").zone, "board");
  assert.deepEqual(f.targetRequests().map(request => ({ min: request.min, options: request.options })), [
    { min: 0, options: [] }
  ]);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-attached"), false);
});

test("sfd-099-221 Veteran Poro: only Equipment controlled by Poro's controller is offered", () => {
  const { f } = runProduction({ board: veteranPoroBoard({ enemyEquipment: true }) });
  assert.deepEqual(f.targetRequests()[0].options, [f.kernel.ref("sword")]);
  assert.equal(f.kernel.getObject("enemy-sword").attachedTo, null);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("poro").ref);
});

test("sfd-099-221 Veteran Poro: an authoritative one-[A] Equip cost is reduced to zero", () => {
  const { f } = runProduction({ board: veteranPoroBoard({ energy: 2, power: [], equipAmount: 1 }) });
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.events.filter(event => event.action === "pay").map(event => ({
    energy: event.energy, power: event.power
  })), [
    { energy: 2, power: [] },
    { energy: 0, power: [] }
  ]);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("poro").ref);
});

test("sfd-099-221 Veteran Poro: a named-domain Equip cost has no [A] and is paid in full", () => {
  const { f } = runProduction({ board: veteranPoroBoard({ equipDomains: ["Body"], equipAmount: 1 }) });
  assert.equal(f.kernel.player("A").energy, 18);
  assert.deepEqual(f.kernel.player("A").power, ["Order"], "one Body Power was paid; the other Body remains");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("poro").ref);
});

test("sfd-099-221 Veteran Poro: an already attached Equipment is reattached to Poro", () => {
  const { f } = runProduction({
    board: veteranPoroBoard({ oldHost: true, energy: 2, power: ["Body"], equipAmount: 1 }),
    beforePlay: f => attachFirst(f)
  });
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("poro").ref);
  assert.notDeepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.ref("old-host"));
  assert.equal(f.kernel.getObject("sword").zone, "board");
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "object-attached" && event.object.ref.id === "sword").length,
    1
  );
});

test("sfd-099-221 Veteran Poro: an unpayable discounted Equip cost leaves the Equipment unchanged", () => {
  const f = productionPlay({
    programs: [program],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: veteranPoroBoard({ energy: 2, power: [] })
  });
  const equipmentBefore = f.kernel.getObject("sword");
  assert.throws(() => f.play("poro"), /insufficient matching Power/i);
  assert.equal(f.kernel.player("A").energy, 0, "the successful Unit play remains paid");
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("sword").zone, equipmentBefore.zone);
  assert.deepEqual(f.kernel.getObject("sword").ref, equipmentBefore.ref);
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.events.some(event => event.action === "attach"), false);
  assert.deepEqual(f.engine.items.map(item => [item.id, item.status]), [["trigger:1", "finalized"]]);
});

test("sfd-099-221 Veteran Poro: Equipment without an authoritative Equip cost fails closed (821.1.c.4)", () => {
  const f = productionPlay({
    programs: [program],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: veteranPoroBoard({ equipKeywords: [] })
  });
  assert.throws(
    () => f.play("poro"),
    /821\.1\.c\.2: missing authoritative Equip-cost binding for sword; original \[A\]\/\[C\] symbols required/
  );
  assert.equal(f.kernel.player("A").energy, 18);
  assert.deepEqual(f.kernel.player("A").power, ["Body", "Order"]);
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.events.some(event => event.action === "attach"), false);
});

test("sfd-099-221 Veteran Poro: six named domains are not original [A] provenance (821.1.c.3)", () => {
  const f = productionPlay({
    programs: [program],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: veteranPoroBoard({ equipDomains: SIX_DOMAINS, equipAmount: 1 })
  });
  assert.throws(
    () => f.play("poro"),
    /821\.1\.c\.2: unsupported authoritative Equip cost: ambiguous named Power domains/
  );
  assert.equal(f.kernel.player("A").energy, 18);
  assert.deepEqual(f.kernel.player("A").power, ["Body", "Order"]);
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.events.some(event => event.action === "attach"), false);
});
