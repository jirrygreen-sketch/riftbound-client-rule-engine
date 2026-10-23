import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/yone-blademaster.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const BODY_ID = "yone-blademaster.deal-might";
const TARGET_ID = "enemy-unit-in-base";

test("rad-181-167 Yone, Blademaster: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56"
  );
  assert.equal(program.sourceText.includes("[Weaponmaster]"), true);
  assert.equal(program.sourceText.includes("uncontrolled"), true);
});

test("rad-181-167 Yone, Blademaster: Weaponmaster keyword + conquer trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "weaponmaster" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.equal(triggered.trigger.filter.self, true);
  // RAD 印刷："a battlefield that was uncontrolled"（CR 170.11.b）。
  assert.equal(triggered.trigger.filter.battlefieldWas, "uncontrolled");
  assert.equal(triggered.optional, false);
});

test("rad-181-167 Yone, Blademaster: damage body targets one enemy unit in a base with dynamic Might amount", () => {
  const [, triggered] = program.abilities;
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, BODY_ID);
  assert.equal(instruction.op, "effect.damage");
  assert.equal(instruction.args.amount.kind, "object-property");
  assert.equal(instruction.args.amount.property, "might");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(instruction.args.source, { kind: "constant", value: "self" });

  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, TARGET_ID);
  assert.equal(spec.filter.type, "unit");
  assert.equal(spec.filter.controller, "opponent");
  assert.deepEqual(spec.filter.location, { type: "base" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("rad-181-167 Yone, Blademaster: effect.damage deals the source's Might to an enemy unit in a base", () => {
  const kernel = world()
    .unit("yone", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 5
    })
    .unit("enemy", {
      owner: "B",
      zone: "board",
      location: { type: "base", player: "B" },
      might: 3
    })
    .build();
  const yoneRef = kernel.ref("yone");
  const enemyRef = kernel.ref("enemy");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("yone") });
  const run = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: yoneRef, property: "might" },
      target: TARGET_ID,
      source: "self"
    },
    {
      world: scoped,
      targets: { [TARGET_ID]: [enemyRef] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 5);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(scoped.getObject("enemy").damage, 5);
  assert.equal(run.events[0].action, "damage");
});

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/;
// the active Spiritforged errata URL is
// https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/.
// The target printing is RAD (rad-181-167), canonicalCardId exactly as asserted
// above: "a battlefield that was uncontrolled" means 170.11.b (no controller),
// not the separate "open" definition in 170.11.c.  Conquer collection is
// 383.4.c.1/.2.a; Weaponmaster is 821; damage and the Base target are 418 and
// 355.9.  The controller is A.
//
// Timeline A: Play Yone from Hand -> Finalize pays -> Unit Resolve -> real
// card-played Weaponmaster Pending -> Finalize selects one controlled Equipment
// -> both players may respond -> Resolve pays its Equip cost and attaches.
// If no Equipment exists, Weaponmaster still becomes Pending and closes with
// no purchase; it must not disappear or target itself.
const equipmentKeywords = ability => ({
  id: ability.keyword,
  ...(ability.value === undefined ? {} : { value: ability.value }),
  ...(ability.params === undefined ? {} : { params: structuredClone(ability.params) })
});

function yoneWeaponmasterScene({ equipment = true } = {}) {
  const sword = {
    owner: "A", controller: "A", cardId: "test:yone-sword", name: "Yone Sword",
    types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
    energy: null, power: null, might: null,
    keywords: [equipmentKeywords({ keyword: "equip", value: 1, costDomain: "Body", params: {
      cost: { kind: "activated", payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Body"] }] }
    } })]
  };
  return productionPlay({
    programs: [program],
    answers: { "target:weaponmaster-equipment": equipment ? ["sword"] : [] },
    build: w => {
      let builder = w.player("A", { energy: 5, power: ["Body", "Body"] }).player("B")
        .object("yone", {
          owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
          tags: ["Yone", "Ionia", "Demon", "Champion"], zone: "hand",
          energy: 5, power: ["Body"], might: 5
        });
      if (equipment) builder = builder.object("sword", sword);
      return builder;
    }
  });
}

test("rad-181-167 Yone production golden: Weaponmaster pays the discounted Equip cost and attaches", () => {
  const f = yoneWeaponmasterScene();
  f.play("yone");
  assert.deepEqual(f.targetRequests().map(request => request.id), ["target:weaponmaster-equipment"]);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, [], "the Unit cost and the discounted Body Equip cost were both paid");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("yone").ref);
  assert.deepEqual(f.engine.items, []);
});

test("rad-181-167 Yone production boundary: selecting no Equipment finishes Weaponmaster without payment", () => {
  const f = yoneWeaponmasterScene({ equipment: false });
  f.play("yone");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, ["Body"], "one Body lot pays only Yone's printed Power");
  assert.equal(f.kernel.getObject("yone").zone, "board");
  assert.deepEqual(f.targetRequests().map(request => [request.id, request.options]), [
    ["target:weaponmaster-equipment", []]
  ]);
  assert.deepEqual(f.engine.items, []);
});
