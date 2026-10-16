import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";

import punchFirst from "../../../dist/cards/sfd/punch-first.js";

const [speed, play] = punchFirst.abilities;

test("Punch First program is structurally valid and judge-required", () => {
  const result = validateCardProgram(punchFirst);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(punchFirst.status, "judge-required");
  assert.match(punchFirst.judgeReason, /might/i);
  assert.equal(
    punchFirst.canonicalCardId,
    "card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3"
  );
  assert.match(punchFirst.sourceText, /\+5 :rb_might: this turn/);
});

test("Punch First ability structure: [Action] keyword + single-target buff", () => {
  assert.equal(punchFirst.abilities.length, 2);

  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  // "Give a unit +5 Might this turn": exactly one target (any one unit),
  // amount +5, duration this turn.
  const buff = play.body[0];
  assert.equal(buff.id, "buff");
  assert.equal(buff.targets.length, 1);
  assert.equal(buff.targets[0].id, "unit");
  assert.equal(buff.targets[0].selection, "one");
  assert.equal(buff.targets[0].filter.type, "unit");
  assert.deepEqual(buff.args.amount, { kind: "literal", value: 5 });
  assert.deepEqual(buff.args.duration, { kind: "literal", value: "this-turn" });
});

test.todo(
  "Punch First buff: +5 Might applied in the arithmetic layer and expiring at cleanup " +
    "(依赖 RIFT-83/84 layers / continuous.might 原语)"
);

test.todo(
  "Punch First cast: pays 1 energy + 2 Body power; [Action] showdown permission enforced " +
    "(依赖 RIFT-82 费用系统 / RIFT-89 continuous.timing)"
);
