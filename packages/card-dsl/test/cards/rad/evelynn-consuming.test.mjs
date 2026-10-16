import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/evelynn-consuming.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-5b3fa1b7bdd573b289980b7c8d29ec1591881a5af15025b61677a96fc3699461";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play a card from face down, ready me and give me +1 :rb_might: this turn.";

test("rad-090-167 Evelynn, Consuming: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /from face down/);
  assert.match(program.judgeReason, /822/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-090-167 Evelynn, Consuming: [Ambush] keyword plus the face-down card-played trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "ambush" });

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { fromFaceDown: true }
  });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "evelynn-consuming.ready",
    "evelynn-consuming.grant-might"
  ]);
});

test("rad-090-167 Evelynn, Consuming: ready me then +1 Might this turn", () => {
  const [readyInstruction, grant] = program.abilities[1].body;
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readyInstruction.linkedTo, undefined);

  assert.equal(grant.op, "continuous.might");
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grant.targets, [
    {
      id: "evelynn-consuming.self",
      filter: { type: "unit", object: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-090-167 Evelynn, Consuming: 'ready me' executes through the merged effect.ready primitive", () => {
  const [readyInstruction] = program.abilities[1].body;
  const kernel = world()
    .unit("evelynn", {
      zone: "board",
      exhausted: true,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("evelynn") });
  const outcome = runAbilityBody([readyInstruction], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("evelynn").exhausted, false);
  assert.equal(outcome.events[0].action, "ready");
});

test("rad-090-167 Evelynn, Consuming: effect.ready on an already ready source is a no-op (CR 416.1.c)", () => {
  const [readyInstruction] = program.abilities[1].body;
  const kernel = world()
    .unit("evelynn", { zone: "board", exhausted: false, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("evelynn") });
  const run = runInstruction(ready, readyInstruction.args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test("rad-090-167 Evelynn, Consuming: the +1 Might consumer is still unregistered", () => {
  // Evidence for the judgeReason: there is no continuous.might instruction, so
  // the second body instruction cannot be executed at all today.
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);
});

test.todo(
  "evelynn-consuming: 'When you play a card from face down' provenance (CR v1.5 811.1.d / 355.10.a.1 Facedown" +
    " Zone) once the card-played payload records the played-from-face-down fact (RIFT-84)"
);
test.todo(
  "evelynn-consuming: 'give me +1 :rb_might: this turn' through the layers continuous.might consumer with the" +
    " end-of-turn duration (RIFT-91)"
);
test.todo(
  "evelynn-consuming: [Ambush] expansion (CR 822.1.b battlefield-with-your-units play permission and Reaction" +
    " timing while being played there) through an Ambush KeywordDef and the chain canAct permissions"
);
