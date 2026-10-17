import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cithria-of-cloudfield.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: buff } = await import(new URL("effects/instructions/effect.buff.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-7d31737a3d92e21d8b50470d4b5950e617327bd7ac418492d9739ccca96ecbad";
const [playedTrigger] = program.abilities;
const buffInstruction = playedTrigger.body[0];

test("Cithria of Cloudfield program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason must name the still-current gaps: the event matcher exists, but
  // production filter translation still rejects the
  // dynamic "another object" exclusion, and effect.buff lacks a host selector.
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.match(program.judgeReason, /other|exclude/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /objects: \{kind: "source"\}/);
  assert.equal(
    program.sourceText,
    "When you play another unit, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)"
  );
});

test("structure: played trigger for another friendly unit with a self buff body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  // CR 383.4.a.4: an ability that triggers when another object is played is not
  // a Play Effect; the filter describes the played unit, excluding the host.
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { type: "unit", controller: "controller", other: true }
  });
  assert.equal(playedTrigger.optional, false);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "cithria.buff-self");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "self" }
  });
  // "me" is the host, not a chosen target (CR 355.10.d): no TargetSpec is
  // declared, so no became-target behaviour is fabricated.
  assert.equal(buffInstruction.targets, undefined);
  assert.equal(buffInstruction.picks, undefined);
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("golden: buffing the host places exactly one Buff counter (CR 702.2.a)", () => {
  const kernel = world().unit("cithria", { might: 1 }).build();
  const run = runInstruction(buff, { mode: "buff", target: "self" }, {
    world: kernel,
    targets: { self: [kernel.ref("cithria")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("cithria").buffs, 1);
  assert.deepEqual(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
});

test("golden: a host that already has a buff is not buffed again (CR 702.3/702.3.a)", () => {
  const kernel = world().unit("cithria", { might: 1, buffs: 1 }).build();
  const run = runInstruction(buff, { mode: "buff", target: "self" }, {
    world: kernel,
    targets: { self: [kernel.ref("cithria")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("cithria").buffs, 1);
  assert.deepEqual(run.linked.buffedCount, 0);
});

test.todo(
  "Cithria of Cloudfield: 'you play another unit' needs a trigger-filter predicate that excludes the " +
    "host and scopes to units played by the controller; programs/filters.ts currently rejects the " +
    "nested other/exclude spelling before the EventPattern matcher sees it"
);
test.todo(
  "Cithria of Cloudfield: 'buff me' needs a host-selector form inside effect.buff (contract change " +
    "request filed): the primitive only accepts a TargetSpec id, while 'me' is programmatically " +
    "selected (CR 355.10.d) and must not become a target"
);
