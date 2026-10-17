import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sandshifter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL = "card.hash-6c5e86a11835553c21b709846a47353de46fcea93be21041ecaf6f4a50b1ecd7";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-158-221 Sandshifter: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /TargetPlan/);
  // RIFT-359 has merged; it added event/result predicates, not an effective-
  // Might threshold on ObjectFilter, so it must no longer be listed as the gap.
  assert.match(program.judgeReason, /RIFT-359 已合入/);
  assert.match(program.judgeReason, /event-printed-characteristic/);
  assert.ok(!/依赖：RIFT-359/.test(program.judgeReason), "a merged task must not stay as the dependency");
  assert.doesNotMatch(program.judgeReason, /RIFT-81|RIFT-32\/33/);
  assert.equal(
    program.sourceText,
    "When you play me, kill an enemy unit with 3 :rb_might: or less."
  );
});

test("sfd-158-221 Sandshifter: card-played self trigger with one enemy-unit kill", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(instruction.id, "sandshifter.kill-weak-enemy");
  assert.equal(instruction.op, "effect.kill");
  assert.deepEqual(instruction.args.target, {
    kind: "constant",
    value: "sandshifter.weak-enemy-unit"
  });
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "sandshifter.weak-enemy-unit");
  assert.equal(target.filter.type, "unit");
  assert.equal(target.filter.controller, "opponent");
  assert.equal(target.filter.zone, "board");
  assert.equal(target.filter.mightLte, 3);
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("sfd-158-221 Sandshifter: the merged kill primitive resolves a locked target", () => {
  const kernel = world()
    .unit("shifter", { zone: "board" })
    .player("B")
    .unit("weak-enemy", { zone: "board", might: 2, owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    kill,
    { target: "sandshifter.weak-enemy-unit" },
    { world: kernel, targets: { "sandshifter.weak-enemy-unit": [kernel.ref("weak-enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [{ id: "weak-enemy", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("weak-enemy").zone, "trash");
});

test("sfd-158-221 Sandshifter: a unit that left the board makes the kill ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("shifter", { zone: "board" })
    .player("B")
    .unit("weak-enemy", { zone: "board", might: 2, owner: "B", controller: "B" })
    .build();
  const stale = kernel.ref("weak-enemy");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    kill,
    { target: "sandshifter.weak-enemy-unit" },
    { world: kernel, targets: { "sandshifter.weak-enemy-unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "sfd-158-221 Sandshifter: enforce the '3 :rb_might: or less' target ceiling at Finalize/Resolve " +
    "(355.9.b / 143.2.a effective-Might predicate) once an effective-Might threshold predicate is " +
    "merged into ObjectFilter/TargetPlan; RIFT-359's event/result predicates do not cover it"
);

test("sfd-158-221 Sandshifter: TargetPlan filters are equality-only, so a Might ceiling remains judge-required", () => {
  // Evidence for the judgeReason: TargetPlan reaches the merged layer matcher,
  // whose Might characteristic comparison is equality-only (characteristics: {
  // might: N }). "3 or less" therefore has no target-query spelling, and the
  // card's descriptive mightLte key is outside the production filter translator.
  const kernel = world()
    .unit("weak-enemy", { owner: "B", controller: "B", might: 2 })
    .unit("exactly-three", { owner: "B", controller: "B", might: 3 })
    .unit("strong-enemy", { owner: "B", controller: "B", might: 6 })
    .build();
  const objects = kernel.objects;

  assert.deepEqual(
    objects
      .filter((object) => matchesObjectFilter({ type: "unit", characteristics: { might: 2 } }, object))
      .map((object) => object.ref.id),
    ["weak-enemy"]
  );
  assert.deepEqual(
    objects
      .filter((object) => matchesObjectFilter({ type: "unit", characteristics: { might: 3 } }, object))
      .map((object) => object.ref.id),
    ["exactly-three"]
  );

  // The production translator round-trips exactly the fields the engine knows.
  assert.deepEqual(
    translateObjectFilter({ type: "unit", zone: "board", controller: "opponent" }),
    { type: "unit", zone: "board", controller: "opponent" }
  );
  assert.throws(
    () => translateObjectFilter({ type: "unit", zone: "board", controller: "opponent", mightLte: 3 }),
    /Unsupported filter field mightLte/
  );
});

test("sfd-158-221 Sandshifter: the RIFT-359 predicate set does not add a Might threshold to target filters", () => {
  // Live re-verification of the judgeReason: the merged predicates operate on
  // event payloads and finalized cost/result receipts, so a target requirement
  // can still not express "effective Might 3 or less". A near-threshold unit is
  // returned by the only filter shape the translator accepts.
  const kernel = world()
    .unit("weak-enemy", { owner: "B", controller: "B", might: 2 })
    .unit("over-threshold", { owner: "B", controller: "B", might: 4 })
    .build();

  // The chain normalizes controller/owner "self"/"opponent" before it calls
  // this matcher, so the card's own filter shape is asserted by translation:
  // the only accepted spelling is the controller-relative one.
  assert.deepEqual(
    translateObjectFilter({ type: "unit", zone: "board", controller: "opponent" }),
    { type: "unit", zone: "board", controller: "opponent" }
  );
  // That accepted filter carries no Might comparison at all, so both the weak
  // unit and the unit above the printed ceiling satisfy it.
  const matches = kernel.objects
    .filter((object) => matchesObjectFilter({ type: "unit", zone: "board" }, object))
    .map((object) => object.ref.id);
  assert.deepEqual(matches, ["weak-enemy", "over-threshold"]);
  for (const key of ["mightLte", "mightGte", "is-mighty"]) {
    assert.throws(
      () => translateObjectFilter({ type: "unit", zone: "board", controller: "opponent", [key]: 3 }),
      /Unsupported filter field/,
      `${key} must still be rejected by the production translator`
    );
  }
});
