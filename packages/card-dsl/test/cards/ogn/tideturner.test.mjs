import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/tideturner.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { bindResolveContext } = await import(new URL("events/action-adapter.js", engineCore));

const CANONICAL = "card.hash-2e073bafe3ab30d9d490463b071263df4273ed757b8f819b07328932fa2b04a5";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, you may choose a friendly unit. Move me to its location and it to " +
  "my original location.";

const [keyword, triggered] = program.abilities;
const [swap] = triggered.body;
const [origin, chosenLocation, moveMe, moveChosen] = swap.args.body.value;

test("tideturner: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("tideturner: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /Facedown Zone/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("tideturner: [Hidden] keyword + play trigger with a choice.optional body", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);

  // CR 355.1/3.9: “you may choose a friendly unit” 的被选指令包在 body 里。
  assert.equal(swap.op, "choice.optional");
  assert.equal(swap.linkedTo, undefined);
  assert.deepEqual(
    swap.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [
      ["tideturner.origin", "condition.value"],
      ["tideturner.chosen-location", "condition.value"],
      ["tideturner.move-me", "effect.move"],
      ["tideturner.move-chosen", "effect.move"]
    ]
  );
});

test("tideturner: the friendly unit is a target and both original locations are locked first", () => {
  // CR 355.5/355.7: 需要指名一个游戏对象 → 目标。
  assert.equal(chosenLocation.targets.length, 1);
  const [spec] = chosenLocation.targets;
  assert.equal(spec.id, "friendly-unit");
  assert.deepEqual(spec.filter, { type: "unit", controller: "self" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");

  // CR 355.4 / 448.3: 两次移动的目的地都必须在移动前锁定，否则会读到移动后的位置。
  assert.deepEqual(origin.args.value, {
    kind: "object-property",
    object: "self",
    property: "location"
  });
  assert.deepEqual(origin.args.key, { kind: "constant", value: "origin" });
  assert.equal(origin.targets, undefined);
  assert.deepEqual(chosenLocation.args.value, {
    kind: "object-property",
    object: { target: "friendly-unit" },
    property: "location"
  });
  assert.deepEqual(chosenLocation.args.key, { kind: "constant", value: "chosenLocation" });

  // 两次 Move 都读链接值作为目的地；第二次移动读第一条锁定的原始位置。
  assert.deepEqual(moveMe.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(moveMe.args.to, {
    kind: "linked-value",
    instructionId: "tideturner.chosen-location",
    key: "chosenLocation"
  });
  assert.equal(moveMe.targets, undefined);
  assert.deepEqual(moveChosen.args.objects, {
    kind: "constant",
    value: { target: "friendly-unit" }
  });
  assert.deepEqual(moveChosen.args.to, {
    kind: "linked-value",
    instructionId: "tideturner.origin",
    key: "origin"
  });
  assert.deepEqual(moveChosen.targets, [spec]);
});

test("tideturner golden: accepting swaps the two units' locations", () => {
  const base = world()
    .unit("tideturner", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("tideturner") });
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "tideturner.swap/optional": true });

  const outcome = resolveChainBody(
    triggered.body,
    bindResolveContext(kernel, {
      query: filter => kernel.query({ ...filter, controller: filter.controller === "self" ? kernel.controller : filter.controller })
    })
  );
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["tideturner.origin", "executed"],
    ["tideturner.chosen-location", "executed"],
    ["tideturner.move-me", "executed"],
    ["tideturner.move-chosen", "executed"],
    ["tideturner.swap", "executed"]
  ]);
  assert.deepEqual(kernel.getObject("tideturner").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-1" });
  assert.equal(outcome.linkedValues["tideturner.swap/tideturner.move-me.movedMe"].count, 1);
  assert.equal(outcome.linkedValues["tideturner.swap/tideturner.move-chosen.movedChosen"].count, 1);
});

test("tideturner golden: declining performs no move", () => {
  const base = world()
    .unit("tideturner", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("tideturner") });
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "tideturner.swap/optional": false });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["tideturner.swap"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.getObject("tideturner").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(outcome.events, []);
});

test("tideturner: the merged trigger adapter binds only this card's play event", async () => {
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  assert.deepEqual(translateTriggerFilter(triggered.trigger.filter, "tideturner", "card-played"), {
    event: "card-played", object: { objectId: "tideturner" }
  });
});

test.todo("Tideturner: Hidden Hide/Facedown Zone and next-turn Reaction/0 Energy play (CR 811.1.b–d / 811.5; location integration RIFT-357)");
test.todo("Tideturner: Finalize the optional nested friendly-unit targets through the real chain before the original swap body resolves (CR 355.5 / 355.12; assertFinalizationSurface)");
