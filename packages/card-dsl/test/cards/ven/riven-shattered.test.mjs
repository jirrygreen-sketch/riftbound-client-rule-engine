// RIFT-664 template execution evidence (trigger -> damage resolution for
// 2 x attached Equipment, no-equipment / no-legal-target boundaries) is in
// ../templates/keyword-triggered-attack-declared-effect-664.test.mjs. This
// card stays judge-required for the printed gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/riven-shattered.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import weaponmaster from "../../../../engine-core/dist/effects/keywords/Weaponmaster.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { ProgramBindingError, ProgramRegistry, triggerRegistrations } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-449ee3c99ccb6cbedf40282cf1e6bd9c5f1849ff561c01da7535c34da3628b11";
const SOURCE_TEXT =
  "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
  "When I attack, choose an enemy unit here. Deal 2 to it for each Equipment attached to me.";

const TARGET = "riven-shattered.enemy-unit-here";
const BATTLEFIELD = { type: "battlefield", id: "bf-1" };
const OTHER_BATTLEFIELD = { type: "battlefield", id: "bf-2" };

const [weaponmasterKeyword, ability] = program.abilities;
const [damage] = ability.body;

/**
 * The production chain binds the controller/owner placeholders and delegates to
 * the layers filter (chain/engine.ts); the reference kernel does neither, so the
 * goldens bind them here rather than editing the card data (the merged
 * sfd/janna-savior test does the same). The interpreter still resolves the
 * contract 3.6 sameLocationAs / attachedTo anchors itself before the scalar part
 * reaches this query, so those stay real.
 */
const productionContext = (kernel) =>
  bindResolveContext(kernel, {
    query: filter => {
      const normalized = { ...filter };
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = kernel.controller;
      }
      return kernel.objects.filter(object => {
        for (const key of ["controller", "owner"]) {
          if (normalized[key] === "opponent" && object[key] === kernel.controller) return false;
        }
        const resolved = { ...normalized };
        if (resolved.controller === "opponent") resolved.controller = "any";
        if (resolved.owner === "opponent") resolved.owner = "any";
        return matchesObjectFilter(resolved, object);
      });
    }
  });

/** Two Equipment attached to the host, one enemy unit here and one elsewhere. */
const rivenWorld = () => {
  const kernel = world()
    .unit("riven", { might: 3, location: BATTLEFIELD })
    .unit("enemy-here", { might: 2, controller: "B", owner: "B", location: BATTLEFIELD })
    .unit("enemy-elsewhere", { might: 2, controller: "B", owner: "B", location: OTHER_BATTLEFIELD })
    .object("sword", { types: ["gear"], tags: ["Equipment"], zone: "board", location: BATTLEFIELD })
    .object("axe", { types: ["gear"], tags: ["Equipment"], zone: "board", location: BATTLEFIELD })
    .build();
  const attached = runInstruction(attach, {
    objects: { kind: "constant", value: { kind: "target", id: "setup-equipment" } },
    host: { kind: "constant", value: { kind: "target", id: "setup-host" } },
    amount: { kind: "constant", value: 2 }
  }, { world: kernel, targets: {
    "setup-equipment": [kernel.ref("sword"), kernel.ref("axe")], "setup-host": [kernel.ref("riven")]
  } });
  assert.equal(attached.result.status, "executed");
  assert.deepEqual(attached.events.map(event => event.action), ["attach", "attach"]);
  for (const id of ["sword", "axe"]) assert.deepEqual(kernel.getObject(id).attachedTo, kernel.ref("riven"));
  return kernel.clone({ source: kernel.ref("riven"), sourceSnapshot: kernel.getObject("riven") });
};

test("ven-041-166 Riven, Shattered: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-041-166 Riven, Shattered: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.match(program.judgeReason, /821\.1\.c\.2/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /821\.1\.c\.2/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  // Deleted stale assertion (2026-10-18 re-sweep): the old reason cited the
  // merged RIFT-359 task number. The refreshed reason names the concrete
  // translator / error instead, so a task-number citation must stay absent.
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-041-166 Riven, Shattered: [Weaponmaster] is declared as a keyword and never re-implemented", () => {
  // 821.1.c / contract 3.7: the play-time equip choice, its cost calculation and
  // the attach sequence belong to effects/keywords/Weaponmaster.ts.
  assert.deepEqual(weaponmasterKeyword, { kind: "keyword", keyword: "weaponmaster" });
  const expansion = weaponmaster.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "triggered");
  const [choice] = expansion[0].body;
  assert.equal(choice.targets[0].filter.controller, "self");
  assert.deepEqual(choice.targets[0].filter.tags, ["Equipment"]);
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.op), [
    "cost.modify",
    "cost.pay",
    "effect.attach"
  ]);
});

test("ven-041-166 Riven, Shattered: 'When I attack' is an Attack Trigger scoped to this card", () => {
  // 383.4.e / 383.4.e.1 / 383.4.e.2: Attack Triggers fire when the unit first
  // gains the Attacker designation during a combat (383.4.e.2.a keeps it once
  // per combat); the closed timing point is attack-declared.
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  // 383.4.e.2.a: the condition is checked only once per combat.
  assert.equal(ability.trigger.once, "per-combat");
  assert.equal(ability.optional, false);
});

test("ven-041-166 Riven, Shattered: 'choose an enemy unit here' is a target with the here and enemy restrictions", () => {
  // 355.7 / 355.9.a.1 / 355.9.b: naming the enemy unit on the public Board makes
  // it a target; "here" uses the contract 3.6 sameLocationAs anchor (053.3) so
  // units at other locations are not legal targets.
  assert.deepEqual(damage.targets, [
    {
      id: TARGET,
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: "self"
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(damage.args.target, { kind: "constant", value: TARGET });
  assert.equal(damage.linkedTo, undefined);
});

test("ven-041-166 Riven, Shattered: the damage amount is 2 x the Equipment attached to the host", () => {
  // 418.1 / 418.8: "Deal 2 … for each Equipment attached to me" is a single Deal
  // instance whose amount the effect calculates; the count is a set read with the
  // attachedTo anchor (no extra target choice),
  assert.deepEqual(damage.args.amount, {
    kind: "arithmetic",
    operator: "mul",
    operands: [
      { kind: "constant", value: 2 },
      {
        kind: "count",
        subject: "equipment-attached-to-self",
        filter: {
          type: "gear",
          tags: ["Equipment"],
          zone: "board",
          attachedTo: "self"
        }
      }
    ]
  });
  // 418.7 / 467.2: this Deal is a non-combat action.
  assert.deepEqual(damage.args.combat, { kind: "constant", value: false });
});

test("ven-041-166 Riven, Shattered golden: two attached Equipment deal 4 to the enemy unit here (418.8)", () => {
  const kernel = rivenWorld();
  kernel.setTargets(TARGET, [kernel.ref("enemy-here")]);

  const outcome = resolveChainBody(ability.body, productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["riven-shattered.damage-per-equipment", "executed"]
  ]);
  // 418.8: one instance of 2 x 2 = 4 damage, not two instances of 2.
  assert.deepEqual(outcome.linkedValues["riven-shattered.damage-per-equipment.dealt"], 4);
  assert.deepEqual(outcome.events.map(event => event.action), ["damage"]);
  assert.equal(kernel.getObject("enemy-here").damage, 4);
  // The unit elsewhere is never touched: "here" limits the target.
  assert.equal(kernel.getObject("enemy-elsewhere").damage, 0);
});

test("ven-041-166 Riven, Shattered golden: no attached Equipment deals no damage but still resolves the instruction", () => {
  const kernel = world()
    .unit("riven", { might: 3, location: BATTLEFIELD })
    .unit("enemy-here", { might: 2, controller: "B", owner: "B", location: BATTLEFIELD })
    .build()
    .clone({ controller: "A" });
  const scoped = kernel.clone({
    source: kernel.ref("riven"),
    sourceSnapshot: kernel.getObject("riven")
  });
  scoped.setTargets(TARGET, [scoped.ref("enemy-here")]);

  const outcome = resolveChainBody(ability.body, productionContext(scoped));

  // 418.1.e.1 keeps zero damage from becoming an event; the primitive reports it
  // as a negation of the action rather than pretending damage happened.
  assert.deepEqual(outcome.events, []);
  assert.equal(scoped.getObject("enemy-here").damage, 0);
  assert.notEqual(outcome.status, "executed");
});

test("ven-041-166 Riven, Shattered golden: an enemy unit at another location is not a legal target for 'here'", () => {
  const kernel = rivenWorld();
  // Locking the elsewhere unit still fails resolve-time revalidation against the
  // sameLocationAs anchor, so the instruction is ignored rather than damaging it.
  kernel.setTargets(TARGET, [kernel.ref("enemy-elsewhere")]);

  const outcome = resolveChainBody(ability.body, productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("enemy-elsewhere").damage, 0);
});

test.todo(
  "ven-041-166 Riven, Shattered: expand [Weaponmaster] (821.1.c.2 / 821.1.c.2.a: calculate the chosen " +
    "Equipment's Equip cost, one any-Power less, and attach it without activating Equip) — cost.modify / cost.pay " +
    "are merged, but reduce-equip-cost throws by design because rule 821.1.c.2 still lacks an authoritative " +
    "Equip-cost binding"
);

test("ven-041-166 Riven, Shattered gap: the [Weaponmaster] expansion cannot reach a cost plan today", () => {
  // Measured evidence for judgeReason point 1. Two distinct failures exist:
  // the chain adapter does not unwrap cost.modify's source/modifier literals,
  // and the primitive itself refuses reduce-equip-cost without the
  // authoritative Equip-cost binding 821.1.c.2 requires.
  // A detached Equipment keeps the negative assertion meaningful: this test
  // must not see an attachment the fixture installed by hand.
  const base = world()
    .unit("riven", { might: 3, location: BATTLEFIELD })
    .unit("sword", { types: ["gear"], tags: ["Equipment"], location: BATTLEFIELD })
    .build();
  const scoped = base.clone({ source: base.ref("riven"), sourceSnapshot: base.getObject("riven") });
  assert.equal(scoped.getObject("sword").attachedTo, null);
  scoped.setTargets("weaponmaster-equipment", [scoped.ref("sword")]);
  const [equipmentChoice] = weaponmaster.expand({ host: { canonicalCardId: CANONICAL_ID } })[0].body;
  const [modifyInstruction, payInstruction, attachInstruction] = equipmentChoice.args.body.value;

  // The declared sequence is the printed one; only its execution is missing.
  assert.deepEqual(
    equipmentChoice.args.body.value.map(instruction => instruction.op),
    ["cost.modify", "cost.pay", "effect.attach"]
  );
  assert.equal(modifyInstruction.args.modifier.kind, "constant");
  assert.deepEqual(modifyInstruction.args.modifier.value, {
    kind: "reduce-equip-cost",
    resource: "power",
    amount: 1,
    domain: "any"
  });
  assert.equal(payInstruction.linkedTo, "weaponmaster-cost");
  assert.equal(attachInstruction.linkedTo, "weaponmaster-pay");

  // (a) Through the chain interpreter the still-wrapped modifier never parses.
  assert.throws(
    () => resolveChainBody(equipmentChoice.args.body.value, scoped),
    error => error instanceof TypeError && /Invalid cost\.modify modifier argument: value/.test(error.message)
  );

  // (b) Even handed the primitive's literal shape, 821.1.c.2 has no binding:
  // the reference unit exposes no authoritative Equip cost, so the discount
  // must fail closed instead of guessing a generic Power reduction.
  assert.throws(
    () => runInstruction(costModify, {
      source: { kind: "target", id: "weaponmaster-equipment" },
      modifier: { kind: "reduce-equip-cost", resource: "power", amount: 1, domain: "any" }
    }, {
      world: scoped,
      targets: { "weaponmaster-equipment": [scoped.ref("sword")] }
    }),
    error => error.reason === "judge-required" && /821\.1\.c\.2/.test(error.message)
  );
  // No attachment happened: the failed sequence never reached effect.attach.
  assert.equal(scoped.getObject("sword").attachedTo, null);
  assert.equal(scoped.linked("cost"), undefined);
});

test("ven-041-166 Riven, Shattered gap: production trigger registration stops at the here target anchor", () => {
  // Measured evidence for judgeReason point 2: the sameLocationAs anchor the
  // published program carries is refused by the merged filter translator, so
  // the card registers no trigger at all.
  const kernel = rivenWorld();
  const source = { ...kernel.getObject("riven"), cardId: CANONICAL_ID };
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  assert.throws(
    () => triggerRegistrations(registry, source),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      /Unsupported filter field sameLocationAs/.test(error.message)
  );
});

test.todo(
  "ven-041-166 Riven, Shattered: resolve 'When I attack' end to end (383.4.e.2) — combat must emit the " +
    "attack-declared timing point and the programs/filters adapter must support the sameLocationAs target filter"
);
