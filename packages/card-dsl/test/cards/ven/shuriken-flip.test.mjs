import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shuriken-flip.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-eead7ad848e8aa64f2ca544f7174c4bc3764b8eb661c26cfd050804e8ce278e5";
const SOURCE_TEXT =
  "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n" +
  "[Flow] :rb_energy_3::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)";
const ENEMY_ID = "shuriken-flip.enemy-unit";
const FRIENDLY_ID = "shuriken-flip.friendly-unit";

const [flowKeyword, play] = program.abilities;
const [dealTwo, moveUnit] = play.body;
const enemySpec = dealTwo.targets[0];
const friendlySpec = moveUnit.targets[0];

const stripTargets = (instruction) => {
  const { targets, ...rest } = instruction;
  return rest;
};

test("ven-140-166 Shuriken Flip: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-140-166 Shuriken Flip: judgeReason names the runtime Location choice and Flow", () => {
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /829\.1\.b/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-140-166 Shuriken Flip: damage with an up-to-one target and an independent Move", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["shuriken-flip.deal-2", "effect.damage"],
    ["shuriken-flip.move-unit", "effect.move"]
  ]);

  // "Deal 2 to up to one enemy unit at a battlefield": 418.1.c non-combat damage,
  // 355.13 up-to allows zero targets, 355.10.b keeps "at a battlefield" a restriction.
  assert.deepEqual(dealTwo.args, {
    amount: { kind: "constant", value: 2 },
    target: { kind: "constant", value: ENEMY_ID }
  });
  assert.deepEqual(enemySpec, {
    id: ENEMY_ID,
    filter: { type: "unit", zone: "board", controller: "opponent", location: "battlefield" },
    min: 0,
    max: 1,
    selection: "up-to"
  });
  assert.equal(dealTwo.linkedTo, undefined);

  // "then move a friendly unit": 158.1 order, not a result reference; the destination
  // is the resolution-time Location choice that has no merged selector (judgeReason).
  assert.equal(moveUnit.args.to.value.kind, "destination-selector");
  assert.deepEqual(moveUnit.args.objects, { kind: "constant", value: { target: FRIENDLY_ID } });
  assert.deepEqual(moveUnit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(friendlySpec, {
    id: FRIENDLY_ID,
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(moveUnit.linkedTo, undefined);

  assert.equal(instructionDefinitionsById.get("effect.damage"), damage);
  assert.equal(instructionDefinitionsById.get("effect.move"), move);
  assert.equal(keywordDefinitionsById.has("Flow"), true);
});

test("ven-140-166 Shuriken Flip golden: the damage half resolves against the locked enemy unit", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .build();
  kernel.setTargets(ENEMY_ID, [kernel.ref("enemy")]);

  const outcome = resolveChainBody([stripTargets(dealTwo)], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.equal(outcome.linkedValues["shuriken-flip.deal-2.dealt"], 2);
});

test("ven-140-166 Shuriken Flip golden: choosing zero targets deals nothing and is ignored (355.13/359.3.e.7)", () => {
  const kernel = world().unit("enemy", { owner: "B", controller: "B", might: 3 }).build();
  kernel.setTargets(ENEMY_ID, []);

  const outcome = resolveChainBody([stripTargets(dealTwo)], kernel);

  // The Deal instruction has no legal target at all, so it is ignored and nothing happens;
  // the following Move is an independent sentence (158.1) and does not inherit the ignore.
  assert.deepEqual(outcome.results.map((entry) => entry.result), [
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test("ven-140-166 Shuriken Flip golden: a zero-target damage choice does not suppress the Move", () => {
  // 158.1 sequences the two sentences, but the Move does not reference the damage result, so it
  // is NOT linked to it. With the chain-supplied static destination substituted for the pending
  // runtime Location choice (judgeReason), the whole declared body shows the independence: the
  // Deal is ignored for the chosen zero targets while the Move still resolves.
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3, exhausted: true })
    .unit("friendly", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setTargets(ENEMY_ID, []);
  kernel.setTargets(FRIENDLY_ID, [kernel.ref("friendly")]);

  const body = [
    stripTargets(dealTwo),
    { ...stripTargets(moveUnit), args: { ...moveUnit.args, to: { kind: "constant", value: "controller-base" } } }
  ];
  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["shuriken-flip.deal-2", "ignored"],
    ["shuriken-flip.move-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.getObject("friendly").location, { type: "base", player: "A" });
});

test("ven-140-166 Shuriken Flip fail-closed: the descriptive destination is rejected, never guessed", () => {
  const kernel = world().unit("friendly", { owner: "A", controller: "A", might: 2 }).build();
  const before = kernel.snapshot();

  // effect.move's destination() only accepts a static LocationRef, controller-base or a
  // choice; the marker throws instead of moving the unit somewhere invented.
  assert.throws(
    () => runInstruction(
      move,
      { objects: { kind: "constant", value: { target: FRIENDLY_ID } }, to: moveUnit.args.to, amount: moveUnit.args.amount },
      { world: kernel, targets: { [FRIENDLY_ID]: [kernel.ref("friendly")] } }
    ),
    /effect\.move to must be a location/
  );
  assert.deepEqual(kernel.snapshot(), before);
});

test("ven-140-166 Shuriken Flip: the 'at a battlefield' restriction matches battlefields only", () => {
  const { controller: _controller, ...locationOnly } = enemySpec.filter;
  const snapshot = (location) => ({
    ref: { id: "unit", zoneEntryId: 1 },
    cardId: "card:unit",
    name: "unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location,
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "battlefield", id: "battlefield-1" })), true);
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "base", player: "B" })), false);
  assert.equal(matchesObjectFilter(locationOnly, snapshot(null)), false);
});

test.todo(
  "ven-140-166 Shuriken Flip: 'move a friendly unit' has no printed destination; the resolution-time " +
    "Location choice (355.4/355.4.a/451.1) needs the runtime Location selector in the target/location " +
    "plan (RIFT-90/RIFT-91)"
);

test.todo(
  "ven-140-166 Shuriken Flip: play from Trash for the printed Flow cost (3 energy + 1 rainbow rune) " +
    "and banish the spell when it leaves the Chain by 829.1.b — needs the alternate-cost consumer " +
    "(RIFT-261) and the replacement registration path (RIFT-260)"
);
