import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/neeko-blending-in.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { registryById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-8beb5aeeb976500ce49a3d84121eaee83cbcc32357ee206dfdb2aefdcb2439f7";
const SOURCE_TEXT =
  "(Neutral cards can go in decks of any Domain.)\n" +
  "If Neeko is in your deck, choose 3 different legends in addition to your starting legend. " +
  "(Different means none match names.)\n" +
  "When you play me, choose one of those legends and add it to your Legend Zone while I'm on the board.";

const [triggered] = program.abilities;
const [addLegend] = triggered.body;

test("rad-167-167 Neeko, Blending In: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-167-167 Neeko, Blending In: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-167-167 Neeko, Blending In: judgeReason names the three current gaps with rule anchors", () => {
  // Rule-level anchors stay durable as dependencies merge; the reason must
  // name each missing piece and its owner.
  assert.match(program.judgeReason, /legend-zone/);
  assert.match(program.judgeReason, /103\.1/);
  assert.match(program.judgeReason, /440\.2\.b\.4/);
  assert.match(program.judgeReason, /107\.4\.d\.2/);
  assert.match(program.judgeReason, /create-legend/);
  assert.match(program.judgeReason, /deckbuilding/);
  assert.equal(program.judgeReason.includes("RIFT-257"), false);
  // The card-played trigger and the program binding are merged and proven by
  // the tests below; the reason must record that instead of listing them.
  assert.match(program.judgeReason, /card-played 触发与程序绑定均已合入并实测注册成功/);
  assert.match(program.judgeReason, /Unregistered instruction opcode: effect\.create-legend/);
  assert.match(program.judgeReason, /engine-core\/src\/deck/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("rad-167-167 Neeko, Blending In: 103.1 in-deck decision chooses 3 differently-named additional legends", () => {
  // CR 103.1 的规则示例就是本卡；决定发生在构筑期，用契约 3.1 的 deckbuilding 字段。
  assert.equal(program.deckbuilding.length, 1);
  const [decision] = program.deckbuilding;
  assert.equal(decision.kind, "choose-additional-legends");
  assert.equal(decision.count, 3);
  assert.equal(decision.different, "names");
  assert.equal(decision.inAdditionToStartingLegend, true);
});

test("rad-167-167 Neeko, Blending In: card-played self trigger adds one of those legends", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
});

test("rad-167-167 Neeko, Blending In: the add instruction carries the Legend Zone destination and the on-board duration", () => {
  assert.equal(addLegend.id, "neeko-blending-in.add-chosen-legend");
  // 440.2.b.4 / 107.4.d.1：待接线原语把传奇 Create 到 Legend Zone。
  assert.equal(addLegend.op, "effect.create-legend");
  assert.deepEqual(addLegend.args.from, {
    kind: "constant",
    value: "deckbuilding:additional-legends"
  });
  assert.deepEqual(addLegend.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(addLegend.args.to, { kind: "constant", value: "legend-zone" });
  // "while I'm on the board"：107.4.d.2 来源离场时移除。
  assert.deepEqual(addLegend.args.duration, { kind: "constant", value: "while-source-in-zone" });
  assert.equal(addLegend.targets, undefined);
  assert.equal(addLegend.linkedTo, undefined);
});

test("rad-167-167 Neeko, Blending In: the card-played trigger really registers in the production binding (383.4.a)", () => {
  const source = {
    ref: { id: "neeko", zoneEntryId: 1 },
    cardId: CANONICAL,
    name: "Neeko, Blending In",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 4,
    energy: 6,
    power: ["Mind"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const registered = [];
  const ids = binding.registerProgramTriggers(
    { pipeline: { registerTrigger: registration => registered.push(registration), unregisterTrigger: () => {} } },
    source
  );
  assert.deepEqual(ids, ["program:neeko:1:0"]);
  assert.equal(registered[0].spec.at, "card-played");
  // "When you play me" resolves the source itself, not any played card.
  assert.deepEqual(registered[0].spec.filter, {
    event: "card-played",
    object: { objectId: "neeko" },
    player: "self"
  });
  assert.equal(registered[0].optional, false);
});

test("rad-167-167 Neeko, Blending In: executing the registered body stops at the unregistered create-legend op (440.2.b.4)", () => {
  // The registration half is merged; the add-half has no op. Running the real
  // authored body proves the gap is the primitive, not the trigger structure.
  assert.equal(registryById.has(addLegend.op), false);
  const kernel = world().unit("neeko", { types: ["unit"] }).build();
  assert.throws(
    () => runAbilityBody(triggered.body, kernel),
    error => /Unregistered instruction opcode: effect\.create-legend/.test(error.message)
  );
  // No Legend Zone destination exists in the contract's ZoneId either.
  assert.equal(registryById.has("effect.zone"), true);
  assert.equal(addLegend.args.to.value, "legend-zone");
});

test("rad-167-167 Neeko, Blending In: the deckbuilding decision still has no runtime consumer", async () => {
  // 103.1 decides during deckbuilding; engine-core/src/deck is still an empty
  // export, so nothing can turn "those legends" into a runtime list.
  const deck = await import("../../../../engine-core/dist/deck/index.js");
  assert.deepEqual(Object.keys(deck), []);
  assert.equal(program.deckbuilding.length, 1);
});

test.todo(
  "rad-167-167 Neeko, Blending In: create one of the three deckbuilding legends in the Legend Zone " +
    "(CR 440.2.b.4 / 107.4.d.1) — the contract ZoneId has no legend-zone member and effect.create-legend has " +
    "no merged implementation (contract change request)"
);

test.todo(
  "rad-167-167 Neeko, Blending In: read the CR 103.1 deckbuilding decision at runtime so the play trigger can " +
    "choose among those 3 legends — engine-core/src/deck is only a placeholder export (no assigned task)"
);

test.todo(
  "rad-167-167 Neeko, Blending In: remove the added legend when the source leaves the board (CR 107.4.d.2) — " +
    "while-source-in-zone has no create-legend consumer"
);
