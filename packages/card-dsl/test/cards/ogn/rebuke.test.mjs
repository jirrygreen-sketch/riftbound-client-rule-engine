import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/rebuke.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-b729f880ae397e8eedd9b1e93aaab464d98abc273a98ec06ba2e03bf7c0c97a6";
const play = program.abilities.find((ability) => ability.kind === "play");
const [returnInstruction] = play.body;
const targetSpec = returnInstruction.targets[0];

const returnWithLockedTarget = (kernel, ref) =>
  runInstruction(
    zone,
    {
      target: returnInstruction.args.target.value,
      to: returnInstruction.args.to,
      amount: returnInstruction.args.amount
    },
    { world: kernel, targets: { [targetSpec.id]: [ref] } }
  );

test("ogn-172-298 Rebuke: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.timing/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Return a unit at a battlefield to its owner's hand."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-172-298 Rebuke: [Action] keyword plus one battlefield-scoped return target", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(returnInstruction.id, "rebuke.return-unit");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(targetSpec, {
    id: "rebuke.unit-at-battlefield",
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(returnInstruction.picks, undefined);
});

test("ogn-172-298 Rebuke golden: the unit returns to its OWNER's hand (108.1)", () => {
  const kernel = world()
    .unit("human-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("human-unit"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(kernel.getObject("human-unit").zone, "hand");
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["human-unit"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(run.linked.destination, "hand");
});

test("ogn-172-298 Rebuke golden: a stale battlefield target is ignored (359.3.e.6-e.8)", () => {
  const kernel = world()
    .unit("departing-unit", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("departing-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = returnWithLockedTarget(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("departing-unit").zone, "trash");
});

test.todo(
  "ogn-172-298 Rebuke: the 359.3.e.9 Rebuke example — a target that moved to its Base after " +
    "finalization must be Mistargeted by the location re-check — needs the TargetPlan resolve " +
    "re-check (RIFT-90); the [Action] Showdown permission needs the continuous.timing consumer " +
    "(RIFT-91) and the play adapter (RIFT-84/85)"
);
