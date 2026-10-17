import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/pack-of-wonders.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("ogn-181-298 Pack of Wonders: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-181-298 Pack of Wonders: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-e4f131a5d6aa5e08d250cdcde82ff81ed20a9131732bcaf3d7dec6b22e490535"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Return another friendly gear, unit, or [Hidden] card to its owner's hand."
  );
  assert.match(program.judgeReason, /Facedown Zone/);
  assert.match(program.judgeReason, /facedown/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /811\.5\.a/);
  assert.doesNotMatch(program.judgeReason, /契约变更请求/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ogn-181-298 Pack of Wonders: exhaust-cost activated ability returning a friendly gear/unit to hand", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(ability.cost.energy, undefined);
  assert.equal(ability.cost.power, undefined);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "pack-of-wonders.return-to-hand");
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.target, {
    kind: "constant",
    value: "pack-of-wonders.returned-object"
  });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "pack-of-wonders.returned-object");
  assert.deepEqual(target.filter, {
    type: ["gear", "unit"],
    controller: "self",
    zone: "board",
    exclude: "self"
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("ogn-181-298 Pack of Wonders: the public gear/unit branch returns the object to its owner's hand", () => {
  const kernel = world()
    .unit("friendly-gear", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const gearRef = kernel.ref("friendly-gear");
  const run = runInstruction(
    zone,
    {
      target: "pack-of-wonders.returned-object",
      to: { kind: "constant", value: "hand" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { "pack-of-wonders.returned-object": [gearRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
  assert.equal(kernel.getObject("friendly-gear").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
});

test.todo(
  "Pack of Wonders: choose and return a facedown [Hidden] card from its Facedown Zone " +
    "(ZoneId has no facedown-zone member, and the target adapter must consume the exclude:self anchor)"
);
test("ogn-181-298 Pack of Wonders: the target filter excludes the source gear", () => {
  const [ability] = program.abilities;
  const [instruction] = ability.body;
  assert.equal(instruction.targets[0].filter.exclude, "self");
});
