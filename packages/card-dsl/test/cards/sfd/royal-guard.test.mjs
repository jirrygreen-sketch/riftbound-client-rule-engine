import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/royal-guard.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CREATE_ID = "royal-guard.create-sand-soldier";
const PLAY_ID = "royal-guard.play-sand-soldier";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

test("sfd-157-221 Royal Guard: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de"
  );
  assert.equal(
    program.sourceText,
    "When you play me, play a 2 :rb_might: Sand Soldier unit token here."
  );
});

test("sfd-157-221 Royal Guard: card-played self trigger with linked create→play body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.trigger.filter.self, true);
  assert.equal(ability.optional, false);

  const [create, play] = ability.body;
  assert.equal(create.id, CREATE_ID);
  assert.equal(create.op, "effect.token");
  assert.deepEqual(create.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(create.args.amount, { kind: "constant", value: 1 });
  // CR v1.5 440.2.c / 185.2.a：被"打出"的 token 先在链上生成。
  assert.deepEqual(create.args.mode, { kind: "constant", value: "play" });

  assert.equal(play.id, PLAY_ID);
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, CREATE_ID);
  assert.equal(play.args.object.kind, "linked-value");
  assert.equal(play.args.object.instructionId, CREATE_ID);
});

test("sfd-157-221 Royal Guard: create-token step creates the CR 187.3 Sand Soldier at the source location", () => {
  const [ability] = program.abilities;
  const [create] = ability.body;
  const kernel = world()
    .unit("royal-guard", { zone: "board", location: BATTLEFIELD, might: 3 })
    .build();
  const sourceRef = kernel.ref("royal-guard");
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "sand-soldier" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "create" },
      location: { kind: "object-property", object: sourceRef, property: "location" },
      linkKey: { kind: "constant", value: "sandSoldier" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [created] = kernel
    .query({ zone: "board", type: "unit" })
    .filter((object) => object.isToken);
  assert.equal(created.name, "Sand Soldier");
  assert.equal(created.might, 2);
  assert.deepEqual(created.tags, ["Shurima"]);
  assert.deepEqual(created.location, BATTLEFIELD);
  assert.equal(created.controller, "A");
  assert.equal(run.linked["sandSoldier.amount"], 1);
  // 卡牌程序中的 mode 是 "play"（链上生成，440.2.c）；本测试用参考内核支持
  // 的 "create" 路径验证 token 定义与 "here" 位置求值，链上生成路径见 test.todo。
  assert.equal(create.args.mode.value, "play");
});

test.todo(
  "sfd-157-221 Royal Guard: mode \"play\"（440.2.c 链上生成 + effect.play 打出流程）" +
    "依赖链上 token 创建与打出管线（RIFT-26 scenarios-chain / RIFT-66+ effect.play 完整化）； " +
    "当前 effect.token 对 mode \"play\" 显式 blocked（token-play-requires-chain-creation）"
);
