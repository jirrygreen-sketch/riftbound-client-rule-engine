import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/sfd/show-of-strength.js";
import { validateCardProgram } from "../../../dist/ir/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";

const CARD_ID = "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f";

test("sfd-106-221 Show of Strength: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(result.value.canonicalCardId, CARD_ID);
  assert.equal(result.value.rulesetVersion, "core-1.5");
  assert.equal(result.value.status, "judge-required");
  assert.match(result.value.judgeReason, /Mighty/);
  assert.match(result.value.judgeReason, /RIFT-83/);
});

test("sfd-106-221 Show of Strength: structure — reaction keyword plus a count-driven draw", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, play] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(play.body.length, 1);
  const [instruction] = play.body;
  assert.equal(instruction.id, "draw-per-mighty");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args, {
    amount: {
      kind: "count",
      subject: "unit",
      filter: { type: "unit", controller: "you", mightGte: 5 }
    }
  });
  // 非目标集合查询：没有 targets / picks，不会触发“成为目标”类触发（355.7 / 355.10）。
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);

  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Draw 1 for each of your [Mighty] units. (A unit is Mighty while it has " +
      "5+ :rb_might:.)"
  );
});

test("sfd-106-221 Show of Strength: draw amount is the count of the controller's mighty units (reference kernel)", () => {
  // 参考内核把 mightGte 过滤为未知键忽略，因此 count 退化为“你控制的单位数”；
  // 这个 golden 锁定的是 amount = count(filter) 的求值形状与 draw 结果，而不是
  // Mighty 谓词本身（谓词归 RIFT-83 的 kw-mighty）。
  // 参考内核的 query() 只支持精确匹配，且其 matchesFilter 把 zone 精确匹配到
  // 当前 zone；卡片 IR 里的 controller: "you"（结算时由引擎解析为能力控制者）
  // 在内核里要替换成实际控制者 "A"，并补 zone: "board" 只数场上单位（牌库卡
  // 片在内核里同样带 types: ["unit"]）。Mighty 谓词由 RIFT-83 的 kw-mighty
  // 接管，这里只锁定 count -> draw 的求值形状（内核把 mightGte 当未知键忽略，
  // 所以两张 5+ Might 的我方单位都命中，另一张敌方 7 Might 单位不命中）。
  const testWorld = world()
    .deck(["deck-1", "deck-2", "deck-3"])
    .unit("mighty-1", { owner: "A", might: 6 })
    .unit("mighty-2", { owner: "A", might: 5 })
    .unit("not-mighty", { owner: "B", might: 7 })
    .build();
  const amountExpr = program.abilities[1].body[0].args.amount;
  const kernelExpr = {
    ...amountExpr,
    filter: { type: "unit", controller: testWorld.controller, zone: "board" }
  };
  const amount = testWorld.evaluate(kernelExpr);
  assert.equal(amount, 2, "count filter should see only the controller's units");

  const run = runInstruction(draw, { amount: kernelExpr }, { world: testWorld });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked?.drawn, 2);
  assert.equal(testWorld.player("A").handSize, 2);
  assert.equal(testWorld.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("sfd-106-221 Show of Strength: zero qualifying units draws zero", () => {
  const testWorld = world().deck(["deck-1"]).build();
  const amountExpr = program.abilities[1].body[0].args.amount;
  const kernelExpr = {
    ...amountExpr,
    filter: { type: "unit", controller: testWorld.controller, zone: "board" }
  };
  assert.equal(testWorld.evaluate(kernelExpr), 0);
  const run = runInstruction(draw, { amount: kernelExpr }, { world: testWorld });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked?.drawn, 0);
  assert.equal(testWorld.player("A").handSize, 0);
  assert.equal(testWorld.player("A").deckSize, 1);
});

test.todo("sfd-106-221 Show of Strength: Mighty predicate from the official kw-mighty keyword (condition.predicate / condition.value) replaces the descriptive mightGte filter — depends on RIFT-83 (keyword registry population) and RIFT-87 (condition predicate support).");

test.todo("sfd-106-221 Show of Strength: full chain play (Reaction admission in Closed State, cost payment) — depends on RIFT-84/RIFT-85 (chain admission + cost.finalized) and RIFT-83 (Reaction keyword).");
