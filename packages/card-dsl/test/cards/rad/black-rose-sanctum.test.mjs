import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/black-rose-sanctum.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-bb13774c245790dac24ea6928494dad2f51a511704b3a77b260531f06ae67788";
const [trigger] = program.abilities;

test("black-rose-sanctum: passes validateCardProgram and carries the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "For each player, the first time each turn a non-token unit they control dies here, they play a 1 :rb_might: Recruit unit token to their base."
  );
});

test("black-rose-sanctum: judgeReason names the per-player base, the per-player frequency and the play flow", () => {
  assert.match(program.judgeReason, /their base/);
  assert.match(program.judgeReason, /once/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("black-rose-sanctum: object-killed trigger for a non-token unit dying at this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "object-killed");
  assert.equal(trigger.trigger.filter.event, "object-killed");
  // The dying object is any player's unit; "here" (source battlefield),
  // the non-token restriction and the per-player window are descriptive
  // keys the merged EventPattern cannot express.
  assert.deepEqual(trigger.trigger.filter.object, { type: "unit", controller: "any" });
  assert.equal(trigger.trigger.filter.nonToken, true);
  assert.equal(trigger.trigger.filter.here, true);
  // The per-player-per-turn window cannot be expressed by TriggerSpec.once,
  // which is a single lifetime for the whole registration.
  assert.equal(trigger.trigger.once, undefined);
  assert.equal(trigger.trigger.filter.perPlayerFrequency, "once-per-turn");
  assert.equal(trigger.optional, false);
});

test("black-rose-sanctum: body plays the CR 187.1 Recruit token", () => {
  assert.equal(trigger.body.length, 1);
  const [instruction] = trigger.body;
  assert.equal(instruction.id, "black-rose-sanctum.play-recruit");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
});

test("black-rose-sanctum: the Recruit definition itself is a merged 1 Might token", () => {
  // The Recruit half of the effect is merged and must create the CR 187.1
  // token; asserting it keeps the blocked part (destination + play flow) from
  // hiding a definition error.
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "create" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [recruit] = kernel.query({ zone: "board" }).filter((object) => object.isToken);
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.tags, ["Recruit"]);
  assert.deepEqual(recruit.location, { type: "base", player: "A" });
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
});

test("black-rose-sanctum: the ability-controller base placeholder is not the printed semantics", () => {
  // effect.token rejects any Base other than the ability controller's, so the
  // authored placeholder cannot stand in for "the dying unit controller's
  // base"; this guards the documented gap instead of silently passing.
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "B" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.query({ zone: "board" }), []);
});

test.todo(
  "black-rose-sanctum: play the Recruit token into the dying unit controller's base " +
    "(the frozen create-token action carries no destination player)"
);
test.todo(
  "black-rose-sanctum: for-each-player first-time-each-turn frequency on a single card ability " +
    "(TriggerSpec.once is one lifetime for the whole registration)"
);
test.todo(
  "black-rose-sanctum: chain creation plus the finalized cost plan for playing the new token " +
    "(440.2.c / 185.2.a / 185.3.a.1; RIFT-89)"
);
