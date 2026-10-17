import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/corrupted-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-76b98152cdda4a936f20bb7632ab2dd6facf87c9a279ac99c372403ba7e8bfe8";
const SOURCE_TEXT =
  "If your score is not within 3 points of the Victory Score, I enter ready.\n" +
  "When I attack, you may move any number of enemy units here each with 5 :rb_might: or less " +
  "to their base.";

const [enterReady, attackTrigger] = program.abilities;
const [moveEnemiesHome] = attackTrigger.body;

test("ven-091-166 Corrupted Dragon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-091-166 Corrupted Dragon: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-091-166 Corrupted Dragon: 'I enter ready' is an entry replacement, not a post-entry effect.ready (359.2.c/369.3)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].id, "corrupted-dragon.enter-ready");
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  // 194.3 / 194.3.a：“within 3 points of the Victory Score”需要当前 Victory Score 读数，
  // PlayerSnapshot 与 Condition 都没有该谓词，硬编码 8 就是臆造（见 judgeReason 第 2 条）。
  assert.equal(enterReady.condition.kind, "expression");
  assert.deepEqual(enterReady.condition.value, {
    kind: "constant",
    value: "your-score-not-within-3-of-victory-score"
  });
});

test("ven-091-166 Corrupted Dragon: 'When I attack' is a self-scoped attack trigger (383.4.e)", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.trigger.condition, undefined);
  assert.equal(attackTrigger.trigger.once, undefined);
  // 383.3.a：首段 may 只在触发 Finalize 询问一次，body 不重复询问。
  assert.equal(attackTrigger.optional, true);
  assert.equal(attackTrigger.body.length, 1);
  assert.equal(moveEnemiesHome.id, "corrupted-dragon.move-enemies-home");
  assert.equal(moveEnemiesHome.op, "effect.move");
});

test("ven-091-166 Corrupted Dragon: the chosen body moves up to any number of enemy units here to their base", () => {
  assert.equal(moveEnemiesHome.id, "corrupted-dragon.move-enemies-home");
  assert.equal(moveEnemiesHome.op, "effect.move");
  // 355.7 / 355.9.a.1："enemy units here" 是目标选择；"here" 用 sameLocationAs 锚点。
  assert.deepEqual(moveEnemiesHome.targets, [
    {
      id: "corrupted-dragon.enemy-units-here",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: "self",
        // 143.2.a 的有效 Might 上限是描述性占位：冻结的 ObjectFilter 没有 Might 谓词
        //（见 judgeReason 第 3 条）。
        mightLte: 5
      },
      min: 0,
      selection: "up-to"
    }
  ]);
  // effect.move 的 objects 形状是单键选择器 { target: id }（同 sfd/janna-savior）。
  assert.deepEqual(moveEnemiesHome.args.objects, {
    kind: "constant",
    value: { target: "corrupted-dragon.enemy-units-here" }
  });
  // 421.1 / "to their base"：目的地随每个被移动对象的控制者。
  assert.deepEqual(moveEnemiesHome.args.to, { kind: "constant", value: "controller-base" });
  // 355.13："any number" 的上限是实际被选中的数量。
  assert.equal(moveEnemiesHome.args.amount.kind, "count");
  assert.deepEqual(moveEnemiesHome.args.amount.filter, {
    object: { target: "corrupted-dragon.enemy-units-here" }
  });
  assert.equal(moveEnemiesHome.linkedTo, undefined);
  assert.equal(moveEnemiesHome.picks, undefined);
});

test("ven-091-166 golden: the declared move relocates locked enemy units to their own base (421.1)", () => {
  // Sub-effect evidence only: target eligibility still needs the Might predicate.
  // Execute the existing move primitive with a legal locked group.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("enemy-a", {
      owner: "B",
      controller: "B",
      might: 2,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy-b", {
      owner: "B",
      controller: "B",
      might: 5,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("far-enemy", {
      owner: "B",
      controller: "B",
      might: 1,
      location: { type: "battlefield", id: "bf-2" }
    })
    .build();
  const locked = [kernel.ref("enemy-a"), kernel.ref("enemy-b")];

  const run = runInstruction(
    move,
    {
      objects: moveEnemiesHome.args.objects,
      to: moveEnemiesHome.args.to,
      amount: { kind: "constant", value: 2 }
    },
    { world: kernel, targets: { "corrupted-dragon.enemy-units-here": locked } }
  );

  assert.equal(run.result.status, "executed");
  // “to their base”：每个单位回到其控制者自己的 Base。
  assert.deepEqual(kernel.getObject("enemy-a").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.getObject("enemy-b").location, { type: "base", player: "B" });
  // An enemy at another battlefield is not part of the locked selection.
  assert.deepEqual(kernel.getObject("far-enemy").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(run.linked.moved.movements, [
    {
      object: locked[0],
      from: { type: "battlefield", id: "bf-1" },
      to: { type: "base", player: "B" }
    },
    {
      object: locked[1],
      from: { type: "battlefield", id: "bf-1" },
      to: { type: "base", player: "B" }
    }
  ]);
});

test("ven-091-166 golden: 'any number' permits moving none (355.13)", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("enemy-a", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();

  const run = runInstruction(
    move,
    {
      objects: moveEnemiesHome.args.objects,
      to: moveEnemiesHome.args.to,
      // The printed "any number" includes zero; the Declaration of 0 comes from
      // the amount evaluated on the card, not from a rewritten primitive.
      amount: { kind: "constant", value: 0 }
    },
    { world: kernel, targets: { "corrupted-dragon.enemy-units-here": [kernel.ref("enemy-a")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy-a").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(run.linked.moved, { count: 0, objects: [], movements: [] });
});




test("corrupted-dragon: the review records the current blockers", () => {
  assert.match(program.judgeReason, /194\.3/);
  assert.match(program.judgeReason, /Victory Score/);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test.todo("corrupted-dragon: 194.3/194.3.a: read current Victory Score and player score for conditional entry readiness");

test.todo("corrupted-dragon: 143.2.a: enforce current Might <= 5 and bind sameLocationAs in program targets (RIFT-359)");

test.todo("corrupted-dragon: emit attack-declared from actual combat designation changes (383.4.e/f)");
