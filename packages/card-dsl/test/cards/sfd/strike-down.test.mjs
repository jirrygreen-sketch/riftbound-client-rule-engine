import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import detach from "../../../../engine-core/dist/effects/instructions/effect.detach.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import strikeDown from "../../../dist/cards/sfd/strike-down.js";

const [play] = strikeDown.abilities;
const [damageInstruction, detachInstruction] = play.body;

test("Strike Down program is structurally valid and judge-required", () => {
  const result = validateCardProgram(strikeDown);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(strikeDown.status, "judge-required");
  assert.match(strikeDown.judgeReason, /pick/i);
  assert.equal(
    strikeDown.canonicalCardId,
    "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177"
  );
  assert.match(strikeDown.sourceText, /deals damage equal to its Might/);
});

test("Strike Down ability structure: no speed keyword, pick + target + linked detach", () => {
  // This printing's ability line has no [Action]/[Reaction] keyword, so the
  // program holds exactly one play ability with default spell timing (159.2).
  assert.equal(strikeDown.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["damage", "effect.damage"],
      ["detach", "effect.detach"]
    ]
  );

  // "Choose an equipped friendly unit" — a pick, NOT a target (355.10), so it
  // must not trigger became-target effects.
  assert.equal(damageInstruction.picks.length, 1);
  assert.equal(damageInstruction.picks[0].id, "picked-unit");
  assert.equal(damageInstruction.picks[0].selection, "one");
  assert.equal(damageInstruction.picks[0].filter.type, "unit");
  assert.equal(damageInstruction.picks[0].filter.controller, "you");
  assert.equal(damageInstruction.picks[0].filter.equipped, true);

  // "It deals damage ... to an enemy unit": the enemy unit is the only target.
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(damageInstruction.targets[0].id, "enemy-unit");
  assert.equal(damageInstruction.targets[0].filter.controller, "opponent");

  // "Then detach an Equipment from it": linked to the damage instruction so a
  // host that left or lost its Equipment (359.3.e.12) also ignores this one,
  // and the detached Equipment is picked (not targeted).
  assert.equal(detachInstruction.linkedTo, "damage");
  assert.equal(detachInstruction.targets, undefined);
  assert.equal(detachInstruction.picks.length, 1);
  assert.equal(detachInstruction.picks[0].filter.type, "equipment");
  assert.deepEqual(detachInstruction.args.pick, { kind: "literal", value: "detached-equipment" });
});

test("Strike Down golden: detach removes the picked Equipment from its host", () => {
  const kernel = world().unit("attacker", { owner: "A", might: 3 }).build();
  const attackerRef = kernel.ref("attacker");
  const swordRef = kernel.addObject(
    {
      ...kernel.getObject("attacker"),
      ref: { id: "sword", zoneEntryId: 1 },
      cardId: "card:sfd-103",
      name: "Sword",
      types: ["equipment"],
      tags: ["Equipment"],
      zone: "board",
      attachedTo: attackerRef
    },
    "board"
  );

  const run = runInstruction(detach, { pick: "detached-equipment" }, {
    world: kernel,
    picks: { "detached-equipment": [swordRef] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 1);
  assert.equal(kernel.getObject("sword").attachedTo, null);
});

test.todo(
  "Strike Down damage: the picked unit deals damage equal to its Might (CR 418.6.b.3) to the " +
    "targeted enemy unit (依赖契约新增“读 pick 结果属性”的表达式形式 / RIFT-81 目标解析)"
);

test.todo(
  "Strike Down full play: cast pays 3 energy + 1 Body power; the equipped-friendly-unit pick " +
    "and enemy-unit target are resolved by the engine (依赖 RIFT-81 目标解析 / RIFT-82 费用系统)"
);
