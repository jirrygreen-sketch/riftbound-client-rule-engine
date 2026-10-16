import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vi-destructive.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51";

test("ogn-036-298 Vi, Destructive: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /ganking/i);
});

test("ogn-036-298 Vi, Destructive: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "Recycle 1 from your trash: Give me +1 :rb_might: this turn."
  );
});

test("ogn-036-298 Vi, Destructive: Ganking keyword plus an action-speed activated recycle-for-Might ability", () => {
  assert.equal(program.abilities.length, 2);
  const [ganking, activated] = program.abilities;
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });

  assert.equal(activated.kind, "activated");
  // No printed [Action]/[Reaction] permission: units default to action timing.
  assert.equal(activated.timing, "action");
  assert.equal(activated.restriction, undefined);

  // "Recycle 1 from your trash" is a cost (417.3), declared through the frozen
  // CostSpec payment shape; the printed part is the trash zone and owner.
  assert.deepEqual(activated.cost.payments, [
    {
      kind: "recycle",
      choice: {
        id: "vi-destructive.trash-card",
        options: ["card-in-controller-trash"],
        zone: "trash",
        owner: "controller",
        min: 1,
        max: 1,
        selection: "one"
      }
    }
  ]);

  assert.equal(activated.body.length, 1);
  const [instruction] = activated.body;
  assert.equal(instruction.id, "vi-destructive.might-1");
  assert.equal(instruction.op, "continuous.might");
  assert.equal(instruction.args.amount.value, 1);
  assert.equal(instruction.args.duration.value, "end-of-turn");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "self" });
});

test("ogn-036-298 Vi, Destructive: the unmerged Might instruction is not a registered primitive opcode", () => {
  // Guard against silently approximating the temporary Might change: today there
  // is no consumable continuous.might instruction, so a body run must fail
  // rather than mutating any state.
  const kernel = world().unit("vi", { might: 3, exhausted: true }).build();
  assert.throws(
    () => runAbilityBody(program.abilities[1].body, kernel),
    /Unregistered instruction opcode: continuous\.might/
  );
  assert.equal(kernel.getObject("vi").might, 3);
  assert.equal(kernel.events.length, 0);
});

test.todo(
  "ogn-036-298 Vi, Destructive: execute 'Give me +1 :rb_might: this turn' as an end-of-turn " +
    "continuous.might change and assert the derived Might and expiry (layers, RIFT-91)"
);
test.todo(
  "ogn-036-298 Vi, Destructive: pay the 'Recycle 1 from your trash' cost through buildCostPlan/payCostPlan " +
    "and assert the trash card moves to the deck bottom while gating activation legality (RIFT-89 cost planned " +
    "payments + RIFT-91 movement permission for Ganking)"
);
