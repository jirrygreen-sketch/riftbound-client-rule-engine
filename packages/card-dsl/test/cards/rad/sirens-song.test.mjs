import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/sirens-song.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import reaction from "../../../../engine-core/dist/effects/keywords/Reaction.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-4192b981ea612f380ed34cb8529363e9618f8f512b964c7c2d22a1323d4ef7e9";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Move an enemy unit that moved this turn.";

const [keyword, play] = program.abilities;
const [moveInstruction] = play.body;

test("Siren's Song program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Siren's Song identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /moved-this-turn/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Siren's Song structure: [Reaction], printed cost, one targeted Move", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 2 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(moveInstruction.id, "sirens-song.move-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "sirens-song.moved-enemy-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  // The printed destination is a runtime location choice, so the structure
  // records the descriptive marker named in judgeReason.
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.equal(moveInstruction.targets.length, 1);
  assert.equal(moveInstruction.targets[0].id, "sirens-song.moved-enemy-unit");
  assert.deepEqual(moveInstruction.targets[0].filter, {
    type: "unit",
    controller: "opponent",
    movedThisTurn: true
  });
  assert.equal(moveInstruction.targets[0].selection, "one");
});

test("Siren's Song execution: the [Reaction] keyword resolves to the merged definition and effect.move really relocates a unit", () => {
  // 810/813 family: [Reaction] is a permissive keyword, declared by the card and
  // expanded by the keyword registry.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keywordDefinitionsById.get("Reaction"), reaction);

  // The Move half runs through the merged effect.move primitive with a concrete
  // destination (the printed destination is the part named in judgeReason).
  const targetLocation = { type: "battlefield", id: "bf-2" };
  const kernel = world().unit("enemy", { owner: "B", controller: "B", might: 3 }).build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "sirens-song.moved-enemy-unit" } },
      to: { kind: "constant", value: targetLocation },
      amount: moveInstruction.args.amount
    },
    { world: kernel, targets: { "sirens-song.moved-enemy-unit": [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(kernel.getObject("enemy").location, targetLocation);
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
  // The Move history is observable, which is the raw material the missing target
  // predicate would read (CR 449).
  assert.equal(kernel.history({ action: "move-location", object: kernel.ref("enemy") }), 1);
});

test.todo(
  "Siren's Song: 'an enemy unit that moved this turn' needs a moved-this-turn target predicate " +
    "(CR 449 / 355.9.b) — HistoryQuery cannot restrict target legality; the object-moved timing point " +
    "itself is already emitted by the event pipeline"
);

test.todo(
  "Siren's Song: the destination of 'Move an enemy unit' is a runtime location choice " +
    "(CR 355.4 / 355.4.a / 451.1) and needs an IR channel evaluating the legal destinations " +
    "(effect.move 'to' only accepts static LocationRefs or static candidate lists)"
);
