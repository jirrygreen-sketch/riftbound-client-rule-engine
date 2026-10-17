import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sacrifice.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { readCost } from "../../../../engine-core/dist/cost/plan-values.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { mightyCondition } from "../../../../engine-core/dist/effects/keywords/Mighty.js";

const CANONICAL = "card.hash-33403d8f77f3caa9aa8f59a1a0290c3e349fe6a5893c3b812340601ac4a0629a";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "As an additional cost to play this, kill a friendly [Mighty] unit. (A unit is Mighty while it has 5+ :rb_might:.)\n" +
  "Draw 2 and channel 1 rune exhausted.";

const [speed, costAbility, play] = program.abilities;
const [drawInstruction, channelInstruction] = play.body;
// The reference kernel compares the controller placeholder verbatim, so the
// golden removes the declared TargetSpecs (none here) and runs the original
// body through the real interpreter.
const executableBody = play.body.map(({ targets, ...rest }) => rest);

test("unl-173-219 Sacrifice: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /356\.2\.a\.1/);
  assert.match(program.judgeReason, /mightGte/);
  assert.match(program.judgeReason, /706/);
  assert.match(program.judgeReason, /RIFT-89\/261/);
  assert.match(program.judgeReason, /translateCost/);
});

test("unl-173-219 Sacrifice: [Reaction] plus the mandatory Mighty-unit additional cost", () => {
  // 813: the printed [Reaction] permission is a keyword the registry expands.
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  // 356.2.a.1: "as an additional cost" without "may" is a Mandatory Additional
  // Cost; 355.10.c keeps the killed unit a non-target cost choice.
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "cost.additional");
  assert.equal(costAbility.effect.optional, false);
  assert.equal(costAbility.effect.stage, "mandatory-additional");
  assert.deepEqual(costAbility.effect.payments, [
    {
      kind: "kill",
      amount: { kind: "constant", value: 1 },
      choice: {
        id: "sacrifice.mighty-unit",
        options: ["dynamic:friendly-mighty-unit"],
        min: 1,
        max: 1,
        selection: "one",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          // 706-711 Mighty threshold; descriptive, no consumer yet (judgeReason).
          mightGte: 5
        }
      }
    }
  ]);
});

test("unl-173-219 Sacrifice: printed 1 energy and the unlinked Draw 2 / channel 1 exhausted body", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["sacrifice.draw", "effect.draw"],
      ["sacrifice.channel", "effect.channel"]
    ]
  );

  // 414.1/414.3: "Draw 2".
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  // 431.1 / 431.2.a: one rune with the printed "exhausted" entry stipulation.
  assert.deepEqual(channelInstruction.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  // "Draw 2 and channel 1 rune exhausted." is two independent actions joined by
  // "and": linking them would let a short deck suppress the channel (055).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(channelInstruction.targets, undefined);
});

test("unl-173-219 Sacrifice golden: the interpreter draws 2 and channels 1 rune exhausted", () => {
  const kernel = world().deck(["top", "second", "third"]).rune(["r1", "r2"]).build();
  const submitted = [];
  kernel.addReplacement((action) => {
    submitted.push(action);
    return null;
  });
  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["sacrifice.draw", "executed"],
      ["sacrifice.channel", "executed"]
    ]
  );
  assert.equal(kernel.player("A").handSize, 2);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top", "second"]);
  // 431.1 / 431.2: the top rune leaves the Rune Deck for the rune zone, and the
  // printed exhausted stipulation reaches the channel-rune action.
  assert.deepEqual(kernel.objectsInZone("A", "rune-zone").map((ref) => ref.id), ["r1"]);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(submitted, [
    { type: "draw", player: "A", amount: 2 },
    { type: "channel-rune", player: "A", amount: 1, exhausted: true }
  ]);
});

test("unl-173-219 Sacrifice golden: a short Rune Deck channels as much as possible (431.3)", () => {
  const kernel = world().deck("card").rune("only-rune").build();
  const outcome = resolveChainBody([executableBody[1]], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["sacrifice.channel.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 0);
});

test("unl-173-219 Sacrifice golden: the merged kill primitive performs the cost's non-target pick", () => {
  // 355.10.c: the Mighty cost unit is a pick, not a target; the merged
  // effect.kill consumes a PickSpec.
  const kernel = world()
    .unit("mighty", { owner: "A", might: 6 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .build();
  const run = runInstruction(
    kill,
    { picks: "sacrifice.mighty-unit" },
    { world: kernel, picks: { "sacrifice.mighty-unit": [kernel.ref("mighty")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [{ id: "mighty", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("mighty").zone, "trash");
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("unl-173-219 Sacrifice golden: the merged cost reader turns the declared payment into a real kill cost action", () => {
  // 356.2.a.1: the mandatory additional cost is a kill; the merged cost/plan-values
  // reader already supports the kill payment kind and the non-target choice
  // (355.10.c). The missing piece is only the card-declared cost -> plan wiring
  // (translateCost rejects kind "additional"), which is asserted below.
  const kernel = world()
    .unit("mighty", { owner: "A", might: 6, location: { type: "base", player: "A" } })
    .unit("small", { owner: "A", might: 2, location: { type: "base", player: "A" } })
    .build();
  kernel.setPicks("sacrifice.mighty-unit", [kernel.ref("mighty")]);
  const payment = costAbility.effect.payments[0];
  const amount = readCost(
    kernel.clone(),
    {
      kind: "explicit",
      payments: [
        {
          kind: "kill",
          amount: payment.amount,
          choice: {
            ...payment.choice,
            options: [kernel.ref("mighty"), kernel.ref("small")]
          }
        }
      ]
    },
    { id: "sacrifice" },
    "sacrifice.additional-cost"
  );
  assert.deepEqual(amount.actions.map((entry) => entry.action), [
    { type: "kill", object: kernel.ref("mighty") }
  ]);
});

test("unl-173-219 Sacrifice: the merged cost matcher ignores the declared [Mighty] threshold key", () => {
  // 706-711 / 143.2.a: a unit is Mighty at 5+ Might. The declared mightGte key is
  // not a filter dimension in the merged matchers: dropping it changes nothing,
  // so a 2-Might unit passes the filter the cost choice uses. This is the
  // evidence behind the judgeReason, which names the missing restriction.
  const { controller, ...costFilter } = costAbility.effect.payments[0].choice.filter;
  const withoutThreshold = Object.fromEntries(
    Object.entries(costFilter).filter(([key]) => key !== "mightGte")
  );
  const kernel = world()
    .unit("mighty", { owner: "A", might: 6, types: ["unit"] })
    .unit("small", { owner: "A", might: 2, types: ["unit"] })
    .build();
  for (const [id, expected] of [["small", true], ["mighty", true]]) {
    assert.equal(matchesObjectFilter(costFilter, kernel.getObject(id)), expected);
    // The threshold key makes no difference to the merged matcher.
    assert.equal(
      matchesObjectFilter(withoutThreshold, kernel.getObject(id)),
      matchesObjectFilter(costFilter, kernel.getObject(id))
    );
  }
  assert.equal(withoutThreshold.type, "unit");
  assert.equal(withoutThreshold.mightGte, undefined);

  // The merged Mighty predicate itself is evaluable, so the gap is the cost-choice
  // filter vocabulary, not the 708 threshold rule.
  assert.equal(
    resolveChainBody(
      [{ id: "predicate", op: "condition.predicate", args: { condition: { kind: "constant", value: mightyCondition({ canonicalCardId: CANONICAL }) } } }],
      kernel.clone({ sourceSnapshot: kernel.getObject("small") })
    ).results[0].result.linkedValues.value,
    false
  );
  assert.equal(
    resolveChainBody(
      [{ id: "predicate", op: "condition.predicate", args: { condition: { kind: "constant", value: mightyCondition({ canonicalCardId: CANONICAL }) } } }],
      kernel.clone({ sourceSnapshot: kernel.getObject("mighty") })
    ).results[0].result.linkedValues.value,
    true
  );
});

test.todo(
  "unl-173-219 Sacrifice: charge the mandatory 'kill a friendly [Mighty] unit' additional cost at Finalize " +
    "(CR 356.2.a/356.2.a.1, 355.10.c non-targeting cost) — the merged cost reader already builds the kill action; " +
    "the declared cost.additional still needs a program-side plan adapter (programs/play.ts translateCost rejects " +
    "kind \"additional\" with a judge-required ProgramBindingError), RIFT-89/261"
);

test.todo(
  "unl-173-219 Sacrifice: enforce the [Mighty] restriction on the cost choice — a unit is Mighty while it has " +
    "5+ Might (CR 706-711, 143.2.a effective Might) — the merged Mighty predicate and condition.predicate evaluate, " +
    "but CostPayment.choice filters do not consume a Condition, and the descriptive mightGte key stays silently ignored"
);

