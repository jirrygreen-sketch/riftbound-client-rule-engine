import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/factory-recall.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-2e4b5dab6b8ccc7a18ef91f2c2fd8b2ecdad0af08019aec16c521e322a2fac36";
const SOURCE_TEXT = "[Action] (Play on your turn or in showdowns.)\nReturn a gear to its owner's hand.";

const [speed, play] = program.abilities;
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

test("sfd-135-221 Factory Recall: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-135-221 Factory Recall: [Action] keyword plus the printed 1 energy cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(speed.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
});

test("sfd-135-221 Factory Recall: one targeted gear returned to its owner's hand", () => {
  assert.equal(play.body.length, 1);
  assert.equal(returnInstruction.id, "factory-recall.return-gear");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.equal(returnInstruction.picks, undefined);
  assert.deepEqual(returnInstruction.args.target, {
    kind: "constant",
    value: "factory-recall.gear"
  });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });

  // 355.7 / 355.9.a.1: "a gear" is a Board object the caster chooses, so it is
  // a Target. No controller is printed, so both players' gear are candidates.
  assert.deepEqual(targetSpec, {
    id: "factory-recall.gear",
    filter: { type: "gear", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-135-221 Factory Recall golden: an enemy gear returns to its OWNER's hand (056.1)", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("enemy-gear"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(kernel.getObject("enemy-gear").zone, "hand");
  // 056.1/056.2: the card goes to its owner's Hand, not the caster's.
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["enemy-gear"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(run.linked.destination, "hand");
});

test("sfd-135-221 Factory Recall golden: a friendly gear also returns to the owner's hand", () => {
  const kernel = world()
    .unit("friendly-gear", { owner: "A", controller: "A", types: ["gear"], location: { type: "base", player: "A" } })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("friendly-gear"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["friendly-gear"]);
  assert.equal(kernel.getObject("friendly-gear").zone, "hand");
});

test("sfd-135-221 Factory Recall golden: a stale gear reference is ignored (359.3.e.6-e.8)", () => {
  const kernel = world()
    .unit("departing-gear", { owner: "B", controller: "B", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const stale = kernel.ref("departing-gear");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = returnWithLockedTarget(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("departing-gear").zone, "trash");
});

test.todo(
  "sfd-135-221 Factory Recall: the printed [Action] Showdown permission must be enforced through the " +
    "continuous.timing consumer and a CardProgram -> ChainDraft play adapter " +
    "(chain/engine.ts describePlay, contract 3.7) — RIFT-91 / RIFT-84"
);

test.todo(
  "sfd-135-221 Factory Recall: the real kernel must run the 448.2/455 zone-change bookkeeping when a gear " +
    "leaves the Board for Hand (attachment cleanup, zone-change timing points); the reference kernel only " +
    "relocates the object"
);
