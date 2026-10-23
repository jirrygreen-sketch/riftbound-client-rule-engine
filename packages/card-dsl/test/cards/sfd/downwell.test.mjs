import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/downwell.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { planReplacementBody } from "../../../../engine-core/dist/replacement/planner.js";
import { BlockedReplacementError } from "../../../../engine-core/dist/replacement/types.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL = "card.hash-2d4fa47f98b9d923f7ff215e0893e6d748e4c5b8f906b289eacc50e0f83769db";
const SOURCE_TEXT = "Return all units and gear to their owners' hands.";

const [play] = program.abilities;
const [returnInstruction] = play.body;

test("sfd-147-221 Downwell: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-147-221 Downwell: judgeReason names the missing non-target set form", () => {
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.zone/);
  // RIFT-260 landed the replacement binding, but its planner still maps
  // effect.zone through the target spelling only, so the reason names that
  // concrete consumer instead of the landed task number.
  assert.doesNotMatch(program.judgeReason, /RIFT-260/);
  assert.match(program.judgeReason, /requires exactly one of target or pick/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-147-221 Downwell: no speed keyword is printed; the cost is 8 energy + 2 Chaos power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(
    program.abilities.some((ability) => ability.kind === "keyword"),
    false
  );
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 8 },
    power: { kind: "constant", value: 2 }
  });
});

test("sfd-147-221 Downwell: the printed set is described, not declared as targets", () => {
  assert.equal(play.body.length, 1);
  assert.equal(returnInstruction.id, "downwell.return-all");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, undefined);
  // 355.10.d / 355.10.d.1: "all units and gear" is programmatically selected,
  // so no player choice is declared. TargetSpec would fire became-target
  // triggers (355.7, 754); PickSpec would still ask for an unprinted choice.
  assert.equal(returnInstruction.targets, undefined);
  assert.equal(returnInstruction.picks, undefined);
  assert.deepEqual(returnInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: ["unit", "gear"], zone: "board" }
    }
  });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
});

test("sfd-147-221 Downwell golden: the owner-routed return half really works on every card", () => {
  // The card's `to` and amount are real, but its non-target set descriptor is
  // not consumed by the merged effect.zone (see judgeReason). The golden run
  // therefore supplies an explicit pick for the supported action only and
  // executes the card's own destination/amount, proving 056.1's owner routing
  // for both units and gear on both sides of the table.
  const kernel = world()
    .unit("ally-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], location: { type: "base", player: "B" } })
    .unit("stolen-gear", { owner: "A", controller: "B", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const locked = [kernel.ref("ally-unit"), kernel.ref("enemy-gear"), kernel.ref("stolen-gear")];
  const run = runInstruction(
    zone,
    { pick: "downwell.returned", to: returnInstruction.args.to },
    { world: kernel, picks: { "downwell.returned": locked } }
  );

  // effect.zone requires exactly one of target/pick, so the set is supplied as
  // a pick only to isolate the supported return action; the card itself
  // declares neither (355.10.d).
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand", "return-to-hand", "return-to-hand"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["ally-unit", "stolen-gear"]);
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["enemy-gear"]);
  assert.equal(kernel.getObject("ally-unit").zone, "hand");
  assert.equal(kernel.getObject("enemy-gear").zone, "hand");
  assert.equal(kernel.getObject("stolen-gear").zone, "hand");
});

test.todo(
  "sfd-147-221 Downwell: map the supported effect.zone query selector through the replacement planner " +
    "(355.10.d/355.10.d.1); the runtime primitive already consumes { kind: 'query', filter }"
);

test("sfd-147-221 Downwell: the printed non-target set descriptor executes through effect.zone", () => {
  const kernel = world()
    .unit("ally-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const context = bindResolveContext(kernel, {
    query: filter => kernel.objects.filter(object => matchesObjectFilter(filter, object))
  });
  const result = zone.execute(context, zone.argsSchema.parse(returnInstruction.args));
  assert.equal(result.status, "executed");
  assert.deepEqual(result.linkedValues.movedObjects.map(ref => ref.id).sort(), ["ally-unit", "enemy-gear"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["ally-unit"]);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["enemy-gear"]);
  assert.deepEqual(kernel.objects.filter(object => object.zone === "board").map(object => object.ref.id), []);

  // The replacement planner still needs the same query selector translation.
  assert.throws(
    () => planReplacementBody(play.body, { hostRef: kernel.ref("ally-unit"), replacedObject: null, usedWindow: false }, {
      evaluate: expression => expression.value,
      controller: "A",
      object: () => kernel.ref("ally-unit")
    }),
    (error) => error instanceof BlockedReplacementError && /plan-time selector binding is unavailable: query/.test(error.message)
  );
  assert.equal(program.status, "judge-required");
});
