import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import voidSeeker from "../../../dist/cards/ogn/void-seeker.js";

const [speed, play] = voidSeeker.abilities;

test("Void Seeker program is structurally valid and executable", () => {
  const result = validateCardProgram(voidSeeker);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(voidSeeker.status, "executable");
  assert.equal(
    voidSeeker.canonicalCardId,
    "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10"
  );
  assert.match(voidSeeker.sourceText, /Deal 4 to a unit at a battlefield\. Draw 1\./);
});

test("Void Seeker ability structure: [Action] keyword + play body", () => {
  assert.equal(voidSeeker.abilities.length, 2);

  // [Action] is a speed keyword ability (v1.5 806), expanded by the engine's
  // keyword registry — the card only names it.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["damage", "effect.damage"],
      ["draw", "effect.draw"]
    ]
  );

  // "Deal 4 to a unit at a battlefield": exactly one target spec, one unit
  // at a battlefield; amount is the printed constant 4.
  const damageInstruction = play.body[0];
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(damageInstruction.targets[0].id, "unit-at-battlefield");
  assert.equal(damageInstruction.targets[0].selection, "one");
  assert.equal(damageInstruction.targets[0].filter.type, "unit");
  assert.deepEqual(damageInstruction.args.amount, { kind: "literal", value: 4 });

  // "Draw 1." is a separate sentence: it does NOT link to the damage
  // instruction, so a replaced/negated damage does not stop the draw
  // (v1.5 359.3.e.14).
  const drawInstruction = play.body[1];
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "literal", value: 1 });
});

test("Void Seeker golden: deals 4 to the targeted unit and draws 1", () => {
  const kernel = world()
    .deck("drawn-card")
    .unit("enemy-unit-id", { owner: "B", might: 3 })
    .build();
  const targetRef = kernel.ref("enemy-unit-id");
  const [damageInstruction, drawInstruction] = play.body;

  const dealt = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: "unit-at-battlefield" },
    { world: kernel, targets: { "unit-at-battlefield": [targetRef] } }
  );
  assert.equal(dealt.result.status, "executed");
  assert.equal(dealt.linked.dealt, 4);
  assert.equal(dealt.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy-unit-id").damage, 4);

  const drawn = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );
  assert.equal(drawn.result.status, "executed");
  assert.equal(drawn.linked.drawn, 1);
  assert.equal(drawn.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Void Seeker golden: damage source is the spell itself (CR 418.6.a)", () => {
  const kernel = world()
    .unit("enemy-unit-id", { owner: "B", might: 5 })
    .build();
  const targetRef = kernel.ref("enemy-unit-id");
  const damageInstruction = play.body[0];

  const dealt = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: "unit-at-battlefield" },
    { world: kernel, targets: { "unit-at-battlefield": [targetRef] } }
  );
  assert.equal(dealt.result.status, "executed");
  // effect.damage defaults source to the resolving spell (the test-world
  // source snapshot), matching CR 418.6.a; the damage is non-combat.
  assert.equal(dealt.linked.dealt, 4);
  assert.equal(kernel.getObject("enemy-unit-id").damage, 4);
  const recorded = kernel.events.filter((event) => event.action === "damage");
  assert.equal(recorded.length, 1);
});

test.todo(
  "Void Seeker full chain play: spell cast pays 3 energy + 1 Fury power and [Action] showdown " +
    "permission is enforced (依赖 RIFT-82 费用系统 / RIFT-81 目标解析 / RIFT-89 continuous.timing)"
);
