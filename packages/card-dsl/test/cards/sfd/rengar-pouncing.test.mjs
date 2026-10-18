// Golden test for Rengar, Pouncing (sfd-025-221).
//
// Execution evidence (the printed 3 energy / 1 Fury payment and the Reaction
// play through a real Chain) lives in the RIFT-698 parameterized template
// golden: test/cards/templates/keyword-keyword-static-698.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/rengar-pouncing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { abilitySpeed, expandProgram } from "../../../../engine-core/dist/programs/keywords.js";

const CARD_ID = "card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9";

const [reaction, assault, permission] = program.abilities;

test("sfd-025-221 Rengar, Pouncing: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-025-221 Rengar, Pouncing: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (sfd-025-221) carries this text verbatim.
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
      "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
      "I can be played to a battlefield you're attacking."
  );
});

test("sfd-025-221 Rengar, Pouncing: judgeReason names the keyword-expansion and play-location gaps", () => {
  assert.match(program.judgeReason, /Reaction/);
  assert.match(program.judgeReason, /Assault 2|Assault/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /攻击方/);
  assert.match(program.judgeReason, /打出位置|Finalize 位置校验/);
  // Default static binding and Reaction timing work; Assault field alignment
  // and the attacking Battlefield permission remain blocked.
  assert.match(program.judgeReason, /createEngineStaticBinder/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /playDestinationIsLegal/);
  assert.match(program.judgeReason, /Fury 费用/);
  assert.doesNotMatch(program.judgeReason, /未消费 Power/);
  assert.doesNotMatch(program.judgeReason, /没有运行时消费方把卡牌程序的 keyword 能力展开并注册进图层：chain\.canAct\(\)/);
});

test("sfd-025-221 Rengar, Pouncing: [Reaction] and [Assault 2] are declared, not re-implemented", () => {
  assert.equal(program.abilities.length, 3);
  // 813.1 / 807.1.b: the card names the keywords; expansion belongs to the
  // engine keyword registry (contract 3.7).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault", value: 2 });
});

test("sfd-025-221 Rengar, Pouncing: the third ability is a static play-location permission", () => {
  // 349 / 355.17.b: the sentence adds a legal play destination; contract 3.1's
  // play ability only has `restriction`, so the permission is modeled as a
  // static continuous effect, matching merged sfd/dauntless-vanguard.
  assert.equal(permission.kind, "static");
  assert.equal(permission.effect.kind, "play-location-permission");
  assert.deepEqual(permission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      battlefield: { attacking: true, controller: "controller" },
      appliesTo: "self"
    }
  });
  assert.equal(permission.effect.duration, "while-in-hand");
  assert.equal(permission.condition, undefined);
});

test("sfd-025-221 Rengar, Pouncing: the merged binder expands the declared keywords and derives Reaction speed", () => {
  // Evidence for the corrected judgeReason: expandProgram already turns the
  // declared keyword abilities into executable Ability values (Assault -> a
  // static continuous.might with its attacker condition, Reaction -> a timing
  // grant), and abilitySpeed reports the printed Reaction speed.
  const source = {
    ref: { id: "rengar", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Rengar, Pouncing",
    types: ["unit"],
    tags: ["Cat", "Rengar", "Ixtal", "Champion"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "hand",
    location: null,
    might: 3,
    energy: 3,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = expandProgram(program, source);

  // [Reaction]: a timing grant, and the derived play speed is reaction (813.1).
  const timingGrant = expanded.expanded.find(
    (ability) => ability.kind === "static" && ability.effect.kind === "continuous.timing"
  );
  assert.ok(timingGrant, "Reaction must expand to a continuous.timing static ability");
  assert.deepEqual(timingGrant.effect.grants, ["showdown", "closed-state"]);
  assert.equal(abilitySpeed(expanded.abilities, source), "reaction");

  // The declarations expand correctly; this does not prove the blocked
  // attacking Battlefield permission or Assault condition.
  assert.equal(expanded.declared.length, 3);
  assert.ok(expanded.expanded.length >= 2);

  // [Assault 2]: +2 Might in the arithmetic layer, gated on the attacker
  // designation, which the merged snapshot does not carry.
  const assault = expanded.expanded.find(
    (ability) => ability.kind === "static" && ability.effect.kind === "continuous.might"
  );
  assert.ok(assault, "Assault must expand to a static Might modification");
  assert.deepEqual(assault.effect.amount, { kind: "constant", value: 2 });
  assert.equal(assault.effect.appliesTo, "self");
  assert.deepEqual(assault.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });

  // The default static binder now evaluates compare conditions, but this
  // expansion still reads designation rather than the snapshot's combatRole.
  assert.equal(typeof assault.condition.left, "object");
});

test("sfd-025-221 Rengar, Pouncing: printed Reaction speed allows a real response on the opponent's turn", () => {
  // Isolate the supported Reaction clause. This draft does not register the
  // blocked Assault or attacking-battlefield permission, and plays to base.
  const { engine, kernel, draft, card } = fixture({ cards: [{
    id: "rengar", cardId: CARD_ID, owner: "B", controller: "B", energy: 3,
    power: ["Fury"], might: 3, tags: ["Cat", "Rengar", "Ixtal", "Champion"]
  }] });
  engine.commit({ type: "gain-power", player: "B", power: ["Fury"] });
  engine.advance();
  engine.execute(draft("opponent-draw", { speed: "normal" }));
  engine.pass("A");
  assert.equal(engine.priority, "B");
  const source = kernel.getObject("rengar");
  const expanded = expandProgram(program, source);
  const speed = abilitySpeed(expanded.abilities, source);
  assert.equal(speed, "reaction");
  assert.equal(engine.canAct("B", speed, source.ref, source), true);
  engine.execute(card("rengar", { kind: "unit", controller: "B", speed, body: [] }));
  assert.equal(kernel.player("B").energy, 17);
  // The chain accepted the printed Fury requirement and emitted the payment;
  // the legacy TestWorld pay action leaves its Power projection unchanged.
  assert.deepEqual(kernel.events.filter((event) => event.action === "pay").map((event) => event.action), ["pay"]);
  assert.deepEqual(kernel.player("B").power, ["Fury"]);
  // A Reaction resolves immediately on top of the pending item, leaving the
  // original opponent-draw item as the only chain entry.
  assert.equal(engine.items.length, 1);
  resolveAll(engine);
  assert.equal(kernel.getObject("rengar").zone, "board");
  assert.deepEqual(kernel.getObject("rengar").location, { type: "base", player: "B" });
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(engine.trace.filter(event => event.step === "resolved").length, 2);
});

test("sfd-025-221 Rengar, Pouncing: Reaction timing is accepted in a real closed chain", () => {
  const { engine, kernel, draft } = fixture({ cards: [{ id: "rengar", cardId: CARD_ID, owner: "B", controller: "B", energy: 3, power: ["Fury"], might: 3 }] });
  engine.execute(draft("reaction-timing-probe", { speed: "normal" }));
  engine.pass("A");
  const source = kernel.getObject("rengar");
  const expanded = expandProgram(program, source);
  const speed = abilitySpeed(expanded.abilities, source);
  assert.equal(speed, "reaction");
  assert.equal(engine.items.length, 1);
  assert.equal(engine.priority, "B");
  assert.equal(engine.canAct("B", speed, source.ref, source), true);
  assert.equal(engine.canAct("B", "action", source.ref, source), false);
  assert.equal(engine.canAct("B", "normal", source.ref, source), false);
});

test.todo(
  "sfd-025-221 Rengar, Pouncing: the expanded Assault condition must read a real attacker " +
    "designation (807.1.d.1), aligned with combatRole through the default static binder"
);
test.todo(
  "sfd-025-221 Rengar, Pouncing: 'a battlefield you're attacking' is accepted as a play destination " +
    "by Finalize with a hand-zone static permission adapter and attacker-battlefield predicate (349, 355.17.b)"
);
