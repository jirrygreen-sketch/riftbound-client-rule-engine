import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/soraka-wanderer.js";
import heal from "../../../../engine-core/dist/effects/instructions/effect.heal.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-0d756f766acd32a10e9b167b29aabb9d0be6ef340ce4d1b8ad068ed7f9fb3d15";
const [backline, replacement] = program.abilities;
const [healInstruction, exhaustInstruction, recallInstruction] = replacement.with;

test("sfd-173-221 Soraka, Wanderer: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Backline/);
  assert.match(program.judgeReason, /recall/);
  assert.equal(
    program.sourceText,
    "I must be assigned combat damage last.\n" +
      "If another unit you control here would die, if it has less Might than me, instead heal it, " +
      "exhaust it, and recall it. (Send it to base. This isn't a move.)"
  );
});

test("sfd-173-221 Soraka, Wanderer: Backline keyword plus death replacement on another friendly unit here", () => {
  // 826.3 / 826.4.b: the assignment restriction is a Passive Ability keyword;
  // the card declares it and does not restate the combat rule.
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-killed");
  assert.equal(replacement.replaces.filter.type, "unit");
  assert.equal(replacement.replaces.filter.controller, "self");
  assert.equal(replacement.replaces.filter.other, true);
  assert.equal(replacement.replaces.filter.sameLocationAs, "self");
});

test("sfd-173-221 Soraka, Wanderer: the Might comparison and the heal/exhaust/recall body", () => {
  // "if it has less Might than me" (143.2.a): compares the replaced unit and
  // Soraka; no merged expression reads another object's Might.
  const condition = replacement.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lt");
  assert.deepEqual(condition.left, {
    kind: "object-property",
    object: { target: "soraka.dying-unit" },
    property: "might"
  });
  assert.deepEqual(condition.right, {
    kind: "object-property",
    object: "self",
    property: "might"
  });

  assert.equal(healInstruction.op, "effect.heal");
  assert.deepEqual(healInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "soraka.dying-unit" }
  });
  assert.equal(healInstruction.targets.length, 1);
  assert.deepEqual(healInstruction.targets[0].filter, {
    type: "unit",
    controller: "controller",
    other: true,
    sameLocationAs: "self"
  });

  // 460.1 exception stated by the card: the recalled unit is exhausted.
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.equal(exhaustInstruction.linkedTo, "soraka.heal-dying-unit");
  assert.deepEqual(exhaustInstruction.args.target, {
    kind: "constant",
    value: "soraka.dying-unit"
  });

  assert.equal(recallInstruction.op, "effect.move");
  assert.equal(recallInstruction.linkedTo, "soraka.exhaust-dying-unit");
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
});

test("sfd-173-221 Soraka, Wanderer: the merged heal primitive clears the damage of the locked unit", () => {
  const kernel = world()
    .unit("soraka", { zone: "board", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { zone: "board", might: 1, damage: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("soraka") });
  const run = runInstruction(
    heal,
    {
      objects: { kind: "constant", value: { kind: "target", id: "soraka.dying-unit" } },
      linkKey: { kind: "constant", value: "healed" }
    },
    { world: scoped, targets: { "soraka.dying-unit": [scoped.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.healed.count, 1);
  assert.deepEqual(run.linked.healed.objects, [{ id: "ally", zoneEntryId: 1 }]);
  assert.equal(scoped.getObject("ally").damage, 0);
});

test("sfd-173-221 Soraka, Wanderer: the merged recall mode refuses to approximate a Move (457-460)", () => {
  // 458: a Recall is not a Move; 458.3: it cannot be stopped by movement
  // restrictions. effect.move accepts mode "recall" but reports the blocked
  // action instead of substituting a move-location action.
  const kernel = world()
    .unit("ally", { zone: "board", might: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "soraka.dying-unit" } },
      to: { kind: "constant", value: "controller-base" },
      mode: { kind: "constant", value: "recall" },
      linkKey: { kind: "constant", value: "recalled" }
    },
    { world: kernel, targets: { "soraka.dying-unit": [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.recalled.blockedReason, "Recall requires an action distinct from Move (CR v1.5 457-460)");
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-1" });
});

test.todo(
  "sfd-173-221 Soraka, Wanderer: execute the Backline assignment restriction in the combat damage step " +
    "(826.3 / 826.4.b; combat/base-combat-allocation.ts binds no Tank/Backline priority) and register the " +
    "card replacement with a selector for the replaced event's unit"
);
