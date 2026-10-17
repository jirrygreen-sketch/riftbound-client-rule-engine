import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/rengar-pouncing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
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
  assert.match(program.judgeReason, /RIFT-81/);
  assert.match(program.judgeReason, /81\/85\/91/);
  assert.match(program.judgeReason, /打出位置|Finalize 位置校验/);
  // RIFT-257 merged expandProgram/abilitySpeed, so the accurate remaining gap
  // is the missing layer registration consumer (ProgramStaticBinder is still a
  // caller-supplied callback), not the absence of keyword expansion.
  assert.match(program.judgeReason, /ProgramStaticBinder/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /RIFT-257/);
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

test("sfd-025-221 Rengar, Pouncing: RIFT-257 expands the declared keywords and derives Reaction speed", () => {
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

  // The whole card still needs a production consumer for these static grants;
  // the expansion itself is complete and validated.
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

  // ... and the produced object shapes are still not executable as printed:
  // a real card static registration consumer is still a caller-supplied
  // ProgramStaticBinder callback (programs/statics.ts noop by default), and the
  // `designation` characteristic the condition reads is not on ObjectSnapshot
  // (contract 3.8 declares combatRole instead; layers conditionMatches returns
  // true for the unhandled compare shape, which would grant +2 unconditionally).
  assert.equal(typeof assault.condition.left, "object");
});

test.todo(
  "sfd-025-221 Rengar, Pouncing: the expanded Assault condition must read a real attacker " +
    "designation (807.1.d.1) and be evaluated by the layer engine, and a production consumer must " +
    "register card statics into the continuous-effect registry — RIFT-81 / RIFT-91 follow-up"
);

test.todo(
  "sfd-025-221 Rengar, Pouncing: [Reaction] timing permission (813.1.c, closed-state play) — the " +
    "expansion is a continuous.timing static ability and chain.canAct() (contract 3.5) does not read " +
    "layer permissions yet — RIFT-85 / chain timing workstream"
);

test.todo(
  "sfd-025-221 Rengar, Pouncing: 'a battlefield you're attacking' is accepted as a play destination " +
    "by Finalize once the static play-location-permission consumer and an attacker-battlefield " +
    "predicate land (349, 355.17.b) — RIFT-32 / RIFT-90"
);
