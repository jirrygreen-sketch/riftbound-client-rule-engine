import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lucian-gunslinger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
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
  assert.match(program.judgeReason, /关键词数值|keyword.*Expr/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /showdown-conversion/);
  assert.match(program.judgeReason, /383\.4\.e\.2\.a/);
  assert.match(program.judgeReason, /466\.2\.d/);
  assert.match(program.judgeReason, /807\.2/);
  assert.match(program.judgeReason, /effects\/interpreter\/expr\.ts/);
  assert.match(program.judgeReason, /translateInstructionTargets.*translateObjectFilter/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257|RIFT-33/);
});

test("sfd-028-221 Lucian, Gunslinger: [Assault] is declared with no value (807.1.b.3 presumes 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.equal(assault.value, undefined);
});

test("sfd-028-221 Lucian, Gunslinger: the merged Assault expansion resolves to +1 Might while attacking", () => {
  // 807.1.b.3: a value-less printed Assault presumes 1. expandProgram resolves
  // the card's keyword declaration into the merged Assault expansion
  // (807.1.c: +X Might while the host is an attacker).
  const snapshot = {
    ref: { id: "lucian", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Lucian, Gunslinger",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 2,
    energy: 3,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = expandProgram(program, snapshot);
  assert.equal(expanded.expanded.length, 1);
  const [assaultExpansion] = expanded.expanded;
  assert.equal(assaultExpansion.kind, "static");
  assert.equal(assaultExpansion.effect.kind, "continuous.might");
  assert.deepEqual(assaultExpansion.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(assaultExpansion.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

test("sfd-028-221 Lucian, Gunslinger boundary: Assault still reads missing designation", () => {
  // The merged contract exposes combatRole, while the Assault KeywordDef still
  // asks for the rules characteristic named designation. The condition therefore
  // fails closed instead of inventing an attacker-only Might bonus.
  const kernel = world().unit("lucian", { might: 2, combatRole: "attacker" }).build();
  const source = kernel.getObject("lucian");
  const environment = {
    context: bindResolveContext(kernel, { source }),
    host: kernel.ref("lucian"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  const condition = expandProgram(program, source).expanded[0].condition;
  assert.throws(() => evaluateCondition(condition, environment), /Unavailable characteristic: designation/);
  assert.equal(
    evaluateCondition(
      { ...condition, left: { kind: "object-property", object: "self", property: "combatRole" } },
      environment
    ),
    true
  );
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

test("sfd-028-221 Lucian, Gunslinger boundary: the placeholder cannot read a keyword value", () => {
  const kernel = world().unit("lucian", {
    keywords: [{ id: "Assault", value: 1 }]
  }).build();
  const source = kernel.getObject("lucian");
  const environment = {
    context: bindResolveContext(kernel, { source }),
    host: kernel.ref("lucian"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.throws(
    () => evaluateExpression(damageInstruction.args.amount, environment),
    /Unavailable characteristic: keywords\.assault\.value/
  );
});

test("sfd-028-221 Lucian, Gunslinger: the original body revalidates a target that moves away or leaves the board", () => {
  // CR 359.3.e.2 / 359.3.f.2: target revalidation precedes the amount read.
  // These legal mistargeting cases exercise the untouched body through the
  // production primitive adapter; the normal Assault-value case remains TODO.
  for (const departure of ["move-location", "kill"]) {
    const kernel = world()
      .unit("lucian", {
        cardId: CARD_ID,
        might: 2,
        energy: 3,
        power: null,
        keywords: [{ id: "Assault", value: 4 }],
        location: { type: "battlefield", id: "bf-1" }
      })
      .unit("enemy", {
        owner: "B", controller: "B", might: 5,
        location: { type: "battlefield", id: "bf-1" }
      })
      .build();
    const context = kernel.clone({
      sourceSnapshot: kernel.getObject("lucian"),
      targets: new Map([[TARGET_ID, [kernel.ref("enemy")]]])
    });
    // TestWorld requires concrete players; ChainEngine.context normally binds
    // this relative player. The body and its sameLocationAs anchor stay intact.
    const bound = bindResolveContext(context, {
      query: filter => context.query({
        ...filter,
        ...(filter.controller === "opponent" ? { controller: "B" } : {})
      })
    });
    const departed = context.perform(departure === "kill"
      ? { type: "kill", object: context.ref("enemy") }
      : { type: "move-location", object: context.ref("enemy"), to: { type: "battlefield", id: "bf-2" } });
    assert.equal(departed.status, "done");
    const before = context.snapshot();
    const outcome = resolveChainBody(attack.body, bound);

    assert.equal(outcome.status, "partial");
    assert.deepEqual(outcome.results, [{
      id: damageInstruction.id,
      op: "effect.damage",
      path: [damageInstruction.id],
      result: { status: "ignored", reason: "mistargeted" }
    }]);
    assert.deepEqual(outcome.events, []);
    assert.deepEqual(outcome.linkedValues, {});
    assert.deepEqual(context.snapshot(), before);
    assert.equal(context.getObject("lucian").power, null);
    assert.equal(context.getObject("enemy").damage, 0);
    assert.equal(context.getObject("enemy").zone, departure === "kill" ? "trash" : "board");
  }
});

test("sfd-028-221 Lucian, Gunslinger boundary: the interpreter resolves enemy unit here", () => {
  const kernel = world()
    .unit("lucian", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "A", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-here", { owner: "B", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-gear-here", { types: ["gear"], owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lucian"), source: kernel.ref("lucian") });
  const environment = {
    context: scoped,
    host: scoped.ref("lucian"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false,
    // The reference kernel does not resolve the card-level "opponent"
    // placeholder; production Finalize supplies the concrete player first.
    query: filter => scoped.query({
      ...filter,
      ...(filter.controller === "opponent" ? { controller: "B" } : {})
    })
  };
  const matched = queryObjects(targetSpec.filter, environment).map(object => object.ref.id);
  assert.deepEqual(matched, ["enemy-here"]);

  // 359.3.f.2: "here" follows the source's current location at resolution.
  const moved = scoped.perform({
    type: "move-location", object: scoped.ref("lucian"),
    to: { type: "battlefield", id: "bf-2" }
  });
  assert.equal(moved.status, "done");
  assert.deepEqual(scoped.events.map(event => event.action), ["move-location"]);
  assert.deepEqual(
    queryObjects(targetSpec.filter, environment).map(object => object.ref.id),
    ["enemy-elsewhere"]
  );
});

test("sfd-028-221 Lucian, Gunslinger boundary: production trigger binding rejects sameLocationAs", () => {
  // Probe the target translator directly without promoting this blocked card
  // to executable just to bypass ProgramRegistry's status guard.
  assert.throws(
    () => translateInstructionTargets(attack.body),
    error => error instanceof ProgramBindingError &&
      error.code === "judge-required" &&
      /Unsupported filter field sameLocationAs/.test(error.message)
  );
});

test("sfd-028-221 Lucian, Gunslinger boundary: production registry preserves the actual judge-required guard", () => {
  const kernel = world().unit("lucian", { cardId: CARD_ID }).build();
  const registry = new ProgramRegistry([program]);
  assert.equal(registry.inspect(CARD_ID).status, "judge-required");
  assert.throws(
    () => triggerRegistrations(registry, kernel.getObject("lucian")),
    error => error instanceof ProgramBindingError &&
      error.code === "judge-required" &&
      error.message === program.judgeReason
  );
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
  assert.equal(run.linked.dealt, 1);
  assert.equal(run.linked.dealtCount, 1);
  assert.deepEqual(run.linked.dealtTo, [{ target: kernel.ref("enemy"), amount: 1 }]);
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
    "KeywordDef is merged and expandProgram resolves it, but the condition reads designation while " +
    "ObjectSnapshot exposes combatRole, so production binding remains fail-closed"
);

test.todo(
  "sfd-028-221 Lucian, Gunslinger: 'damage equal to my [Assault]' needs an expression that reads a " +
    "keyword value off an object (807.1.b.2 / 807.3); no merged Expr form provides it, and the golden " +
    "above substitutes the presumed Assault 1 only for the primitive-shape check"
);

test.todo(
  "sfd-028-221 Lucian, Gunslinger: the attack-declared timing point is emitted by combat and delivers " +
    "this trigger to the chain (CR 383.4.e.2, 383.4.e.2.a) — the timing point is in the registry, but " +
    "combat/flow.ts still throws combat-start-transaction before a producer can emit it"
);
