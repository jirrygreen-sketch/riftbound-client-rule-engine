import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/altar-to-unity.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("ogn-275-298 Altar to Unity: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-275-298 Altar to Unity: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-275-298) carries this text verbatim.
  assert.equal(
    program.sourceText,
    "When you hold here, play a 1 :rb_might: Recruit unit token in your base."
  );
  // The unresolved part is the controller-relative base destination.
  assert.match(program.judgeReason, /base/);
  assert.match(program.judgeReason, /kind:'location'/);
  assert.match(program.judgeReason, /effect\.token/);
});

test("ogn-275-298 Altar to Unity: mandatory hold trigger playing a CR 187.1 Recruit token", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.d.1: "When you hold here" = this battlefield's controller holds
  // here (timing point "hold", CR 315.2.b.2 / 471.2 / 473.2.b).
  assert.equal(ability.trigger.at, "hold");
  // "held" is the validator's event name; "here" and "controller" stay as the
  // printed scope until the binding layer can express this battlefield.
  assert.deepEqual(ability.trigger.filter, { event: "held", here: true, player: "controller" });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "altar-to-unity.play-recruit");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: "play a … token" creates it on the Chain and hands
  // it to the play action.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
});

test("ogn-275-298 Altar to Unity: the merged primitive plays a 1 Might Recruit token (CR 187.1/440.2.c)", () => {
  const kernel = world().build();
  const base = { type: "base", player: "A" };
  // Substitute only the unresolvable controller-relative base with the
  // concrete seat the ability's controller occupies; everything else is the
  // card's own printed token, amount and play mode.
  const run = runInstruction(
    token,
    {
      ...instruction.args,
      location: { kind: "constant", value: base }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [recruit] = created;
  assert.equal(recruit.isToken, true);
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.tags, ["Recruit"]);
  assert.deepEqual(recruit.location, base);
  assert.equal(recruit.controller, "A");
  // CR 185.3.a / 185.3.b: tokens have no costs and no domains — null printed
  // characteristics, never 0.
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
});

test.todo(
  "ogn-275-298 Altar to Unity: playing the token into 'your base' needs a controller-relative " +
    "LocationRef inside effect.token's own Expr vocabulary: its isExpr has no kind:'location' " +
    "member (contract change request), while the merged resolveLocationSelector already provides " +
    "the semantics. The program keeps the printed placeholder spelling until that dependency lands."
);

test.todo(
  "ogn-275-298 Altar to Unity: the hold trigger still cannot register: the held emission " +
    "(turn/flow.ts Score wave) carries no object for 'here' to anchor, and no merged field can " +
    "express this battlefield's scope (here:true is rejected by events/trigger-spec.ts and by " +
    "the binding layer), so player:'self' would only approximate the controller's every hold."
);
