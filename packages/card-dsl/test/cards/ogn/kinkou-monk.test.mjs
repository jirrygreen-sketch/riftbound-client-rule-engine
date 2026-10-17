import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kinkou-monk.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: buff } = await import(new URL("effects/instructions/effect.buff.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { matchesObjectFilter } = await import(new URL("layers/filter.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const CANONICAL = "card.hash-0090d6c57ba7da68b80e9f14bdad99780bc1a22b8d69745d43c32f5af9185f9a";
const [playedTrigger] = program.abilities;
const buffInstruction = playedTrigger.body[0];
const targetSpec = buffInstruction.targets[0];

/** Run the card's own buff instruction with the locked friendly units. */
const buffChosen = (kernel, ids) =>
  runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: ids.map(id => kernel.ref(id)) } }
  );

// chain/engine.ts resolves the static controller/owner spellings before the
// production matcher runs (the merged Siphon Power / Smoke Screen goldens use
// this helper).
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};
const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

test("Kinkou Monk program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /355\.7/);
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.equal(
    program.sourceText,
    "When you play me, buff up to two other friendly units. (Each one that doesn't have a buff gets a +1 :rb_might: buff.)"
  );
});

test("structure: played trigger with an up-to-two other friendly units target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playedTrigger.optional, false);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "kinkou.buff-up-to-two");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "kinkou.other-friendly-units" }
  });
  // "up to two other friendly units": a target group of 0..2 (CR 355.7, 355.13)
  // limited to the controller's other units.
  assert.equal(buffInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "kinkou.other-friendly-units",
    // controller "self" is the ability controller (chain/engine.ts normalizes
    // it); the merged exclude anchor keeps the source out (contract 3.6).
    filter: { type: "unit", zone: "board", controller: "self", exclude: "self" },
    min: 0,
    max: 2,
    selection: "up-to"
  });
  assert.equal(buffInstruction.picks, undefined);
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("golden: both chosen units are buffed once each (CR 702.2.a)", () => {
  const kernel = world()
    .unit("monk", { might: 4, owner: "A" })
    .unit("ally-one", { owner: "A" })
    .unit("ally-two", { owner: "A" })
    .build();
  const run = buffChosen(kernel, ["ally-one", "ally-two"]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally-one").buffs, 1);
  assert.equal(kernel.getObject("ally-two").buffs, 1);
  assert.equal(kernel.getObject("monk").buffs, 0);
  assert.deepEqual(run.linked.buffedCount, 2);
  assert.deepEqual(run.events.map(event => event.action), ["buff", "buff"]);
});

test("golden: locking zero units leaves every unit untouched (effect.buff reports ignored)", () => {
  // CR 355.13 allows choosing zero for "up to two". With an empty locked set,
  // the merged effect.buff reports ignored/mistargeted (its documented boundary:
  // no still-legal objects). Either way nothing is buffed; the zero-choice
  // classification is tracked by the target-system TODO below.
  const kernel = world().unit("monk", { owner: "A" }).unit("ally-one", { owner: "A" }).build();
  const run = buffChosen(kernel, []);
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("ally-one").buffs, 0);
  assert.equal(run.events.length, 0);
});

test("golden: units that already have a buff are skipped, the rest are buffed (CR 702.3.a/427.1.c)", () => {
  const kernel = world()
    .unit("monk", { owner: "A" })
    .unit("charged", { owner: "A", buffs: 1 })
    .unit("fresh", { owner: "A" })
    .build();
  const run = buffChosen(kernel, ["charged", "fresh"]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("charged").buffs, 1);
  assert.equal(kernel.getObject("fresh").buffs, 1);
  assert.deepEqual(run.linked.buffedCount, 1);
});

test("golden: the declared exclude anchor drops the source from a locked candidate set (355.7)", () => {
  // The production Finalize candidate provider can still list the source
  // (layers/filter.ts ignores the anchor), but the interpreter re-applies the
  // declared filter through queryObjects, which executes exclude: "self".
  const kernel = world()
    .unit("monk", { owner: "A", controller: "A", might: 4 })
    .unit("ally-one", { owner: "A", controller: "A" })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("monk"), kernel.ref("ally-one"), kernel.ref("enemy")]);

  const outcome = runAbilityBody(playedTrigger.body, chainContext(kernel, "A"), undefined, {
    host: kernel.ref("monk")
  });
  assert.equal(outcome.results[0].result.status, "executed");
  // Only the other friendly unit is buffed: the source is excluded and the
  // enemy is filtered out by the controller restriction.
  assert.equal(kernel.getObject("monk").buffs, 0);
  assert.equal(kernel.getObject("ally-one").buffs, 1);
  assert.equal(kernel.getObject("enemy").buffs, 0);
});

test.todo(
  "Kinkou Monk: classifying a legal zero-target choice for 'up to two' (CR 355.13) — the merged " +
    "effect.buff returns ignored/mistargeted when its locked target set is empty, which is a target-system " +
    "/ primitive boundary"
);
test.todo(
  "Kinkou Monk: the Finalize candidate provider (target/target-plan.ts legalCandidates through " +
    "chain/engine.ts context.query -> layers/filter.ts) still needs to consume the exclude anchor, so the " +
    "source can be offered as a legal candidate before the interpreter re-checks it (CR 355.7)"
);
