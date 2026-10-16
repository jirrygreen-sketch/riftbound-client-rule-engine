import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/heartening-soul.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b955ee21fd32d4a00aae0761a6d7f8f66eb03094edf676a34c3e87639045aae1";
const SOURCE_TEXT =
  "When you play me, ready a friendly legend.\n" +
  "Friendly legends have \":rb_exhaust:: Give a unit +3 :rb_might: this turn.\"";

const [readyTrigger, grantStatic] = program.abilities;
const [readyInstruction] = readyTrigger.body;
const grantedBody = grantStatic.effect.ability.body;
const grantedInstruction = grantedBody[0];

/** Strip instruction-level TargetSpecs: Finalize locks those in production. */
const executableBody = readyTrigger.body.map(({ targets, ...rest }) => rest);

test("rad-040-167 Heartening Soul: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-040-167 Heartening Soul: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-040-167 Heartening Soul: play trigger readies one friendly legend (CR 355.9.a.4 / 416.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(readyTrigger.kind, "triggered");
  assert.equal(readyTrigger.trigger.at, "card-played");
  assert.deepEqual(readyTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(readyTrigger.optional, false);
  assert.equal(readyTrigger.body.length, 1);
  assert.equal(readyInstruction.id, "heartening-soul.ready-legend");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "heartening-soul.friendly-legend" }
  });
  assert.deepEqual(readyInstruction.targets, [
    {
      id: "heartening-soul.friendly-legend",
      filter: { type: "legend", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(readyInstruction.linkedTo, undefined);
});

test("rad-040-167 Heartening Soul: the granted legend ability is an exhaust-cost activation granting +3 Might", () => {
  assert.equal(grantStatic.kind, "static");
  assert.equal(grantStatic.effect.kind, "continuous.grant-ability");
  assert.deepEqual(grantStatic.effect.filter, { type: "legend", controller: "controller" });

  const granted = grantStatic.effect.ability;
  assert.equal(granted.kind, "activated");
  assert.equal(granted.timing, "action");
  assert.deepEqual(granted.cost, { payments: [{ kind: "exhaust" }] });
  assert.equal(grantedBody.length, 1);
  assert.equal(grantedInstruction.op, "continuous.might");
  assert.deepEqual(grantedInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantedInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantedInstruction.targets, [
    {
      id: "heartening-soul.granted.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-040-167 Heartening Soul golden: the ready instruction readies an exhausted friendly legend", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], exhausted: true, zone: "board", location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets("heartening-soul.friendly-legend", [kernel.ref("legend")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["heartening-soul.ready-legend", "executed"]]
  );
  assert.equal(kernel.getObject("legend").exhausted, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
});

test("rad-040-167 Heartening Soul golden: a stale legend target is ignored (CR 359.3.e.7)", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], exhausted: true, zone: "board", location: { type: "base", player: "A" } })
    .build();
  const stale = kernel.ref("legend");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  kernel.setTargets("heartening-soul.friendly-legend", [stale]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(outcome.events, []);
});

test("rad-040-167 Heartening Soul: neither the grant op nor the Might grant op is registered", () => {
  assert.equal(instructionDefinitionsById.get("continuous.grant-ability"), undefined);
  assert.equal(instructionDefinitionsById.get("continuous.might"), undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.ready"), undefined);
});

test.todo(
  "rad-040-167 Heartening Soul: attach the whole activated ability (with its [E] cost and end-of-turn duration) to " +
    "every friendly legend — CR 801.3.a / 135.4.b continuous.grant-ability has no merged consumer (no assigned task)"
);

test.todo(
  "rad-040-167 Heartening Soul: resolve the granted '+3 Might this turn' through the arithmetic layer and expire it at " +
    "the end-of-turn cleanup (CR 143.2.a / 475) — depends on RIFT-91"
);

test.todo(
  "rad-040-167 Heartening Soul: target legality for a legend in the Legend Zone (CR 355.9.a.4) needs a ZoneId member " +
    "for the legend zone (contract change request) plus the RIFT-90 target plan"
);
