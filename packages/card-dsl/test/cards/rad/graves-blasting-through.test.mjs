// RIFT-648 template execution evidence: ../templates/empty-648.test.mjs.
// The template rows drive this program's two triggers through the real chain
// and event pipeline and record the self-filter and each-set boundaries; the
// per-card goldens below keep the primitive-level evidence for the parts the
// harness cannot reach yet (combat-damage suppression, here-set selection).
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/graves-blasting-through.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import combat from "../../../../engine-core/dist/effects/instructions/continuous.combat.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-c2e3ab2dd48bf4cc3c4fe3b2d698e6c34817fb574f4787c66b1e3fcefc58cd77";
const SOURCE_TEXT =
  "When I attack or defend, deal damage equal to my Might to all enemy units here.\nI don't deal combat damage.";
const TARGET_ID = "graves-blasting-through.enemies-here";

const battlefield = () =>
  world()
    .unit("graves", {
      might: 4,
      owner: "A",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy-here-a", { owner: "B", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here-b", { owner: "B", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", zone: "board", location: { type: "battlefield", id: "bf-2" } })
    .build();

test("rad-085-167 Graves, Blasting Through: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /combat damage/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-085-167 Graves, Blasting Through: attack and defend triggers, each once per combat", () => {
  assert.equal(program.abilities.length, 2);
  const [attack, defend] = program.abilities;
  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.deepEqual(attack.trigger.filter, { self: true });
  assert.equal(attack.trigger.once, "per-combat");
  assert.equal(attack.optional, false);

  assert.equal(defend.kind, "triggered");
  assert.equal(defend.trigger.at, "defense-declared");
  assert.deepEqual(defend.trigger.filter, { self: true });
  assert.equal(defend.trigger.once, "per-combat");
});

test("rad-085-167 Graves, Blasting Through: Might-scaled damage statement with the here-set shape", () => {
  for (const ability of program.abilities) {
    assert.equal(ability.body.length, 1);
    const [instruction] = ability.body;
    assert.equal(instruction.op, "effect.damage");
    assert.deepEqual(instruction.args.amount, {
      kind: "object-property",
      object: "source",
      property: "might"
    });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
    assert.equal(instruction.args.source, undefined);
    // "all enemy units here" is a programmatic each-set (CR 355.10.d): the units
    // are never targeted, so no TargetSpec/picks are declared for them.
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.deepEqual(instruction.args.appliesTo, {
      kind: "constant",
      value: {
        type: "unit",
        controller: "opponent",
        zone: "board",
        sameLocationAs: "self",
        selection: "all"
      }
    });
  }
});

test("rad-085-167 Graves, Blasting Through: damage equals the source Might for every enemy here", () => {
  const [instruction] = program.abilities[0].body;
  const kernel = battlefield();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("graves") });
  // Finalize locked the here-set (the two enemies at bf-1); the kernel receives
  // exactly those refs, so the primitive cannot reach the enemy at bf-2.
  scoped.setTargets(TARGET_ID, [scoped.ref("enemy-here-a"), scoped.ref("enemy-here-b")]);
  const outcome = resolveChainBody([instruction], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("enemy-here-a").damage, 4);
  assert.equal(scoped.getObject("enemy-here-b").damage, 4);
  assert.equal(scoped.getObject("enemy-elsewhere").damage, 0);
});

test("rad-085-167 Graves, Blasting Through: the dealt amount reads the source's current Might at resolution", () => {
  const [instruction] = program.abilities[1].body;
  // The +Might comes from a live modifier (here: the printed 6 Might unit), and
  // the object-property read is evaluated when the instruction resolves
  // (contract 3.6 evaluate timing), not when the program was authored.
  const kernel = world()
    .unit("graves", { might: 6, owner: "A", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here-a", { owner: "B", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("graves") });
  scoped.setTargets(TARGET_ID, [scoped.ref("enemy-here-a")]);
  const run = runInstruction(
    damage,
    { amount: instruction.args.amount, target: instruction.args.target.value },
    { world: scoped, targets: { [TARGET_ID]: [scoped.ref("enemy-here-a")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 6);
  assert.equal(run.linked.dealtCount, 1);
});

test("rad-085-167 Graves, Blasting Through: continuous.combat is merged but has no consumer yet", () => {
  // The merged primitive exists and accepts a flags payload, but returns
  // negated/impossible until the layers/combat consumer reads it, so "I don't
  // deal combat damage" still has no vehicle (its own header records this).
  assert.notEqual(instructionDefinitionsById.get("continuous.combat"), undefined);
  const kernel = world().unit("graves", { might: 4 }).build();
  const scoped = kernel.clone({
    source: kernel.ref("graves"),
    sourceSnapshot: kernel.getObject("graves")
  });
  const run = runInstruction(
    combat,
    {
      flags: { kind: "constant", value: ["no-combat-damage"] },
      appliesTo: { kind: "constant", value: "self" },
      duration: { kind: "constant", value: "this-combat" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(scoped.snapshot().continuous.length, 0);
});

test.todo(
  "graves-blasting-through: 'I don't deal combat damage' (CR v1.5 467.2.c damage-assignment contribution)" +
    " needs a combat-damage contribution suppression consumed by the combat system — continuous.combat is merged" +
    " but its layers/combat consumer is not"
);
test.todo(
  "graves-blasting-through: 'all enemy units here' collection selection (CR 355.10.d each-set): effect.damage" +
    " accepts only a TargetSpec id, so the set/query selection shape is pending (contract change request);" +
    " the here-set must never be modelled as targets because that would trigger became-target effects"
);
test.todo(
  "graves-blasting-through: attack-declared/defense-declared subscription through the trigger pipeline with the" +
    " once-per-combat lifetime"
);
