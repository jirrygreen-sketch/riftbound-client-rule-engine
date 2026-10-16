import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/noxian-guillotine-darius.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-c973c5f4508531db7ec8b07e87359987755e8136cf2abb7b2e92df957e1ff837";

const keywords = program.abilities.filter(ability => ability.kind === "keyword");
const play = program.abilities.find(ability => ability.kind === "play");
const legionCheck = play.body[0];
const killNow = play.body[1];
const killLater = play.body[2];
const targetSpec = killNow.targets[0];

test("ogn-254-298 Noxian Guillotine: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The em dash in the printed Legion line is preserved verbatim (U+2014).
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Choose a unit. Kill it the next time it takes damage this turn.\n" +
      "[Legion] \u2014 Kill it now instead. (Get the effect if you've played another card this turn.)"
  );
  assert.ok(program.sourceText.includes("\u2014"));
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-254-298 Noxian Guillotine judgeReason names the delayed trigger, Legion and replacement gaps", () => {
  assert.match(program.judgeReason, /392/);
  assert.match(program.judgeReason, /registerDelayedTrigger/);
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /condition\.history/);
  assert.match(program.judgeReason, /158\.2/);
});

test("ogn-254-298 Noxian Guillotine structure: [Action] + [Legion] with the two exclusive kill clauses", () => {
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "action" },
    { kind: "keyword", keyword: "legion" }
  ]);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "guillotine-legion-check",
    "guillotine-kill-now",
    "guillotine-kill-later"
  ]);

  // The Legion condition (812.1.b.1/812.1.c) is a same-turn play-history check
  // that must exclude this card; the merged condition.history primitive does not
  // yet accept the contract 3.8 `excluding` payload.
  assert.equal(legionCheck.op, "condition.history");
  assert.deepEqual(legionCheck.args.query.value, {
    scope: "turn",
    action: "play",
    player: "controller",
    excluding: CARD_ID
  });
  assert.deepEqual(legionCheck.args.operator, { kind: "literal", value: "gte" });
  assert.deepEqual(legionCheck.args.right, { kind: "literal", value: 1 });
  assert.equal(legionCheck.linkedTo, undefined);

  // Both kill clauses read the Legion result and are mutually exclusive
  // (CR 158.2's ruling for this exact card).
  assert.equal(killNow.op, "effect.kill");
  assert.deepEqual(killNow.args.target, { kind: "literal", value: "guillotine-unit" });
  assert.equal(killNow.targets.length, 1);
  assert.equal(targetSpec.id, "guillotine-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.deepEqual(killNow.condition, {
    kind: "compare",
    left: { kind: "linked-value", instructionId: "guillotine-legion-check", key: "value" },
    operator: "eq",
    right: { kind: "literal", value: true }
  });

  assert.equal(killLater.id, "guillotine-kill-later");
  assert.deepEqual(killLater.args.timing, { kind: "literal", value: "next-time-takes-damage" });
  assert.deepEqual(killLater.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(killLater.condition, {
    kind: "not",
    condition: {
      kind: "compare",
      left: { kind: "linked-value", instructionId: "guillotine-legion-check", key: "value" },
      operator: "eq",
      right: { kind: "literal", value: true }
    }
  });
  assert.deepEqual(killLater.targets, undefined);
});

test("ogn-254-298 Noxian Guillotine golden: the merged kill half kills the chosen unit immediately", () => {
  const kernel = world().unit("guillotine-target", { owner: "B" }).build();
  const locked = kernel.ref("guillotine-target");

  const run = runInstruction(
    kill,
    { target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("guillotine-target").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
  assert.deepEqual(run.result.linkedValues.killed, [locked]);
  assert.equal(kill.op, "effect.kill");
});

test("ogn-254-298 Noxian Guillotine golden: a unit that already left the board cannot be killed", () => {
  const kernel = world().unit("fleeing-target", { owner: "B" }).build();
  const stale = kernel.ref("fleeing-target");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = runInstruction(
    kill,
    { target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("fleeing-target").zone, "hand");
});

test.todo(
  "Noxian Guillotine: registering the delayed 'kill it the next time it takes damage this turn' " +
    "trigger needs a primitive that calls ResolveContext.registerDelayedTrigger with a " +
    "next-time scope and an end-of-turn expiry (CR 392; RIFT-120 batch 4 / RIFT-91 duration)."
);

test.todo(
  "Noxian Guillotine: the [Legion] predicate needs condition.history to accept contract 3.8's " +
    "exclude/objectFilter fields so 812.1.c's \"a card different than the one with the Legion " +
    "ability\" can be enforced (RIFT-82 / RIFT-89)."
);

test.todo(
  "Noxian Guillotine: 'Kill it now instead' must negate the earlier delayed-kill instruction of the " +
    "same spell (CR 158.2 / 367); no merged primitive performs instruction-level replacement."
);
