import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/onslaught.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Card bodies and filters run through the chain's own interpreter adapter — the
// production entry point that re-wraps Expr arguments for the registered
// primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-3d956150539f05acad046c9b3b303490605a2e9f9546aa9bc58fb0b8256412a9";
const SOURCE_TEXT =
  "Give a unit +6 :rb_might: this turn.\n" +
  "[Flow] :rb_energy_4: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [givePlusSix] = play.body;
const [unitSpec] = givePlusSix.targets;

test("ven-081-166 Onslaught: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-081-166 Onslaught: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-081-166 Onslaught: judgeReason names the missing Might op and the Flow gaps", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /Flow/);
  assert.match(program.judgeReason, /RIFT-260\/261/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-081-166 Onslaught: [Flow] keyword plus one +6 Might instruction on one Board unit", () => {
  assert.equal(program.abilities.length, 2);
  // 829.1.a: Flow is present on Spells and is a passive keyword; the card only
  // declares the keyword identity (README section 5).
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });

  assert.equal(play.kind, "play");
  // Printed base cost 4 Energy; the catalog's power is null (no printed Power),
  // which is never rewritten as 0 (README section 2).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["onslaught.give-plus-6", "continuous.might"]
  ]);

  // 143.2.a / 317.2.c: a temporary Might change with a this-turn duration; the
  // op that would register it is named in judgeReason.
  assert.deepEqual(givePlusSix.args, {
    amount: { kind: "constant", value: 6 },
    duration: { kind: "constant", value: "this-turn" },
    target: { kind: "constant", value: "onslaught.unit" }
  });
  assert.equal(givePlusSix.linkedTo, undefined);
  assert.equal(givePlusSix.condition, undefined);

  // 355.7 / 355.9.a.1 / 355.9.b: "a unit" is one chosen Board unit and no
  // controller restriction is printed.
  assert.deepEqual(unitSpec, {
    id: "onslaught.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(givePlusSix.picks, undefined);
});

test("ven-081-166 Onslaught: the declared unit filter really selects Board units", () => {
  // The Might instruction's op is not registered (judgeReason), so the filter
  // is exercised through the real interpreter query path instead.
  const kernel = world()
    .unit("board-unit", { owner: "A", controller: "A", might: 4 })
    .card("spell-in-trash", { owner: "A", zone: "trash", types: ["spell"] })
    .build();
  const outcome = resolveChainBody(
    [
      {
        id: "onslaught.probe",
        op: "condition.value",
        args: {
          value: { kind: "count", subject: "unit", filter: unitSpec.filter }
        }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  // Only the Board unit matches: the Trash card is not on the Board.
  assert.equal(outcome.linkedValues["onslaught.probe.value"], 1);
});

test.todo(
  "ven-081-166 Onslaught: give one unit +6 Might this turn in the arithmetic layer, expiring at " +
    "cleanup (CR 143.2.a / 317.2.c / 478.1.a) — needs the card-facing continuous.might instruction " +
    "that registers through ResolveContext.addContinuous (RIFT-258 on top of the RIFT-91 layers engine); " +
    "effect.buff only counts Buffs (702/703) and is never used as a substitute"
);

test.todo(
  "ven-081-166 Onslaught: play this from Trash for its printed Flow cost (:rb_energy_4:) and banish it " +
    "afterwards (CR 829.1 / 829.1.b / 829.1.c.1) — needs the RIFT-261 alternate-cost consumer for a " +
    "separate selectable Flow instance plus the RIFT-260 replacement registration that sends the " +
    "finalized Flow spell to Banishment"
);
