import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/fading-memories.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-14d6255fe1976a488bb687562e989583b5f23cc0d020651042bf3573f790809b";
const play = program.abilities[0];
const [grantInstruction] = play.body;
const [targetSpec] = grantInstruction.targets;

test("ogn-180-298 Fading Memories: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.equal(
    program.sourceText,
    "Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start " +
      "of its controller's Beginning Phase, before scoring.)"
  );
});

test("ogn-180-298 Fading Memories: one Temporary grant over the printed unit-or-gear choice", () => {
  // No speed keyword: the printing has no [Action]/[Reaction] line.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  assert.equal(grantInstruction.id, "fading-memories.grant-temporary");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args, {
    keyword: { kind: "constant", value: "Temporary" },
    objects: { kind: "constant", value: { kind: "target", id: "fading-memories.unit-or-gear" } }
  });
  assert.equal(grantInstruction.linkedTo, undefined);
  assert.equal(grantInstruction.picks, undefined);

  // "a unit at a battlefield or a gear": a single object choice admitting both
  // shapes (the unit's Location restriction stays descriptive, see judgeReason).
  assert.deepEqual(targetSpec, {
    id: "fading-memories.unit-or-gear",
    filter: { zone: "board", type: ["unit", "gear"] },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("Fading Memories grant sub-body gives Temporary to a battlefield unit or Base gear", () => {
  for (const type of ["unit", "gear"]) {
    const f = fixture({
      cards: [{ id: "target", types: [type], might: type === "unit" ? 2 : null }],
      choose: request => request.type === "select-objects"
        ? [request.options.find(ref => ref.id === "target")] : undefined
    });
    const location = type === "unit" ? { type: "battlefield", id: "battlefield-1" } : { type: "base", player: "A" };
    f.engine.commit({ type: "move-zone", object: f.kernel.ref("target"), to: location.type, location });
    f.engine.advance();
    // Only the grant is executable. These are legal members of the printed
    // choice; the full disjunctive target gate and Temporary trigger stay TODO.
    f.engine.execute(f.draft("temporary-grant-sub-body", { body: play.body }));
    resolveAll(f.engine);
    assert.deepEqual(f.engine.layers.snapshot(f.kernel.ref("target")).keywords, [{ id: "Temporary", value: undefined }]);
    assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").map(event => event.object.ref.id), ["target"]);
    f.engine.emit({ timingPoint: "turn-end", player: "A" });
    assert.deepEqual(f.engine.layers.snapshot(f.kernel.ref("target")).keywords, [{ id: "Temporary", value: undefined }]);
  }
});

test.todo("Fading Memories: disjunctive unit-at-battlefield-or-gear targets (RIFT-359) and live Temporary grant/revocation trigger registration (CR 816.1.b/816.1.c)");
