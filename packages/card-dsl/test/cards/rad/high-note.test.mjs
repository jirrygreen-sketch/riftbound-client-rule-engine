import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/high-note.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-94a6c9fbd1c07987c118b3c37993744abe6442237b9355dfa3faf6771ca2da54";
const [reaction, play] = program.abilities;
const [mightInstruction] = play.body;
const targetSpec = mightInstruction.targets[0];

test("rad-048-167 High Note: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Give a unit –:rb_might: this turn equal to the number of exhausted units you control."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-048-167 High Note: judgeReason names the missing temporary Might primitive", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /end-of-turn/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /415\.2/);
});

test("rad-048-167 High Note: structure — Reaction keyword, printed energy 3 and no power", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("rad-048-167 High Note: structure — negative Might equal to the exhausted friendly units", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "high-note.give-minus-might");
  // The temporary Might change is a layers effect, not a Buff counter (702);
  // the op is the unmerged continuous.might (judgeReason).
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });

  const amount = mightInstruction.args.amount;
  assert.equal(amount.kind, "arithmetic");
  assert.equal(amount.operator, "neg");
  assert.equal(amount.operands.length, 1);
  const [count] = amount.operands;
  assert.equal(count.kind, "count");
  assert.equal(count.subject, "exhausted-units-you-control");
  // 415.2: exhausted is a state that can be referenced; "you control" is the
  // controller restriction.
  assert.deepEqual(count.filter, { type: "unit", controller: "you", states: "exhausted" });

  // "a unit" is a target (355.9.b), not a pick.
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("rad-048-167 High Note: the exhausted-unit count filter is not evaluable by the reference kernel", () => {
  // The authored filter is "units you control that are exhausted". Neither
  // half is evaluable today: the reference kernel's filter matcher has no
  // `states` key, and the `controller: "you"` spelling is resolved by the
  // production chain/layers normalization, not by the kernel. Asserting this
  // limitation keeps the count from looking like verified execution; the
  // filter's meaning stays with the unmerged condition/predicate path.
  const kernel = world()
    .unit("exhausted-mine", { owner: "A", exhausted: true })
    .unit("ready-mine", { owner: "A", exhausted: false })
    .unit("exhausted-theirs", { owner: "B", controller: "B", exhausted: true })
    .build();
  const count = mightInstruction.args.amount.operands[0];
  assert.deepEqual(count.filter, { type: "unit", controller: "you", states: "exhausted" });

  // The kernel compares `controller` literally (no "you"/"self" resolution)
  // and ignores `states`, so the filter matches nothing there: the count is
  // descriptive data, never a silent match. Production normalization for
  // these spellings lives in chain/engine.ts + layers/filter.ts.
  assert.equal(kernel.query(count.filter).length, 0);
  // The exhausted characteristic itself is readable on the snapshot (415.2),
  // which is what the eventual count path will consume.
  assert.equal(kernel.getObject("exhausted-mine").exhausted, true);
  assert.equal(kernel.getObject("ready-mine").exhausted, false);
  assert.equal(kernel.getObject("exhausted-theirs").exhausted, true);
});

test.todo(
  "rad-048-167 High Note: 'Give a unit –Might this turn equal to the number of exhausted units you " +
    "control' needs the continuous.might layers consumer with an end-of-turn duration, plus its " +
    "resolution-time count query — RIFT-91 (layers/continuous.might)."
);

test.todo(
  "rad-048-167 High Note: the printed [Reaction] timing permission is granted by the Reaction keyword " +
    "expansion together with chain admission and Closed-State play checks — RIFT-85/RIFT-89 (chain + " +
    "continuous.timing)."
);
