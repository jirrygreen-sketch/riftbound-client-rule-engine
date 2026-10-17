import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/amateur-demolitionist.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const BATTLEFIELD_PICK = "amateur-demolitionist.battlefield";
const PLAY_BOMB = "amateur-demolitionist.play-bomb";

test("rad-001-167 Amateur Demolitionist: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-19dbd19038a6e261cba3253b41f902ba0a6e7533f33da771cc4fd6b644de55ec"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play me, play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)"
  );
  assert.match(program.judgeReason, /bomb/i);
  assert.match(program.judgeReason, /effect\.token/);
});

test("rad-001-167: card-played self trigger plays a Bomb gear token to a chosen battlefield", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);

  const [instruction] = ability.body;
  assert.equal(instruction.id, PLAY_BOMB);
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.pick, { kind: "constant", value: BATTLEFIELD_PICK });

  // "to a battlefield" 是地点选择、不是目标（355.10.b），所以用 picks 而不是 targets。
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks.length, 1);
  const [pick] = instruction.picks;
  assert.equal(pick.id, BATTLEFIELD_PICK);
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
  assert.equal(pick.selection, "one");
  assert.deepEqual(pick.filter, { type: "battlefield" });
});

test("rad-001-167: the Bomb token body cannot create a token while its definition stays outside the table", () => {
  // 真实执行卡牌原始 body：effect.token 的冻结定义表没有 bomb，因此不创建任何 token
  // （不近似成 Mech / Gold 等已有定义）。这里断言「没有 token 被创建」这一持久事实，
  // 不锁定原语当前的 negated/blockedReason 结果（定义表扩展后该断言会失效）。
  const kernel = world()
    .unit("demolitionist", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .object("bf", {
      name: "bf",
      types: ["battlefield"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      energy: null,
      power: null
    })
    .build();
  kernel.setPicks(BATTLEFIELD_PICK, [kernel.ref("bf")]);

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "partial");
  const [result] = outcome.results;
  assert.equal(result.id, PLAY_BOMB);
  assert.notEqual(result.result.status, "executed");
  assert.deepEqual(kernel.query({ zone: "board", type: "token" }), []);
});

test.todo(
  "rad-001-167 Amateur Demolitionist: Bomb gear token 定义（CR 187.12 的 [Deploy] + " +
    "[Deathknell][>] Deal 2 to an enemy unit here and kill all other Bombs you control here）" +
    "缺失于 effect.token 冻结定义表（Deploy/Deathknell 的 KeywordDef 已合入，但定义表仍是闭集）"
);
test.todo(
  "rad-001-167 Amateur Demolitionist: mode \"play\" 的链上生成 + 打出（CR 440.2.c / 185.2.a / " +
    "350.2 / 354）在生产链上需要 Finalize 费用交接与 CardProgram 绑定（RIFT-261 / RIFT-257）"
);
