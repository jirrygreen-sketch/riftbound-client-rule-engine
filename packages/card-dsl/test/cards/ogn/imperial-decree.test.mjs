import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/imperial-decree.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-a56576887313144ef13fd285dd3130fb460b1678a4a592a776002d9ef0757fb9";
const [action, play] = program.abilities;
const [delayed] = play.body;

test("Imperial Decree program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Imperial Decree identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("trigger.delayed"), true);
  assert.equal(program.judgeReason.includes("390"), true);
  assert.match(program.judgeReason, /expiresAt/);
  assert.match(program.judgeReason, /绑定/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "When any unit takes damage this turn, kill it."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Imperial Decree structure: Action keyword, printed cost, a this-turn damage-dealt delayed kill", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 1);

  // 390/391: the text creates a Delayed Ability, not a card-owned passive
  // trigger (391.1 / 393), so it is declared as the pending trigger.delayed
  // instruction rather than a `triggered` ability on the card.
  assert.equal(delayed.id, "imperial-decree.delayed-kill");
  assert.equal(delayed.op, "trigger.delayed");
  // "when any unit takes damage": the damage-dealt timing point (418.1.a/b).
  assert.deepEqual(delayed.args.at, { kind: "constant", value: "damage-dealt" });
  assert.equal(isTimingPointId(delayed.args.at.value), true);
  assert.deepEqual(delayed.args.filter, { kind: "constant", value: { types: "unit" } });
  // "this turn": the delayed window (317.2.c expiry).
  assert.deepEqual(delayed.args.duration, { kind: "constant", value: "this-turn" });

  // The delayed body is the kill of the unit that just took the damage.
  assert.equal(delayed.args.body.kind, "constant");
  const [killInstruction] = delayed.args.body.value;
  assert.equal(killInstruction.id, "imperial-decree.kill-damaged-unit");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "imperial-decree.damaged-unit"
  });
  assert.deepEqual(killInstruction.targets[0].filter, { types: "unit" });
  assert.equal(killInstruction.targets[0].selection, "one");
});

test("Imperial Decree: the delayed kill body itself is a valid, executable effect.kill", () => {
  // The subscription is pending, but the body the delayed trigger will run is
  // ordinary data and can be executed against the merged primitive with the
  // damaged unit supplied as its locked target.
  const kernel = world().unit("damaged-unit", { owner: "B", controller: "B", damage: 3 }).build();
  const [killInstruction] = delayed.args.body.value;
  kernel.setTargets("imperial-decree.damaged-unit", [kernel.ref("damaged-unit")]);
  const outcome = runAbilityBody([killInstruction], kernel);

  assert.equal(kernel.getObject("damaged-unit").zone, "trash");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["imperial-decree.kill-damaged-unit", "executed"]
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test.todo(
  "Imperial Decree: registering the Delayed Ability for the rest of the turn needs the " +
    "trigger.delayed / trigger.state instruction primitive over ctx.registerDelayedTrigger " +
    "(contract 3.6)."
);

test.todo(
  "Imperial Decree: the damage-dealt subscription must fire only for actual positive valid " +
    "damage (418.1.a/b, 418.1.e/e.1) and expire with the 'this turn' effects (317.2.c); the existing EventPipeline expiry " +
    "must be connected to the card-facing registration and each event object bound to the kill body."
);

test("Imperial Decree supported delayed body: a replaced kill reports negated and leaves the unit", () => {
  const kernel = world().unit("damaged-unit", { owner: "B", controller: "B", damage: 1 }).build();
  kernel.setTargets("imperial-decree.damaged-unit", [kernel.ref("damaged-unit")]);
  kernel.addReplacement(action => action.type === "kill" ? "replaced" : null);
  const outcome = runAbilityBody(delayed.args.body.value, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.deepEqual(outcome.events.map(event => [event.action, event.outcome]), [["kill", "replaced"]]);
  assert.equal(kernel.getObject("damaged-unit").zone, "board");
  assert.equal(kernel.getObject("damaged-unit").damage, 1);
});
