import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram, EFFECT_IR_V2_RULESET } from "@riftbound/card-dsl";
import Vision from "../../../dist/effects/keywords/Vision.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../dist/chain/interpreter-adapter.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "unl-089-219" };
// The expanded body's player arg is constant("A"), the reference test kernel's
// default player.
const SELECT_REQUEST_ID = "vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck");

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Vision]"
  };
}

function expansion(value) {
  return Vision.expand(value === undefined ? { host: HOST } : { value, host: HOST });
}

function visionBody() {
  return expansion()[0].body;
}

/**
 * Run the Vision body's Predict step against the reference test kernel.
 * Use the production chain argument adapter and the original expanded body.
 * Ordered picks come from zoneSlice using the expanded instruction's amount;
 * viewing and recycling still run through their primitives on each resolution.
 * Neither the test nor inspect treats query insertion order as deck order.
 */
function runVision(kernel, chosen = []) {
  const body = visionBody();
  const { value: picksId } = body[0].args.picksSpecId;
  const { value: amount } = body[0].args.amount;
  kernel.setPicks(picksId, kernel.zoneSlice("A", "deck", "top", amount).map(object => object.ref));
  kernel.setAnswers({ [SELECT_REQUEST_ID]: chosen });
  return resolveChainBody(body, kernel);
}

test("definition: non-valued keyword with v1.5 rule refs and separate stacking (817.2)", () => {
  assert.equal(Vision.keyword, "Vision");
  assert.equal(Vision.valued, false);
  assert.equal(Vision.stacking, "separate");
  for (const ref of ["817", "817.1", "817.1.b", "817.1.c", "817.2", "817.3", "437.1", "437.3", "437.3.a", "437.4"]) {
    assert.ok(Vision.ruleRefs.includes(ref), `missing ruleRef ${ref}`);
  }
});

test("expands to one triggered ability at object-enters-board (817.1.c)", () => {
  const abilities = expansion();
  assert.equal(abilities.length, 1);
  const ability = abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-enters-board");
  assert.ok(typeof ability.trigger.filter === "object" && ability.trigger.filter !== null);
  const body = ability.body;
  assert.equal(body.length, 2);
  assert.equal(body[0].op, "effect.inspect");
  assert.equal(body[0].args.amount.value, 1, "437.3.a: Predict without a number looks at 1");
  assert.deepEqual(body[0].args.picksSpecId, { kind: "constant", value: "vision-top" });
  assert.deepEqual(body[0].args.chooseCount.value, { min: 0, max: 1 }, "437.1: may recycle it (0..1)");
  assert.equal(body[1].op, "effect.recycle");
  assert.equal(body[1].args.objects.kind, "linked");
  assert.equal(body[1].args.objects.instructionId, "vision-look");
  assert.equal(body[1].linkedTo, "vision-look");
});

test("expansion passes validateCardProgram inside a minimal CardProgram", () => {
  const result = validateCardProgram(wrapProgram([...expansion()]));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("stacking separate: each Vision copy expands to its own independent ability (817.2)", () => {
  const first = expansion();
  const second = expansion();
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0], second[0], "separate instances are distinct abilities");
  assert.deepEqual(first[0], second[0]);
});

test("valued boundary: a spurious value is ignored, expansion stays value-free", () => {
  const withValue = expansion(2);
  const without = expansion();
  assert.deepEqual(withValue, without);
  assert.equal(withValue.length, 1);
});

test("executed: recycling the seen top card moves it to the deck bottom (437.1)", () => {
  // The ordered inspect pool comes from zoneSlice, so the player can only
  // choose the actual top card that effect.inspect has viewed.
  // Query's stable id order and the actual deck order deliberately disagree.
  const kernel = world().deck(["z-top-seen", "a-rest"]).hand(HOST.canonicalCardId).build();
  const top = kernel.zone("A", "deck")[0];
  const outcome = runVision(kernel, [top]);
  assert.equal(outcome.status, "executed");
  // Predict 1: looked at exactly one card (amount 1) and chose to recycle it.
  assert.equal(outcome.linkedValues["vision-look.inspected"], 1);
  assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], [top]);
  assert.deepEqual(outcome.linkedValues["vision-look.vision-recycle"], [top]);
  assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["look", "recycle"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["a-rest", "z-top-seen"]);
  assert.equal(kernel.object(top), null, "recycling changes the zone-bound reference");
});

test("executed: declining to recycle keeps the card on top (817.2.a choice)", () => {
  const kernel = world().deck("rest").deck("top-seen").hand(HOST.canonicalCardId).build();
  const top = kernel.zone("A", "deck")[0];
  const outcome = runVision(kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], [top]);
  assert.deepEqual(outcome.linkedValues["vision-look.vision-recycle"], []);
  assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["look"]);
  // Player chose not to recycle; the top card stays on top (437.1 choice).
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-seen", "rest"]);
  // 817.2.b: a separate Vision instance sees the same card if it is kept.
  const second = runVision(kernel);
  assert.deepEqual(second.linkedValues["vision-look.vision-picked"], [top]);
});

test("boundary: empty deck Predict looks at 0 cards without Burn Out (437.4 / 437.4.a)", () => {
  const kernel = world().hand(HOST.canonicalCardId).build();
  const outcome = runVision(kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["vision-look.inspected"], 0, "no cards seen on an empty deck, no Burn Out");
  assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], []);
  assert.deepEqual(outcome.linkedValues["vision-look.vision-recycle"], []);
  assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], 0);
  assert.deepEqual(outcome.events, []);
});

test("separate Vision resolutions refresh the top pick after a recycle (817.2.a)", () => {
  const kernel = world().deck(["first", "second"]).hand(HOST.canonicalCardId).build();
  const first = kernel.ref("first");
  const second = kernel.ref("second");
  assert.equal(runVision(kernel, [first]).status, "executed");
  const outcome = runVision(kernel, [second]);
  assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], [second]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["first", "second"]);
});

test("registry exposes the Vision definition by keyword id", () => {
  assert.equal(keywordDefinitionsById.get("Vision"), Vision);
});
