import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/thousand-tailed-watcher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const [accelerate, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Thousand-Tailed Watcher program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Thousand-Tailed Watcher identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-0c45b29063c3531b9891e06fa06538c7ff50e7ecd9a1f6f1147e18ee33176c81"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
      "When you play me, give enemy units -3 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Accelerate] keyword plus the play-effect debuff", () => {
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  // 383.4.a："When you play me" 是 Play Effect（打出触发）。
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  const [debuff] = triggered.body;
  assert.equal(debuff.id, "watcher.debuff-enemy-units");
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, c(-3));
  assert.deepEqual(debuff.args.duration, c("this-turn"));
  assert.deepEqual(debuff.args.minimum, c(1));
  // 355.10.d："enemy units" 是按特征选择的集合，不是目标。
  assert.equal(debuff.targets, undefined);
  assert.equal(debuff.picks, undefined);
  assert.deepEqual(debuff.args.objects, c({
    kind: "query",
    filter: { zone: "board", type: "unit", controller: "opponent" }
  }));
});

test.todo(
  "Thousand-Tailed Watcher: give enemy units -3 Might this turn with the printed minimum of 1 clamp " +
    "and end-of-turn expiry (continuous.might + continuous.duration, RIFT-91; effect.buff is the 702–705 " +
    "Buff counter and cannot substitute)"
);

test.todo(
  "Thousand-Tailed Watcher: [Accelerate] expansion — optional {1 energy + 1 Mind power} additional cost " +
    "and the enter-ready replacement (RIFT-89 + the entry replacement pipeline)"
);
