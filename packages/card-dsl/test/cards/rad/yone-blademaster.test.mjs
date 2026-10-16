import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/yone-blademaster.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BODY_ID = "yone-blademaster.deal-might";
const TARGET_ID = "enemy-unit-in-base";

test("rad-181-167 Yone, Blademaster: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56"
  );
  assert.equal(program.sourceText.includes("[Weaponmaster]"), true);
  assert.equal(program.sourceText.includes("uncontrolled"), true);
});

test("rad-181-167 Yone, Blademaster: Weaponmaster keyword + conquer trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "weaponmaster" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.equal(triggered.trigger.filter.self, true);
  // RAD 印刷："a battlefield that was uncontrolled"（CR 170.11.b）。
  assert.equal(triggered.trigger.filter.battlefieldWas, "uncontrolled");
  assert.equal(triggered.optional, false);
});

test("rad-181-167 Yone, Blademaster: damage body targets one enemy unit in a base with dynamic Might amount", () => {
  const [, triggered] = program.abilities;
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, BODY_ID);
  assert.equal(instruction.op, "effect.damage");
  assert.equal(instruction.args.amount.kind, "object-property");
  assert.equal(instruction.args.amount.property, "might");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(instruction.args.source, { kind: "constant", value: "self" });

  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, TARGET_ID);
  assert.equal(spec.filter.type, "unit");
  assert.equal(spec.filter.controller, "opponent");
  assert.deepEqual(spec.filter.location, { type: "base" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("rad-181-167 Yone, Blademaster: effect.damage deals the source's Might to an enemy unit in a base", () => {
  const kernel = world()
    .unit("yone", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 5
    })
    .unit("enemy", {
      owner: "B",
      zone: "board",
      location: { type: "base", player: "B" },
      might: 3
    })
    .build();
  const yoneRef = kernel.ref("yone");
  const enemyRef = kernel.ref("enemy");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("yone") });
  const run = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: yoneRef, property: "might" },
      target: TARGET_ID,
      source: "self"
    },
    {
      world: scoped,
      targets: { [TARGET_ID]: [enemyRef] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 5);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(scoped.getObject("enemy").damage, 5);
  assert.equal(run.events[0].action, "damage");
});

test.todo(
  "rad-181-167 Yone, Blademaster: Weaponmaster 关键词展开（821 打出触发：选 Equipment、" +
    "Equip 费减 [A]、立即附着）依赖关键词注册表与 cost.modify/effect.attach 管线" +
    "（RIFT-81~91 关键词任务）；conquer 触发的 battlefieldWas \"uncontrolled\" 过滤" +
    "依赖征服时点对战场先前控制状态的记录（RIFT-31 scenarios-scoring / RIFT-33 " +
    "scenarios-triggers）"
);
