import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/antagonistic-apparatus.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ENTER_READY = "antagonistic-apparatus.enter-ready";
const PLAY_MECH = "antagonistic-apparatus.play-mech";
const BATTLEFIELD = { type: "battlefield", id: "bf-9" };

test("rad-009-167 Antagonistic Apparatus: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-a9bb0cc78cd6afeac937db36c78625e7d815c1cd4442e8115cc6f1243277c6d0"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "I enter ready.\nWhen you play me, play a ready 3 :rb_might: Mech unit token here."
  );
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /entry override|Entry overrides/i);
});

test("rad-009-167: enter-ready replacement plus card-played Mech token body", () => {
  assert.equal(program.abilities.length, 2);
  const [replacement, triggered] = program.abilities;
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(replacement.with.length, 1);
  assert.equal(replacement.with[0].id, ENTER_READY);
  assert.equal(replacement.with[0].op, "effect.ready");

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, PLAY_MECH);
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 新 token 经链上生成后打出（440.2.c / 185.2.a）。
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // “here” 读来源当前位置（420.3.b.2 结算时求值），用契约 3.6 符号选择器 "source"。
  assert.deepEqual(instruction.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
});

test("rad-009-167: enter-ready replacement body resolves against the exhausted source", () => {
  const kernel = world().unit("apparatus", { might: 3, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("apparatus") });
  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("apparatus").exhausted, true);
  assert.equal(scoped.getObject("apparatus").exhausted, false);
});

test("rad-009-167: the Mech definition lands at the source location (CR 187.4)", () => {
  // “play” 的链上生成 + 入场改写未合入；测试按 effect.token 文档支持的 create 路径执行同一
  // 定义与位置表达式，验证 Mech token 的 3 Might / Mech tag / “here” 位置，链路径写 TODO。
  const kernel = world().unit("apparatus", { might: 3, location: BATTLEFIELD }).build();
  const instruction = program.abilities[1].body[0];
  const createOnly = {
    ...instruction,
    args: {
      ...instruction.args,
      mode: { kind: "constant", value: "create" },
      location: { kind: "constant", value: BATTLEFIELD }
    }
  };
  const outcome = resolveChainBody([createOnly], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  const tokens = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Mech");
  assert.equal(tokens[0].might, 3);
  assert.deepEqual(tokens[0].tags, ["Mech"]);
  assert.deepEqual(tokens[0].location, BATTLEFIELD);
  assert.equal(tokens[0].controller, "A");
});

test.todo(
  "rad-009-167 Antagonistic Apparatus: “I enter ready.” 的入场替代（143.4 + 369.3）依赖" +
    "replacement.enter 管线（RIFT-83/RIFT-84）"
);
test.todo(
  "rad-009-167 Antagonistic Apparatus: “play a ready … token here” 的“入场就绪”改写无表达位置" +
    "（effect.token 不支持 entry override，143.4.a / 184.1；不能用 effect.ready 事后补一次就绪）"
);
test.todo(
  "rad-009-167 Antagonistic Apparatus: mode \"play\" 的链上生成 + 打出流程（440.2.c / 185.2.a / " +
    "350.2 / 354）依赖链管线接线"
);
