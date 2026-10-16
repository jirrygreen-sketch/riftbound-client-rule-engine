import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/unsung-hero.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BODY_ID = "unsung-hero.draw-2";

test("sfd-167-221 Unsung Hero: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103"
  );
  assert.equal(program.sourceText.includes("[Deathknell]"), true);
});

test("sfd-167-221 Unsung Hero: Deathknell keyword + object-killed trigger with Mighty condition", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.equal(triggered.trigger.filter.self, true);
  assert.equal(triggered.optional, false);

  // CR 808.1.c.2: "If I was Mighty" 在过去式下指触发进链那一刻——
  // 条件挂在 TriggerSpec 上（进链前判定），不是 body 指令级条件。
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });
  assert.equal(condition.left.kind, "object-property");
  assert.equal(condition.left.property, "might");
});

test("sfd-167-221 Unsung Hero: body draws exactly 2 with a single unlinked instruction", () => {
  const [, triggered] = program.abilities;
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, BODY_ID);
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("sfd-167-221 Unsung Hero: effect.draw body executes against the reference kernel", () => {
  const [, triggered] = program.abilities;
  const [instruction] = triggered.body;
  const kernel = world().deck(["c1", "c2", "c3"]).build();
  const run = runInstruction(
    draw,
    { amount: { kind: "constant", value: 2 } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(instruction.args.amount.value, 2);
});

test.todo(
  "sfd-167-221 Unsung Hero: Deathknell keyword expansion (订阅 object-killed、808.1.d.1 " +
    "死亡被替代时移出链、808.1.d.3 进链前记录 last-known) 依赖关键词注册表与触发管线" +
    "（RIFT-81~91 关键词任务）；触发条件的 might-changed/Mighty 判定依赖图层结算" +
    "（RIFT-32 scenarios-layers）"
);
