import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/industrious-mechsmith.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-fd4d12013cc7cd7178ca0dc066919c845a2ca4cf3a00d76ebd6d1532e7fff561";
const SOURCE_TEXT = "When you play me, play a 3 :rb_might: Mech unit token here.";

const [triggered] = program.abilities;
const [instruction] = triggered.body;

test("rad-049-167 Industrious Mechsmith: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-049-167 Industrious Mechsmith: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /here/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-049-167 Industrious Mechsmith: card-played self trigger plays the CR 187.4 Mech token", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  assert.equal(instruction.id, "industrious-mechsmith.play-mech-token");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a：被"打出"的 token 先在链上创建，再交给 play 动作。
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // "here" 用契约 3.6 的符号选择器；effect.token 的 argsSchema 尚未同步该形状（见 judgeReason）。
  assert.deepEqual(instruction.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "mechToken" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-049-167 Industrious Mechsmith golden: effect.token play-mode really creates and plays the Mech at the source location", () => {
  const kernel = world()
    .unit("industrious-mechsmith", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 1
    })
    .build();
  // effect.token 的 location 只接受具体 LocationRef 或 target/pick 推导；测试按 Finalize 提供
  // 的"来源当前位置"注入真实引用（静态 IR 里是上面的符号选择器，见 README 第 3 节的依赖说明）。
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "object-property", object: kernel.ref("industrious-mechsmith"), property: "location" },
      linkKey: { kind: "constant", value: "mechToken" }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  const [created] = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.name, "Mech");
  assert.equal(created.might, 3);
  assert.deepEqual(created.tags, ["Mech"]);
  assert.deepEqual(created.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(created.controller, "A");
  assert.equal(created.cardId, null);
  assert.equal(created.energy, null);
  assert.equal(run.linked["mechToken.amount"], 1);
  assert.deepEqual(run.events.map((event) => `${event.action}@${event.timingPoint}`), [
    "create-token@chain-item-pending",
    "play@card-played"
  ]);
});

test("rad-049-167 Industrious Mechsmith golden: a replacement on the play action negates the instruction and leaves no token", () => {
  const kernel = world().unit("industrious-mechsmith", { zone: "board", location: { type: "base", player: "A" } }).build();
  kernel.addReplacement((action) => (action.type === "play" ? "replaced" : null));
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "object-property", object: kernel.ref("industrious-mechsmith"), property: "location" },
      linkKey: { kind: "constant", value: "mechToken" }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken), []);
  // 链上创建已经发生，只有 play 被替代；链接值保留实际发生的那一步（effect.token 的 objectsComplete 语义）。
  assert.equal(run.linked["mechToken.createdAmount"], 1);
  assert.equal(run.linked["mechToken.amount"], 0);
});

test("rad-049-167 Industrious Mechsmith: effect.token is registered", () => {
  assert.equal(instructionDefinitionsById.get("effect.token"), token);
});

test.todo(
  "rad-049-167 Industrious Mechsmith: decode the symbolic 'here' location (contract 3.6 ObjectSelector) in " +
    "effect.token.argsSchema so the card's own IR shape executes as written — depends on RIFT-62 (primitive arg parsing) " +
    "and contract sync (RIFT-1)"
);

test.todo(
  "rad-049-167 Industrious Mechsmith: fire the card-played trigger from the real chain flow (CR 420.4.a) — " +
    "depends on RIFT-120 chain/event integration"
);
