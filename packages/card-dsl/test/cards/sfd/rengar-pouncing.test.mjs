import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/rengar-pouncing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.match(program.judgeReason, /RIFT-85/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /打出位置|Finalize 位置校验/);
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

test.todo(
  "sfd-025-221 Rengar, Pouncing: [Assault 2] expansion (+2 Might while the host is an attacker — " +
    "the keyword's KeywordDef exists, but no consumer expands a CardProgram keyword ability into the " +
    "layers engine, and Attacker designation is not readable) — RIFT-81 / RIFT-91"
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
