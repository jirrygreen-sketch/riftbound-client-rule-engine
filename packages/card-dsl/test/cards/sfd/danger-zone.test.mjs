import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";

import dangerZone from "../../../dist/cards/sfd/danger-zone.js";

const [speed, play] = dangerZone.abilities;

test("Danger Zone program is structurally valid and judge-required", () => {
  const result = validateCardProgram(dangerZone);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(dangerZone.status, "judge-required");
  assert.match(dangerZone.judgeReason, /might/i);
  assert.match(dangerZone.judgeReason, /Repeat/);
  assert.equal(
    dangerZone.canonicalCardId,
    "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e"
  );
  assert.match(dangerZone.sourceText, /Give your Mechs \+1/);
});

test("Danger Zone ability structure: [Reaction] + play with Repeat additional cost", () => {
  assert.equal(dangerZone.abilities.length, 2);

  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  assert.equal(play.kind, "play");

  // [Repeat] 1 energy + 1 rainbow rune: declared as an additional cost on
  // the play ability (contract 3.1 CostSpec), pending the Repeat KeywordDef
  // (RIFT-86 added only the effect.repeat instruction primitive).
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.keyword, "repeat");
  assert.deepEqual(play.cost.energy, { kind: "literal", value: 1 });
  assert.deepEqual(play.cost.power, { kind: "literal", value: ["rainbow"] });

  // "Give your Mechs +1 Might this turn" is an each-set, NOT a target
  // (v1.5 355.7), so the instruction carries no TargetSpec.
  assert.equal(play.body.length, 1);
  const buff = play.body[0];
  assert.equal(buff.id, "buff-mechs");
  assert.equal(buff.targets, undefined);
  assert.deepEqual(buff.args.amount, { kind: "literal", value: 1 });
  assert.deepEqual(buff.args.appliesTo, {
    kind: "literal",
    value: { type: "unit", tag: "Mech", controller: "you" }
  });
});

test.todo(
  "Danger Zone team buff: each friendly Mech gets +1 Might this turn (持续效果图层, " +
    "依赖 RIFT-83/84 layers / continuous.might 原语)"
);

test.todo(
  "Danger Zone Repeat: paying 1 energy + 1 rainbow rune repeats the buff (v1.5 820; " +
    "依赖 RIFT-86 Repeat KeywordDef 合入与 effect.repeat 的持续效果动作接入)"
);
