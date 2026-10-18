import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import unyieldingSpirit from "../../../dist/cards/ogn/unyielding-spirit.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, prevention] = unyieldingSpirit.abilities;
const [preventInstruction] = prevention.with;

test("Unyielding Spirit program is structurally valid and judge-required", () => {
  const result = validateCardProgram(unyieldingSpirit);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(unyieldingSpirit.status, "judge-required");
  assert.match(unyieldingSpirit.judgeReason, /438\.7/);
  assert.match(unyieldingSpirit.judgeReason, /replacement\.prevent/);
  assert.equal(unyieldingSpirit.rulesetVersion, "core-1.5");
  assert.equal(
    unyieldingSpirit.canonicalCardId,
    "card.hash-fa0b6342e3ae249c47a5d594fc7d88556a428b685a88b0735f1aae0a62002b5b"
  );
  assert.equal(
    unyieldingSpirit.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Prevent all spell and ability damage this turn."
  );
});

test("Unyielding Spirit structure: [Reaction] keyword + damage replacement", () => {
  assert.equal(unyieldingSpirit.abilities.length, 2);
  // [Reaction] (813) is a speed keyword ability expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  // CR 438.7: Prevent is a Delayed Replacement Effect, so the card declares a
  // replacement ability over damage events (contract 3.1 replacement form).
  assert.equal(prevention.kind, "replacement");
  assert.equal(prevention.replaces.event, "damage");
  // "spell and ability damage": the intercepted scope, which the frozen damage
  // GameAction cannot discriminate yet (see judgeReason).
  assert.deepEqual(prevention.replaces.filter, { sourceKind: ["spell", "ability"] });
  assert.equal(prevention.condition, undefined);
  assert.equal(prevention.with.length, 1);
  assert.equal(
    preventInstruction.id,
    "unyielding-spirit.prevent-spell-ability-damage"
  );
  assert.equal(preventInstruction.op, "replacement.prevent");
  // "Prevent ALL ... damage this turn": the scope and window, recorded for the
  // pending primitive (438.1.b.1.c: a Prevent Value of "All" is never reduced).
  assert.deepEqual(preventInstruction.args.amount, { kind: "constant", value: "all" });
  assert.deepEqual(preventInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(preventInstruction.args.appliesTo, {
    kind: "constant",
    value: { sourceKind: ["spell", "ability"] }
  });
  assert.equal(preventInstruction.targets, undefined);
  assert.equal(preventInstruction.linkedTo, undefined);
});

test("Unyielding Spirit: the prevention is not approximated with a merged primitive", () => {
  // The replacement.prevent instruction is the merged prevention primitive, and
  // the card must not be spelled with a damage/heal instruction or a no-op closure: "prevent" and
  // "heal" are different actions (438.1.a.1: Prevent includes applied Bonus
  // Damage in its total; 438.4: fully prevented damage was never dealt).
  assert.equal(preventInstruction.op, "replacement.prevent");
  assert.notEqual(preventInstruction.op, "effect.damage");
  assert.notEqual(preventInstruction.op, "effect.heal");
  assert.deepEqual(preventInstruction.args, {
    amount: { kind: "constant", value: "all" },
    duration: { kind: "constant", value: "this-turn" },
    appliesTo: { kind: "constant", value: { sourceKind: ["spell", "ability"] } }
  });
});

test("Unyielding Spirit: no duration field exists on the replacement ability form", () => {
  // The printed "this turn" window is carried by replacement.prevent's
  // duration argument. Contract 3.1 keeps the window on the instruction,
  // rather than adding a second ability-level duration field.
  assert.equal(prevention.duration, undefined);
  assert.deepEqual(preventInstruction.args.duration, { kind: "constant", value: "this-turn" });
});

test("Unyielding Spirit evidence: the merged primitive is rejected only at the ability-level binder", () => {
  const kernel = world()
    .card("unyielding-spirit", { zone: "chain", owner: "A", types: ["spell"] })
    .build();
  const hostRef = kernel.ref("unyielding-spirit");
  const deps = {
    host: {
      object: ref => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: {
      clock: { turn: 1 },
      registerReplacement: () => {},
      unregisterReplacement: () => {}
    }
  };
  assert.throws(
    () => bindReplacement(
      { replaces: prevention.replaces, with: prevention.with },
      hostRef,
      deps
    ),
    /Unsupported replacement opcode: replacement\.prevent/
  );
});

test.todo(
  "Unyielding Spirit execution: a replacement.prevent instruction must let the card install " +
    "a damage replacement whose total is 'all' (438.1.b.1.c) and whose window ends with the " +
    "turn; the ability-level binder must consume the merged primitive, and the frozen damage " +
    "GameAction needs a spell/ability vs combat discriminator (438.1.b: the action records the " +
    "source of the damage being prevented)"
);

test.todo(
  "Unyielding Spirit cast: pays 1 Energy + 1 Body power and [Reaction] closed-state timing " +
    "is enforced (依赖费用管线的生产接线与 continuous.timing 的链上时机消费)"
);

