import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/zilean-time-mage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { actionMatchesEventPattern } from "../../../../engine-core/dist/replacement/pattern.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0edf62a2fa247fc8feb7ea57978657018d5be55376452b2c4173a7170526aa61";
const SOURCE_TEXT =
  "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token " +
  "and an additional copy of it instead.";

const [replacement] = program.abilities;
const [rewrite] = replacement.with;

test("unl-086-219 Zilean, Time Mage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-086-219 Zilean, Time Mage: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /once each turn|Once each turn|386\.1/);
  assert.match(program.judgeReason, /oncePerTurn/);
  assert.match(program.judgeReason, /planner/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-086-219 Zilean, Time Mage: one replacement ability on the play of a token unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // CR 369.1 / 370.1: a would-instead clause replaces the event itself. CR 375
  // gives the same shape for token plays.
  assert.equal(replacement.replaces.event, "card-played");
  assert.deepEqual(replacement.replaces.filter, {
    type: "unit",
    characteristics: { isToken: true },
    controller: "self"
  });
  // "while I'm at a battlefield": the source's location is the applicability
  // condition (464.2.b); this descriptive constant still needs the RIFT-359
  // location-type predicate before the full program can be executable.
  assert.deepEqual(replacement.condition, {
    kind: "expression",
    value: { kind: "constant", value: "source-at-a-battlefield" }
  });
});

test("unl-086-219 Zilean, Time Mage: the rewrite keeps 'that token + an additional copy' as the exact shape", () => {
  assert.equal(replacement.with.length, 1);
  assert.equal(rewrite.id, "zilean-time-mage.play-token-and-additional-copy");
  // The rewrite must play the replaced event's token and an additional copy of
  // it. The pipeline supports action lists and an event-object binding; the
  // planner still needs the two-play rewrite with a Chain copy (CR 375).
  assert.equal(rewrite.op, "replacement.play-with-additional-copy");
  assert.deepEqual(rewrite.args.original, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });
  assert.deepEqual(rewrite.args.additional, {
    kind: "constant",
    value: { copyOf: { linked: "replacement.object" } }
  });
  assert.equal(rewrite.targets, undefined);
  assert.equal(rewrite.linkedTo, undefined);
});

test("unl-086-219 Zilean, Time Mage: the replacement pattern matches only your token unit play", () => {
  const kernel = world()
    .unit("zilean")
    .card("token", { zone: "chain", types: ["unit"], isToken: true })
    .card("ordinary-unit", { zone: "chain", types: ["unit"], isToken: false })
    .card("enemy-token", { zone: "chain", owner: "B", controller: "B", types: ["unit"], isToken: true })
    .card("gear-token", { zone: "chain", types: ["gear"], isToken: true })
    .build();
  const matches = id => actionMatchesEventPattern({
    pattern: replacement.replaces,
    action: { type: "play", player: kernel.getObject(id).controller, object: kernel.ref(id) },
    target: { object: kernel.ref(id) },
    hostRef: kernel.ref("zilean"),
    controller: "A",
    snapshotFor: ref => kernel.object(ref)
  });
  assert.equal(matches("token"), true);
  assert.equal(matches("ordinary-unit"), false);
  assert.equal(matches("enemy-token"), false);
  assert.equal(matches("gear-token"), false);
});

test.todo(
  "unl-086-219 Zilean, Time Mage: planner creates an additional token copy on Chain and plays both objects, " +
    "preserving the original play's modifications (CR 370.1 / 375)"
);
test.todo(
  "unl-086-219 Zilean, Time Mage: bind the card's once-each-turn declaration to EventPipeline.oncePerTurn " +
    "and keep may-decline available next time (CR 383.3.e / 386.1; contract change request)"
);
test.todo(
  "unl-086-219 Zilean, Time Mage: evaluate the source-at-battlefield Condition at replacement application, " +
    "including the source at Base (CR 464.2.b; RIFT-359 location-type predicate)"
);
