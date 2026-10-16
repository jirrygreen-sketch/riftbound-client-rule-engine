import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lucian-gunslinger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9cbd19f7b3430a1dd398620ef97b933b43283fd7e9514a877188b5aa5d1cd80a";
const TARGET_ID = "lucian-gunslinger.enemy-unit-here";

const [assault, attack] = program.abilities;
const [damageInstruction] = attack.body;
const [targetSpec] = damageInstruction.targets;

test("sfd-028-221 Lucian, Gunslinger: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-028-221 Lucian, Gunslinger: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
      "When I attack, deal damage equal to my [Assault] to an enemy unit here."
  );
});

test("sfd-028-221 Lucian, Gunslinger: judgeReason names the Assault-value and attack-declared gaps", () => {
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /关键词数值/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /RIFT-81/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("sfd-028-221 Lucian, Gunslinger: [Assault] is declared with no value (807.1.b.3 presumes 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.equal(assault.value, undefined);
});

test("sfd-028-221 Lucian, Gunslinger: the attack trigger targets one enemy unit here", () => {
  // 383.4.e: Attack Triggers are put on the chain after the unit gains the
  // Attacker designation; 383.4.e.2.a: checked once per combat.
  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.deepEqual(attack.trigger.filter, { event: "attack-declared", filter: { source: "self" } });
  assert.equal(attack.optional, false);
  assert.equal(attack.body.length, 1);

  // 740.1.b: "enemy" = controlled by an opponent; "here" = the source's own
  // location, expressed with the sameLocationAs anchor (contract 3.6).
  assert.equal(damageInstruction.id, "lucian-gunslinger.damage");
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: TARGET_ID
  });
  assert.equal(targetSpec.id, TARGET_ID);
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    controller: "opponent",
    sameLocationAs: "source"
  });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.equal(damageInstruction.linkedTo, undefined);
});

test("sfd-028-221 Lucian, Gunslinger: the damage amount must read the host's Assault Value", () => {
  // 807.1.b.2 / 807.3: the Assault Value is a readable characteristic, and the
  // printed amount is "equal to my [Assault]" — not the presumed 1 from
  // 807.1.b.3. The expression below is the placeholder for that read; no merged
  // Expr form can read a keyword value, which is the recorded gap.
  assert.equal(damageInstruction.args.amount.kind, "object-property");
  assert.equal(damageInstruction.args.amount.object, "source");
  assert.equal(damageInstruction.args.amount.property, "keywords.assault.value");
  assert.notEqual(damageInstruction.args.amount.value, 1);
});

test("sfd-028-221 Lucian, Gunslinger golden: the printed damage instruction shape executes on the merged primitive", () => {
  // Only the primitive half is executable today: Finalize locks the enemy unit
  // at the same battlefield and the merged effect.damage deals the amount.
  const kernel = world()
    .unit("lucian", { might: 2, controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { might: 3, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: TARGET_ID, source: "self" },
    {
      world: kernel,
      targets: { [TARGET_ID]: [kernel.ref("enemy")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  assert.equal(kernel.getObject("enemy").damage, 1);
  assert.equal(kernel.getObject("lucian").damage, 0);
});

test("sfd-028-221 Lucian, Gunslinger golden: a lost target makes the damage instruction ignored (CR 359.3.e)", () => {
  const kernel = world().unit("enemy", { might: 3, owner: "B", controller: "B" }).build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: TARGET_ID, source: "self" },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy").zone, "trash");
  assert.deepEqual(run.events, []);
});

test.todo(
  "sfd-028-221 Lucian, Gunslinger: [Assault] expansion (+1 Might while the host is an attacker) — the " +
    "KeywordDef exists but no consumer expands CardProgram keyword abilities into layers, and Attacker " +
    "designation is not readable (RIFT-81 / RIFT-91)"
);

test.todo(
  "sfd-028-221 Lucian, Gunslinger: 'damage equal to my [Assault]' needs an expression that reads a " +
    "keyword value off an object (807.1.b.2 / 807.3); no merged Expr form provides it, and the golden " +
    "above substitutes the presumed Assault 1 only for the primitive-shape check"
);

test.todo(
  "sfd-028-221 Lucian, Gunslinger: the attack-declared timing point is emitted by combat and delivers " +
    "this trigger to the chain (CR 383.4.e.2, 383.4.e.2.a) — RIFT-33 / RIFT-120"
);
