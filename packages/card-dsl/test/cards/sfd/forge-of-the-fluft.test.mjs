import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forge-of-the-fluft.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const [ability] = program.abilities;
const granted = ability.effect.ability;
const [grantedAttach] = granted.body;

test("sfd-208-221 Forge of the Fluft: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-3f356b3b6d2a071862d185320450d863f378794fba0b10d4731b81a16bd21498"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /cost\.exhaust/);
  assert.equal(
    program.sourceText,
    'While you control this battlefield, friendly legends have ":rb_exhaust:: Attach an Equipment you control to a unit you control."'
  );
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-208-221 Forge of the Fluft: static controller-gated ability grant with the printed activated ability", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.grant-ability");
  assert.equal(ability.effect.appliesTo, "friendly-legends");
  assert.deepEqual(ability.effect.filter, { type: "legend", controller: "self" });

  // "While you control this battlefield" (190.6.a / 190.6.d).
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
  assert.equal(ability.condition.left.kind, "count");
  assert.deepEqual(ability.condition.left.filter, { object: "self", controller: "self" });

  // The granted ability: [E] cost (415.3.a / 415.5) + Attach (435.1 / 435.3).
  assert.equal(granted.kind, "activated");
  assert.equal(granted.timing, "action");
  assert.deepEqual(granted.cost, { payments: [{ kind: "exhaust" }] });
  assert.equal(granted.body.length, 1);
  assert.equal(grantedAttach.op, "effect.attach");
  assert.deepEqual(grantedAttach.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "forge-of-the-fluft.equipment" }
  });
  assert.deepEqual(grantedAttach.args.host, {
    kind: "constant",
    value: { kind: "target", id: "forge-of-the-fluft.unit" }
  });
  assert.equal(grantedAttach.targets.length, 2);
  const [equipment, unit] = grantedAttach.targets;
  assert.deepEqual(equipment.filter, { type: "gear", tags: ["Equipment"], controller: "self" });
  assert.equal(equipment.min, 1);
  assert.equal(equipment.max, 1);
  assert.equal(equipment.selection, "one");
  assert.deepEqual(unit.filter, { type: "unit", controller: "self" });
  assert.equal(unit.min, 1);
  assert.equal(unit.max, 1);
  assert.equal(unit.selection, "one");
});

test("sfd-208-221 Forge of the Fluft: the granted Attach body attaches an Equipment to a friendly Unit", () => {
  const kernel = world()
    .object("equipment", {
      name: "Equipment",
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: BATTLEFIELD
    })
    .unit("unit-1", { location: BATTLEFIELD })
    .build();
  const run = runInstruction(attach, grantedAttach.args, {
    world: kernel,
    targets: {
      "forge-of-the-fluft.equipment": [kernel.ref("equipment")],
      "forge-of-the-fluft.unit": [kernel.ref("unit-1")]
    }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("equipment").attachedTo, kernel.ref("unit-1"));
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
  assert.deepEqual(run.linked.attached, {
    count: 1,
    objects: [kernel.ref("equipment")],
    host: kernel.ref("unit-1")
  });
  // 435.5: attaching does not otherwise modify state (no readying, no Might
  // change; the kernel's default unit Might is 1 and the Equipment stays 0).
  assert.equal(kernel.getObject("equipment").exhausted, false);
  assert.equal(kernel.getObject("unit-1").might, 1);
});

// continuous.grant-ability is not merged, so the legend cannot actually be
// granted (or activate) the quoted ability; no substitute flow is written.
test.todo(
  "sfd-208-221 Forge of the Fluft: grant the quoted activated ability to friendly legends (continuous.grant-ability, CR 135.4.b/801.3.a)"
);
test.todo(
  "sfd-208-221 Forge of the Fluft: pay the [E] exhaust cost and activate the granted ability (cost.exhaust, RIFT-89)"
);
