import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/zilean-time-mage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { actionMatchesEventPattern } from "../../../../engine-core/dist/replacement/pattern.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-0edf62a2fa247fc8feb7ea57978657018d5be55376452b2c4173a7170526aa61";
const SOURCE_TEXT =
  "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token " +
  "and an additional copy of it instead.";

const [replacement] = program.abilities;
const [rewrite] = replacement.with;

function boundZilean() {
  const f = fixture({ cards: [
    { id: "zilean", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: ["Mind"], zone: "board", location: { type: "base", player: "A" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("zilean"), to: "board", location: { type: "base", player: "A" } });
  return f;
}

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
  assert.match(program.judgeReason, /oncePerTurn|Once each turn|386\.1/);
  assert.match(program.judgeReason, /386\.1/);
  assert.match(program.judgeReason, /oncePerTurn/);
  assert.match(program.judgeReason, /planner/);
  assert.match(program.judgeReason, /source-at-a-battlefield/);
  assert.match(program.judgeReason, /ObjectFilter 的 location 键/);
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
  // condition (464.2.b); this descriptive constant still needs an executable
  // source-location predicate before the full program can be executable.
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

test("unl-086-219 Zilean, Time Mage: the production binder cannot plan the two-play rewrite (gap 2)", () => {
  // Evidence for gap (2): replacement/planner.ts has no
  // replacement.play-with-additional-copy mapping, so the production binder
  // fails loudly instead of guessing a Token-plus-copy play (CR 370.1 / 375).
  const f = boundZilean();
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindReplacement(replacement, f.kernel.getObject("zilean")),
    /Unsupported replacement opcode: replacement\.play-with-additional-copy/
  );
});

test("unl-086-219 Zilean, Time Mage: the card declaration carries no once-per-turn bridge (gap 1)", () => {
  // Evidence for gap (1): EventPipeline.oncePerTurn exists, but the card-side
  // replacement shape has no field that reaches it, and replacement.event's
  // window vocabulary has no per-turn-resetting value either (CR 383.3.e/386.1).
  assert.equal(Object.hasOwn(replacement, "oncePerTurn"), false);
  assert.equal(Object.hasOwn(replacement, "optional"), false);
  assert.equal(rewrite.args.window, undefined);
});

test("unl-086-219 Zilean, Time Mage: the descriptive condition is constant true, not a location predicate (gap 3)", () => {
  // Evidence for gap (3): the descriptive constant is evaluated as a truthy
  // constant, so the merged Condition vocabulary cannot distinguish the source
  // at a battlefield from the source at Base (CR 464.2.b).
  const atBattlefield = world()
    .unit("zilean", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const atBase = world()
    .unit("zilean", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const environment = kernel => ({
    context: kernel,
    host: kernel.ref("zilean"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  });
  assert.equal(evaluateCondition(replacement.condition, environment(atBattlefield)), true);
  assert.equal(evaluateCondition(replacement.condition, environment(atBase)), true,
    "the descriptive constant cannot express the 'while I'm at a battlefield' gate");
});

test("unl-086-219 Zilean, Time Mage: an object filter cannot read the source's own location either (gap 3)", () => {
  // Evidence for gap (3): the merged ObjectFilter location key describes the
  // queried object's own location, so counting it cannot express a gate on the
  // ability source; the count below is true for unrelated reasons.
  const kernel = world()
    .unit("zilean", { zone: "board", location: { type: "base", player: "A" } })
    .unit("other", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const condition = {
    kind: "compare",
    left: { kind: "count", subject: "objects", filter: { type: "unit", location: "battlefield" } },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  };
  const environment = {
    context: Object.assign(Object.create(Object.getPrototypeOf(kernel)), kernel, {
      query: filter => kernel.objects.filter(object => (filter.location === undefined ||
        (object.location !== null && object.location.type === filter.location)) &&
        (filter.type === undefined || object.types.includes(filter.type)))
    }),
    host: kernel.ref("zilean"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(evaluateCondition(condition, environment), true,
    "an unrelated battlefield unit satisfies the count while the source sits at Base");
});

test.todo(
  "unl-086-219 Zilean, Time Mage: planner creates an additional token copy on Chain and plays both objects, " +
    "preserving the original play's modifications (CR 370.1 / 375)"
);
test.todo(
  "unl-086-219 Zilean, Time Mage: bind the card's once-each-turn declaration to EventPipeline.oncePerTurn " +
    "and keep may-decline available next time (CR 383.3.e / 386.1; card-dsl ReplacementAbility field)"
);
test.todo(
  "unl-086-219 Zilean, Time Mage: evaluate the source-at-battlefield source-location predicate at replacement " +
    "application, including the source at Base (CR 464.2.b; no Expr or Condition can read the ability source's location)"
);
