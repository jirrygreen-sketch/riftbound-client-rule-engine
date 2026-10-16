import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/hwei-brooding-painter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-ffb82a1c4cfcf34e538fde6b389b55d4affeceb3cdb2ba50ada212c3237fe8f2";
const SOURCE_TEXT =
  "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's " +
  "type:\nSpell — Draw 1.Gear — Ready up to 2 runes.Unit — Give me +3 :rb_might: this turn.";

const [ability] = program.abilities;
const [drawOne, discardOne, spellBranch, gearBranch, unitBranch] = ability.body;
const [discardedPick] = discardOne.picks;
const [spellDraw] = spellBranch.args.body.value;
const [gearReady] = gearBranch.args.body.value;
const [unitModifier] = unitBranch.args.body.value;

const branchCondition = (type) => ({
  kind: "compare",
  left: { kind: "constant", value: type },
  operator: "in",
  right: {
    kind: "object-property",
    object: { pick: "hwei.discarded" },
    property: "types"
  }
});

/**
 * Resolve the contract-level placeholder the production caller owns: the rune filter's
 * owner: "controller" becomes the ability controller (the reference kernel compares
 * filters by value and does not run finalize-time placeholder resolution). The card IR
 * itself is unchanged; merged precedents call this out the same way in their goldens.
 */
const prepareCallerBody = (body, controller) => {
  const clone = structuredClone(body);
  const visit = (instructions) => {
    for (const instruction of instructions) {
      if (instruction.op === "effect.ready") {
        instruction.args.objects.value.filter.owner = controller;
      }
      if (instruction.op === "sequence" && Array.isArray(instruction.args.body.value)) {
        visit(instruction.args.body.value);
      }
    }
  };
  visit(clone);
  return clone;
};

const hweiWorld = (discarded) => {
  const kernel = world()
    .unit("hwei", { might: 5, location: { type: "battlefield", id: "bf-1" } })
    .hand("discarded-card", { types: [discarded] })
    .deck(["deck-top"])
    .object("rune-ready", { types: ["rune"], zone: "rune-zone", exhausted: false })
    .object("rune-one", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .object("rune-two", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .object("rune-three", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .build();
  // Finalize hands the discard pick the card the player chose (RIFT-90 territory).
  kernel.setPicks(discardedPick.id, [kernel.ref("discarded-card")]);
  // Bind the resolving source to this card so "me" (object: "self") anchors to it.
  return kernel.clone({ sourceSnapshot: kernel.getObject("hwei") });
};

test("unl-080-219 Hwei, Brooding Painter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-080-219 Hwei, Brooding Painter: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 四处缺口：Move 归属、弃牌类型读取、continuous.might、触发注册。
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-080-219 Hwei, Brooding Painter: 'When I move' subscribes to object-moved (449.1/449.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-080-219 Hwei, Brooding Painter: draw 1 then discard 1, in printed order", () => {
  assert.deepEqual(
    ability.body.map((entry) => [entry.id, entry.op]),
    [
      ["hwei.draw-1", "effect.draw"],
      ["hwei.discard-1", "effect.discard"],
      ["hwei.spell-branch", "sequence"],
      ["hwei.gear-branch", "sequence"],
      ["hwei.unit-branch", "sequence"]
    ]
  );
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(discardOne.args.amount, { kind: "constant", value: 1 });
  // 弃牌者是能力控制者（190.6.d），且选择是手牌里的非目标 pick（355.10.a）。
  assert.equal(discardOne.args.player, undefined);
  assert.deepEqual(discardOne.args.pick, { kind: "constant", value: "hwei.discarded" });
  assert.deepEqual(discardedPick, {
    id: "hwei.discarded",
    options: ["chosen-card-from-your-hand"],
    min: 1,
    max: 1,
    selection: "one"
  });
  // 两条指令各自独立："draw 1, then discard 1" 的 then 不引用抽牌结果。
  assert.equal(discardOne.linkedTo, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("unl-080-219 Hwei, Brooding Painter: the three type branches are mutually exclusive sequences", () => {
  assert.deepEqual(spellBranch.condition, branchCondition("spell"));
  assert.deepEqual(gearBranch.condition, branchCondition("gear"));
  assert.deepEqual(unitBranch.condition, branchCondition("unit"));
  for (const branch of [spellBranch, gearBranch, unitBranch]) {
    assert.equal(branch.op, "sequence");
    assert.equal(branch.linkedTo, undefined);
  }

  // Spell — Draw 1.
  assert.equal(spellDraw.op, "effect.draw");
  assert.deepEqual(spellDraw.args.amount, { kind: "constant", value: 1 });

  // Gear — Ready up to 2 runes：至多 2 个的非目标选择（min 0 = "up to"）。
  assert.equal(gearReady.op, "effect.ready");
  assert.deepEqual(gearReady.args.objects.value, {
    kind: "choose",
    id: "hwei-runes",
    filter: { zone: "rune-zone", type: "rune", owner: "controller" },
    min: 0,
    max: 2
  });

  // Unit — Give me +3 :rb_might: this turn。属连续图层修正（见 judgeReason）。
  assert.equal(unitModifier.op, "continuous.might");
  assert.deepEqual(unitModifier.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(unitModifier.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(unitModifier.targets[0].filter, {
    zone: "board",
    type: "unit",
    object: "self"
  });
  assert.equal(unitModifier.targets[0].selection, "one");
});

test("unl-080-219 Hwei, Brooding Painter golden: a discarded spell draws 1 in its branch", () => {
  const kernel = hweiWorld("spell");
  const outcome = resolveChainBody(prepareCallerBody(ability.body, "A"), kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["hwei.draw-1", "executed"],
      ["hwei.discard-1", "executed"],
      ["hwei.spell-draw-1", "executed"],
      ["hwei.spell-branch", "executed"],
      ["hwei.gear-branch", "negated"],
      ["hwei.unit-branch", "negated"]
    ]
  );
  // 弃掉的牌进垃圾场；draw 1 与 Spell 分支的 draw 1 各提交一次抽牌动作。
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["discarded-card"]);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-top"]);
  assert.equal(outcome.events.filter((event) => event.action === "draw").length, 2);
  assert.equal(outcome.linkedValues["hwei.discard-1.discarded"].count, 1);
});

test("unl-080-219 Hwei, Brooding Painter golden: a discarded gear readies up to 2 runes", () => {
  const kernel = hweiWorld("gear");
  kernel.setAnswers({
    "hwei.gear-branch/hwei.gear-ready-runes/hwei-runes": [
      kernel.ref("rune-one"),
      kernel.ref("rune-two")
    ]
  });
  const outcome = resolveChainBody(prepareCallerBody(ability.body, "A"), kernel);

  const gearEntry = outcome.results.find((entry) => entry.id === "hwei.gear-ready-runes");
  assert.equal(gearEntry.result.status, "executed");
  assert.equal(kernel.getObject("rune-one").exhausted, false);
  assert.equal(kernel.getObject("rune-two").exhausted, false);
  // 至多 2 个：第三个仍保持横置；本来就绪的符文不计入。
  assert.equal(kernel.getObject("rune-three").exhausted, true);
  assert.equal(kernel.getObject("rune-ready").exhausted, false);
  // 解释器把链接值写成「执行路径.键」；路径包含 sequence 分支 id。
  assert.equal(
    outcome.linkedValues["hwei.gear-branch/hwei.gear-ready-runes.readied"].count,
    2
  );

  const branchStatuses = Object.fromEntries(
    outcome.results
      .filter((entry) => entry.id.endsWith("-branch"))
      .map((entry) => [entry.id, entry.result.status])
  );
  assert.deepEqual(branchStatuses, {
    "hwei.spell-branch": "negated",
    "hwei.gear-branch": "executed",
    "hwei.unit-branch": "negated"
  });
});

test("unl-080-219 Hwei, Brooding Painter golden: the type readout selects exactly one branch", () => {
  for (const [type, expectedBranch] of [
    ["spell", "hwei.spell-branch"],
    ["gear", "hwei.gear-branch"],
    ["unit", null]
  ]) {
    const kernel = hweiWorld(type);
    kernel.setAnswers({
      "hwei.gear-branch/hwei.gear-ready-runes/hwei-runes": [kernel.ref("rune-one")]
    });
    // Unit 分支的连续图层原语未合入：只跑到前四条指令，验证三条条件互斥。
    const outcome = resolveChainBody(prepareCallerBody(ability.body.slice(0, 4), "A"), kernel);
    const executed = outcome.results
      .filter((entry) => entry.id.endsWith("-branch") && entry.result.status === "executed")
      .map((entry) => entry.id);
    assert.deepEqual(executed, expectedBranch === null ? [] : [expectedBranch], type);
  }
});

test("unl-080-219 Hwei, Brooding Painter: the Unit branch cannot dispatch without continuous.might", () => {
  const kernel = hweiWorld("unit");
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  // 目标锚点（object: "self"）指向上文宿主；宿主仍在场时解释器进入派发阶段，
  // 真实注册表对未注册的 continuous.might 直接抛出。
  const hostBound = kernel.clone({ sourceSnapshot: kernel.getObject("hwei") });
  hostBound.setTargets("hwei.me", [hostBound.ref("hwei")]);
  assert.throws(
    () => runAbilityBody([unitBranch.args.body.value[0]], hostBound, instructionDefinitionsById),
    /Unregistered instruction opcode: continuous\.might/
  );
});

test.todo(
  "unl-080-219 Hwei, Brooding Painter: 'When I move' attribution needs the object-moved payload to " +
    "carry the moving object / from-to location (449.1/449.2, Recall excluded by 458); today the " +
    "move-location action carries no source and the declared payload fields stay unset (RIFT-90/RIFT-120)"
);
test.todo(
  "unl-080-219 Hwei, Brooding Painter: 'based on the discarded card's type' needs a supportable read of " +
    "the discard result; effect.discard links { count, player, objects } and the interpreter's linked " +
    "selector only resolves plain reference values/arrays, so the card supplies the discarded card " +
    "through a non-target pick whose membership the production finalize must lock (RIFT-90)"
);
test.todo(
  "unl-080-219 Hwei, Brooding Painter: the Unit branch 'Give me +3 :rb_might: this turn' needs the " +
    "continuous.might layers primitive (RIFT-91)"
);
test.todo(
  "unl-080-219 Hwei, Brooding Painter: registering the card's triggered ability as a TriggerRegistration " +
    "(production chain/event pipeline) is shared wiring tracked by the coordinator (RIFT-120)"
);
