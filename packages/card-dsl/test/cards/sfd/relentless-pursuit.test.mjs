import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/relentless-pursuit.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [keyword, play] = program.abilities;
const moveInstruction = play.body[0];
const attachChoice = play.body[1];
const attachInstruction = attachChoice.args.body.value[0];
const grantInstruction = play.body[2];

test("Relentless Pursuit program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-d07372b97e2617a79fd38c84519913156cea70c47ae9f230f3f51b6aab1a644d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.4/);
  // Enumeration is available; Finalize Move planning, nested targets and
  // temporary triggered-ability granting remain blocked.
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /嵌套 TargetSpec/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91 layers-continuous 未实现/);
  assert.match(program.sourceText, /Move a friendly unit\./);
  assert.match(program.sourceText, /You may attach an Equipment with the same controller to it\./);
  assert.match(program.sourceText, /When I conquer, you may move me to my base\./);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Relentless Pursuit structure: Action keyword, printed cost, move + optional attach + ability grant", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["relentless-pursuit.move", "effect.move"],
      ["relentless-pursuit.may-attach", "choice.optional"],
      ["relentless-pursuit.grant-ability", "continuous.grant-ability"]
    ]
  );

  // "Move a friendly unit": one target; the destination is chosen at Finalize
  // (355.4) and cannot be enumerated in static IR.
  assert.equal(moveInstruction.targets.length, 1);
  assert.equal(moveInstruction.targets[0].id, "relentless-pursuit.unit");
  assert.deepEqual(moveInstruction.targets[0].filter, { type: "unit", controller: "controller" });
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "relentless-pursuit.unit" }
  });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "relentless-pursuit.destination",
      options: ["dynamic:legal-move-destinations"]
    }
  });
});

test("Relentless Pursuit structure: the attach is optional and linked to the move", () => {
  // One optional decision with its instructions in the body (contract 3.9).
  assert.equal(attachChoice.op, "choice.optional");
  assert.equal(attachChoice.linkedTo, "relentless-pursuit.move");
  assert.equal(attachChoice.args.body.kind, "constant");
  assert.equal(attachInstruction.op, "effect.attach");
  assert.deepEqual(attachInstruction.args.host, {
    kind: "constant",
    value: { kind: "target", id: "relentless-pursuit.unit" }
  });
  assert.deepEqual(attachInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "relentless-pursuit.equipment" }
  });
  assert.equal(attachInstruction.targets.length, 1);
  const [equipment] = attachInstruction.targets;
  assert.equal(equipment.id, "relentless-pursuit.equipment");
  assert.deepEqual(equipment.filter, {
    type: "gear",
    tags: ["Equipment"],
    controller: "same-as:relentless-pursuit.unit"
  });
});

test("Relentless Pursuit structure: the granted conquer ability moves the unit to its base", () => {
  assert.equal(grantInstruction.linkedTo, undefined);
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantInstruction.args.target, {
    kind: "constant",
    value: "relentless-pursuit.unit"
  });
  const granted = grantInstruction.args.ability.value;
  assert.equal(granted.kind, "triggered");
  assert.equal(granted.optional, true);
  assert.equal(granted.trigger.at, "conquer");
  assert.deepEqual(granted.trigger.filter, { role: "self" });
  assert.deepEqual(granted.body, [
    {
      id: "relentless-pursuit.conquer-recall",
      op: "effect.move",
      args: {
        objects: { kind: "constant", value: "self" },
        to: { kind: "constant", value: "controller-base" }
      }
    }
  ]);
});

test("Relentless Pursuit golden: effect.move relocates a locked unit once a real destination is supplied", () => {
  // The merged effect.move primitive runs fine once a destination exists; this
  // card cannot supply one (355.4 / 355.4.a), so the golden test passes the
  // controller's base directly to show the instruction shape is runnable.
  const kernel = world()
    .unit("scout", { owner: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("scout");
  const run = runInstruction(move, {
    objects: { kind: "constant", value: { target: "relentless-pursuit.unit" } },
    to: { kind: "constant", value: "controller-base" }
  }, { world: kernel, targets: { "relentless-pursuit.unit": [locked] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("scout").location, { type: "base", player: "A" });
  assert.deepEqual(run.linked.moved.movements, [
    {
      object: locked,
      from: { type: "battlefield", id: "battlefield-1" },
      to: { type: "base", player: "A" }
    }
  ]);
});

test("Relentless Pursuit golden: the attach body attaches an Equipment to the locked unit", () => {
  const kernel = world().unit("scout", { owner: "A" }).build();
  const equipmentRef = kernel.addObject({
    ...kernel.getObject("scout"),
    ref: { id: "blade", zoneEntryId: 1 },
    name: "Blade",
    types: ["gear"],
    tags: ["Equipment"],
    attachedTo: null
  }, "board");

  const run = runInstruction(attach, {
    objects: {
      kind: "constant",
      value: { kind: "target", id: "relentless-pursuit.equipment" }
    },
    host: { kind: "constant", value: { kind: "target", id: "relentless-pursuit.unit" } }
  }, {
    world: kernel,
    targets: {
      "relentless-pursuit.equipment": [equipmentRef],
      "relentless-pursuit.unit": [kernel.ref("scout")]
    }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("blade").attachedTo, kernel.ref("scout"));
  assert.equal(run.linked.attached.count, 1);
});

test.todo(
  "Relentless Pursuit Move: the spell must choose a legal destination other than the unit's " +
    "current location at Finalize (355.4 / 355.4.a) and the Move path must be validated " +
    "(451.1 / 449.2); 依赖 Move 目的地 Finalize 计划"
);

test.todo(
  "Relentless Pursuit optional attach: the Equipment must share the moved unit's controller " +
    "(\"with the same controller\") and attach after the Move; 依赖对象相对锚点的过滤器" +
    "与嵌套目标生命周期"
);

test.todo(
  "Relentless Pursuit granted ability: the unit gains 'When I conquer, you may move me to my " +
    "base' until end of turn through a continuous ability grant, and the conquer trigger then " +
    "offers the move to base (830 ability grant / 468.5 conquer trigger / 457 Recall 与 Move 的区分) " +
    "(依赖整条触发能力授予及到期处理)"
);


test("Relentless Pursuit: location candidates can be enumerated and exclude a real current location", () => {
  const current = { type: "battlefield", id: "battlefield-1" };
  const kernel = world().unit("scout", { location: current }).build();
  const candidates = queryLocationCandidates(kernel, { type: "any" }, {
    players: ["A", "B"], exclude: [current], locations: [
      { ref: current, controller: "A" },
      { ref: { type: "battlefield", id: "battlefield-2" }, controller: null }
    ]
  });
  // This proves enumeration exists. It is not yet the card's Finalize-time
  // legal Move plan (for example, the generic list also contains the enemy Base).
  assert.deepEqual(candidates, [
    { type: "battlefield", id: "battlefield-2" },
    { type: "base", player: "A" },
    { type: "base", player: "B" }
  ]);
});

test("Relentless Pursuit: the original attach subinstruction executes through the production interpreter", { todo: "same-as controller and nested target binding remain unsupported; preserve the intended execution assertions" }, () => {
  const kernel = world().unit("scout").unit("equipment", { types: ["gear"], tags: ["Equipment"] }).build();
  kernel.setTargets("relentless-pursuit.unit", [kernel.ref("scout")]);
  kernel.setTargets("relentless-pursuit.equipment", [kernel.ref("equipment")]);
  const outcome = resolveChainBody([attachInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("equipment").attachedTo, kernel.ref("scout"));
  assert.deepEqual(outcome.events.map(event => event.action), ["attach"]);
  assert.equal(outcome.results[0].result.linkedValues.attached.count, 1);
});
