
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/evelynn-consuming.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-5b3fa1b7bdd573b289980b7c8d29ec1591881a5af15025b61677a96fc3699461";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play a card from face down, ready me and give me +1 :rb_might: this turn.";

const triggered = program.abilities[1];
const [readyInstruction, grant] = triggered.body;

test("rad-090-167 Evelynn, Consuming: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /face down/);
  assert.match(program.judgeReason, /822/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-090-167 Evelynn, Consuming: [Ambush] keyword plus the face-down card-played trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "ambush" });
  // 822: the merged KeywordDef exists; its expansion stays declarative until
  // the play-location/timing consumers land (see judgeReason).
  assert.equal(keywordDefinitionsById.has("Ambush"), true);

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    player: "self",
    details: { fromFaceDown: true }
  });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "evelynn-consuming.ready",
    "evelynn-consuming.grant-might"
  ]);
});

test("rad-090-167 Evelynn, Consuming: ready me then +1 Might this turn", () => {
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readyInstruction.linkedTo, undefined);

  // "give me +1 Might this turn": an arithmetic-layer temporary Might change
  // bound to the ability source (RIFT-258 continuous.might + appliesTo self).
  assert.equal(grant.op, "continuous.might");
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grant.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grant.targets, undefined);
  assert.equal(grant.linkedTo, undefined);
});

test("rad-090-167 Evelynn, Consuming: 'ready me' executes through the merged effect.ready primitive", () => {
  const kernel = world()
    .unit("evelynn", {
      zone: "board",
      exhausted: true,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("evelynn"),
    sourceSnapshot: kernel.getObject("evelynn")
  });
  const outcome = runAbilityBody([readyInstruction], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("evelynn").exhausted, false);
  assert.equal(outcome.events[0].action, "ready");
});

test("rad-090-167 Evelynn, Consuming: effect.ready on an already ready source is a no-op (CR 416.1.c)", () => {
  const kernel = world()
    .unit("evelynn", { zone: "board", exhausted: false, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("evelynn"),
    sourceSnapshot: kernel.getObject("evelynn")
  });
  const run = runInstruction(ready, readyInstruction.args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test("rad-090-167 Evelynn, Consuming: the +1 Might body registers an end-of-turn effect on the source", () => {
  const kernel = world()
    .unit("evelynn", { zone: "board", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("other", { zone: "board", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("evelynn"),
    sourceSnapshot: kernel.getObject("evelynn")
  });

  const outcome = runAbilityBody([grant], scoped);

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["evelynn-consuming.grant-might", "executed"]]
  );
  const [registered] = scoped.snapshot().continuous;
  assert.equal(registered.effect.layer, "arithmetic");
  // The registered spec is object-scoped to the ability source (appliesTo self).
  assert.deepEqual(registered.effect.filter, { objectId: "evelynn", zoneEntryId: 1, zone: "board" });
  // "this turn": the printed duration expires in one cleanup batch (317.2.c).
  assert.deepEqual(registered.duration, { type: "end-of-turn" });

  // The merged LayerEngine really applies the +1 to the source only.
  const engine = createLayerEngine(
    scoped.query({}),
    scoped.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.equal(engine.evaluate(scoped.ref("evelynn")).might, 6);
  assert.equal(engine.evaluate(scoped.ref("other")).might, 5);
});

test.todo(
  "rad-090-167 Evelynn, Consuming: 'When you play a card from face down' provenance (CR v1.5 811.1.d / 355.10.a.1 " +
    "Facedown Zone) needs the card-played payload to record the played-from-face-down fact; the event matcher " +
    "has no such detail to evaluate yet, so the filter cannot be honestly evaluated " +
    "(card-played fromFaceDown fact)"
);
test.todo(
  "rad-090-167 Evelynn, Consuming: [Ambush] expansion (CR 822.1.b battlefield-with-your-units play permission and " +
    "Reaction timing while being played there) needs the Finalize play-location consumer and chain canAct to read " +
    "continuous.timing — the merged KeywordDef declares them but nothing consumes them yet"
);

