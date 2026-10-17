import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hush.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: counter } = await import(new URL("effects/instructions/effect.counter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-9687e50570fa9c4d346613c3c24b7a3647f366f42940e8d43d23361879fe9935";
const [keyword, play] = program.abilities;
const counterInstruction = play.body[0];

const chainSpell = (kernel, id = "enemy-spell") =>
  kernel.addObject(
    {
      ref: { id, zoneEntryId: 1 },
      owner: "B",
      zone: "chain",
      types: ["spell"],
      name: "Enemy Spell"
    },
    "chain"
  );

test("rad-041-167 Hush: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Counter a spell with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more."
  );
});

test("rad-041-167 Hush: judge-required naming the missing Power-cost threshold check", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.8|355\.17\.b|355\.9\.b/);
  assert.match(program.judgeReason, /filter/);
  assert.match(program.judgeReason, /Finalize|锁定前/);
  assert.match(program.judgeReason, /powerCost|Power/);
});

test("rad-041-167 Hush: [Reaction] plus a chain-spell counter with the printed cost restriction recorded", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.body.length, 1);

  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "hush.spell" },
    amount: { kind: "constant", value: 1 }
  });
  // "a spell" means a finalized object on the Chain (355.9.a.2).
  assert.deepEqual(counterInstruction.targets, [
    {
      id: "hush.spell",
      filter: { type: "spell", zone: "chain" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "with Power cost [rainbow][rainbow] or more" is a targeting restriction
  // (355.9.b). It is recorded in the IR shapes the contract offers (a compare
  // condition reading the spell's Power cost), but neither can be enforced at
  // Finalize today — see judgeReason.
  assert.deepEqual(counterInstruction.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { target: "hush.spell" },
      property: "powerCost"
    },
    operator: "gte",
    right: { kind: "constant", value: 2 }
  });
  assert.equal(counterInstruction.linkedTo, undefined);
});

test("rad-041-167 Hush golden: the counter removes a Chain spell (CR 426.1-426.3)", () => {
  const kernel = world().build();
  const ref = chainSpell(kernel);
  const run = runInstruction(
    counter,
    { target: "hush.spell", amount: counterInstruction.args.amount },
    { world: kernel, targets: { "hush.spell": [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  // A countered card does nothing and leaves the Chain; costs are not refunded.
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
});

test("rad-041-167 Hush boundary: a non-Chain object is not a legal counter target (355.9.a.2)", () => {
  const kernel = world().unit("board-unit", { owner: "B" }).build();
  const run = runInstruction(
    counter,
    { target: "hush.spell", amount: counterInstruction.args.amount },
    { world: kernel, targets: { "hush.spell": [kernel.ref("board-unit")] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("board-unit").zone, "board");
});

test("rad-041-167 Hush boundary: a spell that already left the Chain ignores the counter (359.3.e.5-e.7)", () => {
  const kernel = world().build();
  const ref = chainSpell(kernel);
  kernel.perform({ type: "counter", object: ref });
  const run = runInstruction(
    counter,
    { target: "hush.spell", amount: counterInstruction.args.amount },
    { world: kernel, targets: { "hush.spell": [ref] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "rad-041-167 Hush: the 'Power cost [rainbow][rainbow] or more' restriction (355.9.b) needs a " +
    "Finalize-time targeting restriction; the merged filter pipeline (layers/filter.ts) has no " +
    "numeric comparator, an instruction condition is evaluated only after targets lock " +
    "(yielding skipped, not an illegal finalize per 355.8/355.17.b), and ObjectSnapshot.power is a " +
    "domain list rather than a numeric Power cost"
);
test.todo(
  "rad-041-167 Hush: after the Power-cost target threshold is enforceable at Finalize, execute full CardProgram " +
    "Reaction play in Closed State, pay 1 Energy + 2 Power, and counter only a legal 2-or-more-Power spell"
);
