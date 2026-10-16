import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/trusty-ramhound.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f";
const [ability] = program.abilities;

test("sfd-159-221 Trusty Ramhound: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "While you have another unit here, I have +1 :rb_might:."
  );
});

test("sfd-159-221 Trusty Ramhound: one static arithmetic Might effect on self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 143.2.a / 475-477: Might is altered in the arithmetic layer, not via a
  // Buff counter (702).
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
});

test("sfd-159-221 Trusty Ramhound: 'another unit you control here' condition shape", () => {
  const condition = ability.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-units-here");
  // 355.9.c "another" excludes the source; 359.3.f "here" is its location.
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    other: true,
    sameLocationAs: "self"
  });
});

test("sfd-159-221 Trusty Ramhound: the merged arithmetic layer adds the declared +1 Might", () => {
  // RIFT-91's layer engine consumes the declared continuous.might effect when a
  // caller registers it; this executes the real arithmetic path for the amount
  // this card declares. The "while you have another unit here" gate itself stays
  // TODO (the layer condition vocabulary cannot evaluate a count condition).
  const kernel = world()
    .unit("ramhound", { zone: "board", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = kernel.getObject("ramhound");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "trusty-ramhound.might",
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "ramhound" },
        effect: { kind: "continuous.might", mode: "add", amount: { kind: "constant", value: 1 } }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 3);
});

test.todo(
  "sfd-159-221 Trusty Ramhound: evaluate the 'while you have another unit here' gate — the merged " +
    "layer engine's conditionMatches returns true for every non-type/has-tag/has-keyword condition, so " +
    "count/compare plus sameLocationAs/other predicates and card-program continuous registration are " +
    "required (RIFT-91 follow-up, RIFT-32/33 layer scenarios)"
);
