// Partial execution evidence for the merged counter primitive is consolidated
// in ../templates/keyword-play-effect-counter-676.test.mjs and extended by
// Hush's own per-card scenario row in
// ../templates/keyword-play-effect-counter-699.test.mjs; Hush's printed
// Power-cost restriction remains judge-required until Finalize can compare it.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hush.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: counter } = await import(new URL("effects/instructions/effect.counter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", engineCore));
const { evaluateCondition } = await import(new URL("effects/interpreter/condition.js", engineCore));
const { finalizeTargetPlan, queryTargetCandidates } = await import(new URL("target/target-plan.js", engineCore));
const { translateRequirements, translateRestriction } = await import(new URL("programs/play.js", engineCore));

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
  // Second-sweep refresh: RIFT-359's merged printed-characteristic predicate can
  // really read a numeric printed Power, so the reason must name the remaining
  // gap (no Finalize legality adapter) instead of that predicate.
  assert.match(program.judgeReason, /printed-characteristic/);
  assert.match(program.judgeReason, /translateRequirements|translateRestriction/);
});

test("rad-041-167 Hush: [Reaction] plus a chain-spell counter with the printed cost restriction recorded", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 2 }
  });
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

test("rad-041-167 Hush gap: the Finalize target plan still admits a 1-Power Chain spell (355.9.b)", () => {
  // Evidence for the remaining gap: the merged TargetRequirement surface has no
  // numeric comparator, so the printed "Power cost >= 2" restriction cannot
  // reject a 1-Power Chain spell before targets lock (355.8/355.17.b). The
  // observed production behavior is the gap; nothing here is asserted as the
  // card's semantics.
  const kernel = world().build();
  kernel.addObject(
    { ref: { id: "cheap", zoneEntryId: 1 }, owner: "B", zone: "chain", types: ["spell"], name: "Cheap", power: ["Fury"] },
    "chain"
  );
  const requirement = counterInstruction.targets[0];
  const candidates = queryTargetCandidates(kernel, requirement, { isPending: () => false });
  assert.deepEqual(candidates, [{ id: "cheap", zoneEntryId: 1 }]);
  assert.deepEqual(
    finalizeTargetPlan(kernel, requirement, { isPending: () => false, selected: candidates }).selected,
    candidates
  );
  // ObjectSnapshot keeps `power` as a Domain list; the authored numeric read
  // has no characteristic to read.
  assert.deepEqual(kernel.getObject("cheap").power, ["Fury"]);
  assert.equal(Object.hasOwn(kernel.getObject("cheap"), "powerCost"), false);
  kernel.setTargets("hush.spell", [kernel.ref("cheap")]);
  assert.throws(
    () => evaluateCondition(counterInstruction.condition, {
      context: kernel, linked: () => undefined, canLookBack: () => true, isIgnored: () => false
    }),
    /Unavailable characteristic: powerCost/
  );
});

test("rad-041-167 Hush gap: the merged printed-power predicate is readable but not a Finalize restriction", () => {
  // RIFT-359 merged the event-printed characteristic predicate, and it really
  // compares a printed Power value carried by an event payload...
  const predicate = {
    kind: "printed-characteristic",
    object: "target",
    characteristic: "power",
    operator: "gte",
    right: { kind: "constant", value: 2 }
  };
  const environment = (event) => ({
    context: world().build(), event, linked: () => undefined, canLookBack: () => true, isIgnored: () => false
  });
  assert.equal(evaluateCondition(predicate, environment({ target: { printedPower: 2 } })), true);
  assert.equal(evaluateCondition(predicate, environment({ target: { printedPower: 1 } })), false);
  // ...but the Finalize legality path rejects the kind, so it cannot exclude a
  // 0/1-Power spell before the target is locked (355.8/355.17.b).
  assert.throws(() => translateRequirements([predicate], "hush"), /needs a rules adapter/);
  assert.throws(() => translateRestriction(predicate, "hush"), /needs a rules adapter/);
});

test.todo(
  "rad-041-167 Hush: the 'Power cost [rainbow][rainbow] or more' restriction (355.9.b) needs a " +
    "Finalize-time targeting restriction: target/target-plan.ts still has no numeric comparator " +
    "(a 1-Power Chain spell Finalizes as a legal target today) and the merged printed-characteristic " +
    "predicate is rejected by programs/play.ts's requirement/restriction translation"
);
test.todo(
  "rad-041-167 Hush: after the Power-cost target threshold is enforceable at Finalize, execute full CardProgram " +
    "Reaction play in Closed State, pay 1 Energy + 2 Power, and counter only a legal 2-or-more-Power spell"
);
