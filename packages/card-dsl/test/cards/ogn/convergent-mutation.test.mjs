import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/convergent-mutation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-6d70f12e2dfb5fbc2398e27f4f4f03110c0310091884499b782107d95b9d6c65";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit. This turn, increase its Might to the Might of another friendly unit.";

const speed = program.abilities[0];
const play = program.abilities[1];
const [setMight] = play.body;

test("Convergent Mutation program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap (contract 3.1 / README §2): the
  // unmerged continuous.might set path and the unresolved reference rules.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /355\.7/);
  assert.match(program.judgeReason, /479\.4\.b/);
});

test("Convergent Mutation identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Convergent Mutation structure: [Reaction] and the described Might-set effect", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), ["convergent-mutation.set-might"]);

  // "increase its Might to the Might of another friendly unit" is a set
  // arithmetic effect (479.4.b uses this exact phrasing as its snapshotting
  // example); the op is the unmerged layers effect, not a Buff.
  assert.equal(setMight.op, "continuous.might");
  assert.deepEqual(setMight.args.mode, { kind: "constant", value: "set" });
  assert.deepEqual(setMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(setMight.args.value, {
    kind: "object-property",
    object: { target: "another-friendly-unit" },
    property: "might"
  });
  assert.deepEqual(setMight.args.appliesTo, { kind: "constant", value: "chosen-unit" });
});

test("Convergent Mutation structure: the chosen unit and the referenced unit are declared separately", () => {
  // Both readings of the second clause need one friendly unit as the affected
  // object and one other friendly unit as the Might reference; "another"
  // excludes the chosen unit, and neither may be the same object.
  assert.deepEqual(setMight.targets, [
    {
      id: "chosen-unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    },
    {
      id: "another-friendly-unit",
      filter: { type: "unit", controller: "self", other: true },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(setMight.linkedTo, undefined);
});

test.todo(
  "Convergent Mutation: executing 'increase its Might to the Might of another friendly " +
    "unit this turn' needs the layers continuous.might set mode with end-of-turn expiry " +
    "via ctx.addContinuous (RIFT-91) plus 479.4.b snapshotting (锁定取值)."
);

test.todo(
  "Convergent Mutation: resolving which friendly unit is referenced, whether it is " +
    "Targeted (355.7) and when the choice is made (355.3/355.5) needs a rules ruling " +
    "and the target system (RIFT-90); the source text does not state the chooser."
);

test.todo(
  "Convergent Mutation: [Reaction] admission and its three continuous.timing grants " +
    "(813.1.b) are chain + layer work (RIFT-91), not card data."
);
