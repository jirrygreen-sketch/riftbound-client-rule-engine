import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/against-the-odds.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ce4f294fc93a34896d001feda8ba9d15d051f2ea01bf0c84a56036243102b3fa";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a friendly unit at a battlefield +2 :rb_might: this turn for each enemy unit there.";

const [speed, play] = program.abilities;
const [might] = play.body;
const unitSpec = might.targets[0];

/**
 * The production chain normalizes the `opponent` controller placeholder before
 * matching (chain/engine.ts), and the interpreter resolves the `sameLocationAs`
 * anchor in `queryObjects`. The bare reference kernel does neither, so the
 * count expression is evaluated with that same normalization here.
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.objects.filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const expressionEnvironment = (kernel) => ({
  context: kernel,
  query: chainQuery(kernel, "A"),
  linked: () => undefined,
  canLookBack: () => false,
  isIgnored: () => false
});

test("sfd-001-221 Against the Odds: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-001-221 Against the Odds: judge-required for the unmerged temporary Might primitive", () => {
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual missing op and rule, not a complaint.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /addContinuous/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /702/);
});

test("sfd-001-221 Against the Odds: [Reaction] plus the per-enemy-unit Might instruction", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 2 energy, no printed Power (never rewritten as 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 1);

  // "+2 Might this turn for each enemy unit there": the amount is the merged
  // arithmetic expression 2 x (enemy units at the chosen unit's location).
  assert.equal(might.op, "continuous.might");
  assert.deepEqual(might.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(might.args.amount, {
    kind: "arithmetic",
    operator: "multiply",
    operands: [
      { kind: "constant", value: 2 },
      {
        kind: "count",
        subject: "units",
        filter: {
          type: "unit",
          controller: "opponent",
          sameLocationAs: { target: "against-the-odds.unit" }
        }
      }
    ]
  });

  // "a friendly unit at a battlefield": one controlled Board unit whose
  // location is a battlefield (355.10.b: the battlefield itself is not a
  // target, so the restriction is the merged TargetRequirement.location).
  assert.equal(might.targets.length, 1);
  assert.equal(unitSpec.id, "against-the-odds.unit");
  assert.deepEqual(unitSpec.filter, { type: "unit", controller: "controller" });
  assert.deepEqual(unitSpec.location, { type: "battlefield" });
  assert.equal(unitSpec.min, 1);
  assert.equal(unitSpec.max, 1);
  assert.equal(unitSpec.selection, "one");
});

test("sfd-001-221 Against the Odds: the per-enemy amount is 2 per enemy unit at the chosen unit's location", () => {
  // The count expression is evaluated when the instruction would execute, so it
  // reads the state at resolution (359.3.f.2). This pins the merged evaluator's
  // behaviour for the recorded amount expression without executing the unmerged
  // continuous.might op.
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("friendly")]);

  // Two enemy units sit at the chosen unit's battlefield and the third sits at
  // another one, so "+2 Might for each enemy unit there" is +4.
  assert.equal(evaluateExpression(might.args.amount, expressionEnvironment(kernel)), 4);
});

test("sfd-001-221 Against the Odds: an enemy unit that left the location stops counting (359.3.f.2)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("friendly")]);
  assert.equal(evaluateExpression(might.args.amount, expressionEnvironment(kernel)), 4);

  // Move one enemy unit away: the amount is re-read at resolution time.
  kernel.perform({
    type: "move-location",
    object: kernel.ref("enemy-two"),
    to: { type: "battlefield", id: "bf-2" }
  });
  assert.equal(evaluateExpression(might.args.amount, expressionEnvironment(kernel)), 2);
});

test.todo(
  "sfd-001-221 Against the Odds: applying +2 Might per enemy unit there in the arithmetic layer " +
    "and expiring it at end of turn (143.2.a / 317.2.c / 433.1.a) needs the card-facing " +
    "continuous.might instruction primitive and its duration wiring (RIFT-91 follow-up)."
);

test.todo(
  "sfd-001-221 Against the Odds: the printed [Reaction] Closed-State play permission (813, 159.2.b) " +
    "needs the keyword expansion plus the chain's canAct timing query (RIFT-83 / RIFT-85)."
);

test.todo(
  "sfd-001-221 Against the Odds: Finalize-time target locking restricted to a battlefield " +
    "(355.3, 355.10.b, 420.3.b.2) and the became-target trigger belong to the target system (RIFT-90)."
);
