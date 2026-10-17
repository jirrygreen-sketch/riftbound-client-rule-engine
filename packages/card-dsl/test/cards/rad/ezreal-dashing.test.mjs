
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ezreal-dashing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import combat from "../../../../engine-core/dist/effects/instructions/continuous.combat.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7f839c473b5043b9c00abbc5b251e23126eb2b7a039e3edd56d07d54734b7288";
const SOURCE_TEXT =
  "When I attack or defend, deal damage equal to my Might to an enemy unit here.\n" +
  "I don't deal combat damage.\n" +
  ":rb_rune_mind:: [Action] — Move me to your base.";

const [attackTrigger, defendTrigger, combatRestriction, actionKeyword, activated] = program.abilities;
const attackInstruction = attackTrigger.body[0];

test("rad-180-167 Ezreal, Dashing: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-180-167 Ezreal, Dashing: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-180-167 Ezreal, Dashing: attack and defend triggers at the combat designation timings", () => {
  // CR 383.4.e/.f：单位取得 Attacker/Defender 身份时触发。
  assert.equal(program.abilities.length, 5);
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(attackTrigger.optional, false);

  assert.equal(defendTrigger.kind, "triggered");
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(defendTrigger.optional, false);
  assert.deepEqual(defendTrigger.body, attackTrigger.body);
});

test("rad-180-167 Ezreal, Dashing: damage equal to the source's Might at one enemy unit here", () => {
  assert.equal(attackInstruction.id, "ezreal-dashing.deal-might");
  assert.equal(attackInstruction.op, "effect.damage");
  // "equal to my Might"：契约 3.6 的动态数额读取，object 用符号选择器 "source"。
  assert.deepEqual(attackInstruction.args.amount, {
    kind: "object-property",
    object: "source",
    property: "might"
  });
  assert.deepEqual(attackInstruction.args.target, {
    kind: "constant",
    value: "ezreal-dashing.enemy-unit-here"
  });
  assert.deepEqual(attackInstruction.targets, [
    {
      id: "ezreal-dashing.enemy-unit-here",
      // "here"：359.3.f 的指代，执行时与来源同位置。
      filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(attackInstruction.linkedTo, undefined);
});

test("rad-180-167 Ezreal, Dashing: the combat-damage restriction is a static continuous combat effect", () => {
  assert.equal(combatRestriction.kind, "static");
  assert.deepEqual(combatRestriction.effect, {
    kind: "continuous.combat",
    flags: ["no-combat-damage"],
    appliesTo: "self"
  });
});

test("rad-180-167 Ezreal, Dashing: [Action] keyword plus the Mind-power activated Move", () => {
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });

  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // CR 204.1.b：冒号前的 :rb_rune_mind: 是 1 点 Mind Power 的 Base Cost。
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["Mind"] });
  assert.equal(activated.body.length, 1);
  const [moveInstruction] = activated.body;
  assert.equal(moveInstruction.id, "ezreal-dashing.move-to-base");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(moveInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(moveInstruction.args.linkKey, { kind: "constant", value: "moved" });
});

test("rad-180-167 Ezreal, Dashing golden: effect.damage deals the source's current Might to the enemy unit", () => {
  const base = world()
    .unit("ezreal", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("far-enemy", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ezreal") });
  const run = runInstruction(
    damage,
    {
      // 生产路径里这里是 "source" 选择器；参考内核按运行时引用喂入同一表达式形状。
      amount: { kind: "object-property", object: kernel.ref("ezreal"), property: "might" },
      target: "ezreal-dashing.enemy-unit-here"
    },
    { world: kernel, targets: { "ezreal-dashing.enemy-unit-here": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.equal(kernel.getObject("far-enemy").damage, 0);
  assert.equal(run.linked.dealt, 3);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test("rad-180-167 Ezreal, Dashing golden: a Might of 0 deals no damage and the instruction is negated (CR 418.1.e.1)", () => {
  const base = world()
    .unit("ezreal", { might: 0 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ezreal") });
  const run = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: kernel.ref("ezreal"), property: "might" },
      target: "ezreal-dashing.enemy-unit-here"
    },
    { world: kernel, targets: { "ezreal-dashing.enemy-unit-here": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(run.events, []);
});

test("rad-180-167 Ezreal, Dashing golden: the activated Move relocates the source to its own base", () => {
  const base = world()
    .unit("ezreal", { controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ezreal") });
  const [moveInstruction] = activated.body;
  const run = runInstruction(move, moveInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("ezreal").location, { type: "base", player: "A" });
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.movements, [
    {
      object: { id: "ezreal", zoneEntryId: 1 },
      from: { type: "battlefield", id: "bf-1" },
      to: { type: "base", player: "A" }
    }
  ]);
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
});

test("rad-180-167 Ezreal, Dashing golden: the continuous.combat declaration is merged but has no consumer yet", () => {
  // The merged primitive exists and accepts the declared flags shape, but it
  // returns negated/impossible until a combat consumer reads the flags (its own
  // header records that), so the restriction cannot suppress damage today.
  assert.notEqual(instructionDefinitionsById.get("continuous.combat"), undefined);
  const kernel = world().unit("ezreal", { might: 3 }).build();
  const scoped = kernel.clone({
    source: kernel.ref("ezreal"),
    sourceSnapshot: kernel.getObject("ezreal")
  });
  const run = runInstruction(
    combat,
    { flags: { kind: "constant", value: combatRestriction.effect.flags }, appliesTo: { kind: "constant", value: "self" } },
    { world: scoped }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(scoped.snapshot().continuous.length, 0);
  assert.notEqual(instructionDefinitionsById.get("effect.damage"), undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.move"), undefined);
});

test.todo(
  "rad-180-167 Ezreal, Dashing: exclude this unit from combat damage assignment and the Might sums " +
    "(CR 467.2.a/b / 467.2.c) — continuous.combat is merged but the layers/combat consumer that reads its flags " +
    "is unmerged (same family as Tank/Backline)"
);
test.todo(
  "rad-180-167 Ezreal, Dashing: fire the attack-declared / defense-declared triggers from the real combat " +
    "workflow (CR 383.4.e/.f) — combat/flow.ts still throws combat-start-transaction for the role designation " +
    "transaction (RIFT-270 audit marks it 待后续)"
);
test.todo(
  "rad-180-167 Ezreal, Dashing: charge the Mind Power cost at Finalize and hand the activated ability its " +
    "resolution window — cost.pay (RIFT-261) plus the RIFT-257 card-program binding are unmerged"
);

