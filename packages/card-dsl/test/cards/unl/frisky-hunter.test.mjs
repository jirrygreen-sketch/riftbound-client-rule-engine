import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/frisky-hunter.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3a7cc51beec4c03c4ab2831bc17b65610301b0eacb31ebfd269232c29dea5258";
const SOURCE_TEXT =
  "When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here. " +
  "(Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [ability] = program.abilities;
const [playBird] = ability.body;

test("unl-033-219 Frisky Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-033-219 Frisky Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /RIFT-62/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("unl-033-219 Frisky Hunter: card-played self trigger plays the CR 187.7 Bird token here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 420.4.a：打出完成的时点；符号选择器指向能力来源。
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);

  assert.equal(playBird.id, "frisky-hunter.play-bird");
  assert.equal(playBird.op, "effect.token");
  // 187.7：1 [M] Bird token（域外、Bird 标签、带 [Deflect]）。
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成，再交给 play 动作。
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  // “here” = 结算时来源所在的位置（契约 3.6 的符号选择器；argsSchema 尚未同步该形状）。
  assert.deepEqual(playBird.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "bird" });
  assert.equal(playBird.targets, undefined);
  assert.equal(playBird.picks, undefined);
  assert.equal(playBird.linkedTo, undefined);
});

test("unl-033-219 Frisky Hunter golden: the same play-mode shape really creates and plays a defined token", () => {
  // 证明指令形状就是已合入的 440.2.c / 185.2.a 交接路径（只在卡面上把定义换成 merged 的 mech）：
  // 缺的只是 187.7 的 Bird 定义本身，不为 Bird 发明语义。
  const kernel = world()
    .unit("frisky-hunter", { zone: "board", location: BATTLEFIELD, might: 3 })
    .build();
  const run = runInstruction(
    token,
    {
      ...playBird.args,
      token: { kind: "constant", value: "mech" },
      location: {
        kind: "object-property",
        object: kernel.ref("frisky-hunter"),
        property: "location"
      }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [created] = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.name, "Mech");
  assert.equal(created.might, 3);
  assert.deepEqual(created.location, BATTLEFIELD);
  assert.equal(created.controller, "A");
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  assert.deepEqual(run.events.map((event) => `${event.action}@${event.timingPoint}`), [
    "create-token@chain-item-pending",
    "play@card-played"
  ]);
});

test.todo(
  "unl-033-219 Frisky Hunter: add the CR 187.7 1 [M] Bird unit token (domainless, Bird tag, [Deflect]) " +
    "to the effect.token definition table"
);
test.todo(
  "unl-033-219 Frisky Hunter: decode the symbolic 'here' location (contract 3.6 ObjectSelector) in " +
    "effect.token.argsSchema so the card's own IR shape executes as written (RIFT-62 / RIFT-1)"
);
test.todo(
  "unl-033-219 Frisky Hunter: the Bird's [Deflect] target tax with any-domain Power payment " +
    "(CR 809.1.c.1) needs the target-plan tax consumer (RIFT-90)"
);
test.todo(
  "unl-033-219 Frisky Hunter: fire the card-played trigger from the real chain flow (CR 420.4.a) — " +
    "depends on RIFT-120 chain/event integration"
);
