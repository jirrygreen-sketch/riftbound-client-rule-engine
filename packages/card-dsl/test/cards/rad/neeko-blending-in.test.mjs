import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/neeko-blending-in.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /create-legend/);
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
  "rad-167-167 Neeko, Blending In: remove the added legend when the source leaves the board (CR 107.4.d.2) and " +
    "register the card-played trigger — the while-source-in-zone duration has no card-facing consumer and no " +
    "merged path registers a CardProgram triggered ability (RIFT-257)"
);
