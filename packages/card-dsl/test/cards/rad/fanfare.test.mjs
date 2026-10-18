import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/fanfare.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-45b35ce91632cff6c42bf5bb1a2d9e4df42b52e6f58126dec199ced7ce391739";
const [play] = program.abilities;
const [registration] = play.body;

test("rad-047-167 Fanfare: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "The next three times you play a unit this turn, draw 1.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-047-167 Fanfare: judgeReason names the delayed-trigger primitive and the use counter", () => {
  // The reason must name the actual gap (README section 2): the unmerged
  // delayed-trigger registration, TriggerSpec.once's missing use counter, and
  // the end-of-turn expiry task.
  assert.match(program.judgeReason, /registerDelayedTrigger/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
  assert.match(program.judgeReason, /per-turn/);
  assert.match(program.judgeReason, /expiresAt/);
});

test("rad-047-167 Fanfare: structure — printed energy 3, no power, one delayed-trigger registration", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // energy 3 with power null: the printed power is absent, so the cost carries
  // no power field at all — never 0.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  assert.equal(play.body.length, 1);
  assert.equal(registration.id, "fanfare.register-delayed-trigger");
  assert.equal(registration.op, "trigger.delayed");
  assert.equal(registration.linkedTo, undefined);
  assert.equal(registration.targets, undefined);
  assert.equal(registration.picks, undefined);
  // The delayed trigger is bounded to the printed three uses, the current turn,
  // and unit plays by this controller.
  assert.deepEqual(registration.args.uses, { kind: "constant", value: 3 });
  assert.deepEqual(registration.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(registration.args.at, { kind: "constant", value: "card-played" });
  assert.deepEqual(registration.args.eventFilter, {
    kind: "constant",
    value: { event: "card-played", player: "self", object: { type: "unit" } }
  });
  assert.equal(registration.args.body.kind, "constant");
  assert.equal(registration.args.body.value.length, 1);
  assert.deepEqual(registration.args.body.value[0], {
    id: "fanfare.draw",
    op: "effect.draw",
    args: { amount: { kind: "constant", value: 1 } }
  });
});

test("rad-047-167 Fanfare: the delayed trigger's body draws 1 through the merged primitive", () => {
  // The registration itself is the unmerged half (test.todo below). The
  // instruction the delayed trigger would execute is a merged effect.draw with
  // the printed amount, so it is executed for real: the controller draws 1.
  const [inner] = registration.args.body.value;
  assert.equal(inner.op, draw.op);
  // The array form adds a top-to-bottom block; the single-card form stacks each
  // card on top of the previous one.
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, { amount: inner.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handCount, 1);
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.equal(kernel.getObject("second-card").zone, "deck");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("rad-047-167 Fanfare: the authored registration op is not dispatched by the production interpreter", () => {
  // The reason records this as measured evidence: the card's own body cannot be
  // resolved today because trigger.delayed is not a registered instruction.
  const kernel = world().unit("spell", { types: ["spell"], zone: "chain" }).build();
  assert.throws(
    () => runAbilityBody([registration], kernel.clone({ sourceSnapshot: kernel.getObject("spell") })),
    /Unregistered instruction opcode: trigger\.delayed/
  );
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), false);
});

test.todo(
  "rad-047-167 Fanfare: registering the delayed trigger so it fires on the next three " +
    "unit plays and expires at end of turn needs a merged delayed-trigger instruction " +
    "(ResolveContext.registerDelayedTrigger behind an opcode), a use counter beyond " +
    "TriggerSpec.once, and an expiresAt/end-of-turn cleanup binding for card-created delayed " +
    "triggers — the delayed-trigger opcode, three-use counter, and expiresAt propagation."
);
