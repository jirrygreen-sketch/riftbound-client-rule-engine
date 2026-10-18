import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vicious-snapjaws.js";
import { translateObjectFilter, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerObject } from "../../../../engine-core/dist/events/pipeline-match.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-ed7bafa7ae8c55236bdb4f3b21b17843836fdd9a22879336da866ccc90523a6f";
const SOURCE_TEXT = "When another friendly unit dies, gain 1 XP.";

const [ability] = program.abilities;
const [gainXp] = ability.body;

test("unl-129-219 Vicious Snapjaws: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-129-219 Vicious Snapjaws: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /429\.1/);
  assert.match(program.judgeReason, /exclude/);
  // The refreshed reason names the three observed consumers instead of the
  // (already merged) adapter and the batch number of a finished task.
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.match(program.judgeReason, /matchesTriggerObject/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-129-219 Vicious Snapjaws: object-killed trigger with the other-friendly-unit death filter", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 429.1 / 429.1.a.1: dying is a permanent leaving the Board for its Trash.
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "self", exclude: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-129-219 Vicious Snapjaws: the trigger's friendly part is the controller selector (740.1.a)", () => {
  // "friendly" is the shared-controller reading; events/pipeline-match.ts resolves the "self" player
  // selector for an object filter against the ability controller, so this half of the filter is the
  // merged spelling. The "another" half (the exclude anchor) is the part still missing (judgeReason).
  assert.equal(ability.trigger.filter.object.controller, "self");
  assert.equal(ability.trigger.filter.object.type, "unit");
  assert.equal(ability.trigger.filter.event, "object-killed");
});

test("unl-129-219 Vicious Snapjaws: the effect is a plain gain 1 XP (730.1 / 190.6.d)", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(gainXp.id, "vicious-snapjaws.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-129-219 Vicious Snapjaws golden: the effect really gains 1 XP for the ability controller", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["vicious-snapjaws.gain-xp", "executed"]
  ]);
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
  assert.equal(kernel.history({ action: "gain-xp", player: "A" }), 1);
});

test("unl-129-219 Vicious Snapjaws gap: the card-side filter translation rejects the exclude anchor", () => {
  // 740.1.a / 383.4.a.4: "another" must exclude the source itself. The merged
  // translators refuse the anchor, so the object-killed subscription cannot be
  // registered at all (the program adapter throws before any event runs).
  assert.throws(
    () => translateObjectFilter({ type: "unit", controller: "self", exclude: "self" }),
    /Unsupported filter field exclude/
  );
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "vicious-snapjaws", "object-killed"),
    /Unsupported filter field exclude/
  );
});

test("unl-129-219 Vicious Snapjaws gap: the trigger matcher has no exclude branch, so the host own death matches", () => {
  // events/pipeline-match.ts reads objectId/cardId/type/controller/owner/zone/
  // location/states/tags/characteristics only. Dropping the anchor and using the
  // remaining filter is NOT an approximation this card may make: the source own
  // death would then satisfy "another friendly unit". Pinned so the reason cannot
  // silently degrade into that over-trigger behaviour.
  const kernel = world().unit("snapjaws").unit("other").build();
  const source = kernel.getObject("snapjaws");
  const friendlyOnly = { type: "unit", controller: "self" };
  assert.equal(matchesTriggerObject(friendlyOnly, source, "A"), true);
  assert.equal(matchesTriggerObject(friendlyOnly, kernel.getObject("other"), "A"), true);
  assert.equal(matchesTriggerObject(friendlyOnly, kernel.getObject("other"), "B"), false);
});

test("unl-129-219 Vicious Snapjaws gap: the interpreter-level exclude anchor is unreachable from triggers", () => {
  // effects/interpreter/selectors.ts does implement exclude for set queries, but
  // only for instruction-level queries. It is not wired into trigger matching,
  // which is why the card keeps judge-required instead of claiming the filter
  // already works end to end.
  const kernel = world().unit("snapjaws").unit("other").build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("snapjaws"),
    source: kernel.ref("snapjaws"),
    controller: "A"
  });
  const environment = {
    context,
    query: filter => context.query(filter),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.deepEqual(
    queryObjects({ type: "unit", exclude: "self" }, environment).map(object => object.ref.id),
    ["other"]
  );
});

test("unl-129-219 Vicious Snapjaws gap: the card-side subscription really cannot register through the program binding", () => {
  // 383.4.a.4 / 740.1.a: the production path for a CardProgram trigger goes
  // through programs/triggers.ts -> programs/filters.ts. Running that real
  // adapter is what keeps the card judge-required: the exclude anchor is
  // rejected before any event can be observed, so no approximation exists that
  // would preserve "another". The kernel-side filter behaviour is covered by the
  // two tests above.
  const f = fixture();
  const { judgeReason: _reason, ...withoutReason } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...withoutReason, status: "executable" }] });
  const source = { ...f.kernel.getObject("source"), cardId: CARD_ID, name: "Vicious Snapjaws" };
  assert.throws(
    () => triggerRegistrations(binding.registry, source),
    /Unsupported filter field exclude/
  );
});
