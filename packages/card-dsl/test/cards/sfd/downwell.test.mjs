import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/downwell.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-90/);
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
  // so no TargetSpec / PickSpec may be declared; declaring one would fire
  // became-target triggers (355.7, 754) for objects nobody chose.
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
  // therefore locks the intended set the way the production Finalize would and
  // executes the card's own destination/amount, proving 056.1's owner routing
  // for both units and gear on both sides of the table.
  const kernel = world()
    .unit("ally-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const locked = [kernel.ref("ally-unit"), kernel.ref("enemy-gear")];
  const run = runInstruction(
    zone,
    { pick: "downwell.returned", to: returnInstruction.args.to },
    { world: kernel, picks: { "downwell.returned": locked } }
  );

  // effect.zone requires exactly one of target/pick, so the set is supplied as
  // a pick exactly as the production Finalize would lock it; the card itself
  // declares neither (355.10.d).
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand", "return-to-hand"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["ally-unit"]);
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["enemy-gear"]);
  assert.equal(kernel.getObject("ally-unit").zone, "hand");
  assert.equal(kernel.getObject("enemy-gear").zone, "hand");
});

test("sfd-147-221 Downwell fail-closed: the descriptive set descriptor is rejected, never targeted", () => {
  // Executing the card's own args must fail instead of falling back to a
  // TargetSpec for every unit and gear (which would fire became-target rules).
  const kernel = world()
    .unit("ally-unit", { owner: "A", controller: "A" })
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"] })
    .build();

  assert.throws(
    () => runInstruction(zone, returnInstruction.args, { world: kernel }),
    /effect\.zone requires exactly one of target or pick/
  );
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(kernel.objectsInZone("B", "hand"), []);
  assert.equal(kernel.events.length, 0);
});

test.todo(
  "sfd-147-221 Downwell: 'Return all units and gear to their owners' hands' needs a non-target set form of " +
    "effect.zone (355.10.d/355.10.d.1) — the merged primitive consumes only ctx.targets / ctx.picks. The " +
    "effect.ready / effect.heal { kind: 'query', filter } descriptor is the intended shape; the replacement " +
    "planner (RIFT-260) likewise maps effect.zone only through its target spelling."
);
