import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/portable-portal.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID = "card.hash-c23ae2a28f5e64f8b56146faf62b3012c3c1902a3ebdd597858ac9d76f814fdc";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
  "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)";
const TARGET_ID = "portable-portal.unit-here";
const READY_ID = "portable-portal.ready";
const MAY_ID = "portable-portal.may";

test("rad-087-167 Portable Portal: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /830\.1\.b/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-087-167 Portable Portal: [Deploy] keyword, may-pay trigger and the Ganking grant", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "deploy" });

  const trigger = program.abilities[1];
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "card-played");
  assert.deepEqual(trigger.trigger.filter, { self: true });
  assert.equal(trigger.optional, false);
  assert.deepEqual(trigger.body.map(instruction => instruction.id), [MAY_ID]);

  const grant = program.abilities[2];
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Ganking");
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("rad-087-167 Portable Portal: 'you may pay … to ready a unit here' is choice.optional (contract 3.9)", () => {
  const [may] = program.abilities[1].body;
  assert.equal(may.op, "choice.optional");
  assert.equal(may.linkedTo, undefined);
  assert.equal(may.args.body.kind, "constant");
  assert.deepEqual(may.args.body.value.map(instruction => instruction.id), [READY_ID]);

  const [readyInstruction] = may.args.body.value;
  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(readyInstruction.linkedTo, undefined);
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: TARGET_ID }
  });
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 1 });
  // "a unit here" is an explicit choice (355.5), so it is a TargetSpec; "here"
  // is the source's location restriction (sameLocationAs: self), never a
  // separate battlefield target (355.10.b / 355.10.d).
  assert.deepEqual(readyInstruction.targets, [
    {
      id: TARGET_ID,
      filter: { type: "unit", controller: "controller", zone: "board", sameLocationAs: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-087-167 Portable Portal: accepting the optional performs the ready instruction", () => {
  const [may] = program.abilities[1].body;
  assert.equal(may.args.body.value.length, 1);
  const [readyInstruction] = may.args.body.value;

  // The reference kernel cannot evaluate the symbolic controller/here filter
  // placeholders of the TargetSpec, so Finalize's locked choice is supplied to
  // the real effect.ready primitive directly (same split as veiled-temple);
  // the acceptance path itself is the declared choice.optional body.
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: true })
    .unit("unit-elsewhere", { zone: "board", location: { type: "battlefield", id: "bf-2" }, exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    readyInstruction.args,
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");
  // effect.ready links { count, objects } under "readied".
  assert.equal(run.linked.readied.count, 1);
  assert.equal(run.linked.readied.objects[0].id, "unit-here");
  assert.equal(kernel.getObject("unit-here").exhausted, false);
  assert.equal(kernel.getObject("unit-elsewhere").exhausted, true);
  assert.equal(run.events[0].action, "ready");
});

test("rad-087-167 Portable Portal: declining skips the ready and produces no event", () => {
  const [may] = program.abilities[1].body;
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: true })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("unit-here")]);
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = runAbilityBody([may], kernel);
  assert.deepEqual(outcome.results.map(result => result.id), [MAY_ID]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("unit-here").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test("rad-087-167 Portable Portal: effect.ready is a no-op on an already ready unit (CR 416.1.c)", () => {
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: false })
    .build();
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "target", id: TARGET_ID } }, amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test("rad-087-167 Portable Portal: the merged Ganking grant lands on the chosen friendly unit", () => {
  // 810 / contract 3.7: the card declares static continuous.grant-keyword for
  // "Friendly units here have [Ganking]". RIFT-258 merged the op and the layers
  // consumer. The reference kernel's set query compares filter scalars literally
  // and does not evaluate the sameLocationAs anchor, so Finalize's locked choice
  // is supplied as an explicit selection (the merged goldens' documented device)
  // while the recorded program filter is asserted in the structure test above;
  // wiring the CardProgram static into production is the open RIFT-120 gap (see
  // judgeReason).
  const grant = program.abilities[2].effect;
  const targetId = "portable-portal.unit-here";
  const kernel = world()
    .unit("portal", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-here", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("unit-elsewhere", { zone: "board", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const source = kernel.getObject("portal");
  const scoped = kernel.clone({ sourceSnapshot: source, source: source.ref });

  const run = runInstruction(
    grantKeyword,
    {
      keyword: { kind: "constant", value: grant.keyword },
      duration: { kind: "constant", value: "permanent" },
      objects: { kind: "constant", value: { kind: "target", id: targetId } }
    },
    { world: scoped, targets: { [targetId]: [scoped.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.granted.objects.map((ref) => ref.id), ["unit-here"]);

  const engine = createLayerEngine(
    scoped.objects,
    scoped.continuousEffects.map((entry, index) => ({
      effect: entry.effect, duration: entry.duration, timestamp: index + 1
    }))
  );
  assert.deepEqual(
    engine.evaluate(scoped.ref("unit-here")).keywords.map((keyword) => keyword.id),
    ["Ganking"]
  );
  assert.deepEqual(engine.evaluate(scoped.ref("unit-elsewhere")).keywords, []);
  assert.deepEqual(engine.evaluate(scoped.ref("portal")).keywords, []);
});

test.todo(
  "rad-087-167 Portable Portal: the merged Deploy expansion's continuous.location permission and " +
    "'when an opponent holds here, kill this' trigger still need Finalize/cleanup/trigger consumers (CR 830.1.b, RIFT-120)"
);
test.todo(
  "rad-087-167 Portable Portal: the ':rb_rune_body:' in-instruction Power payment (355.10.c.1) needs the " +
    "cost.pay instruction path — RIFT-261 (in progress); the ready branch cannot be honestly charged yet"
);
test.todo(
  "rad-087-167 Portable Portal: the static 'Friendly units here have [Ganking]' continuous.grant-keyword " +
    "(op merged by RIFT-258, Ganking expansion by RIFT-83) needs the CardProgram static -> layers registration " +
    "path — RIFT-120/RIFT-257"
);
