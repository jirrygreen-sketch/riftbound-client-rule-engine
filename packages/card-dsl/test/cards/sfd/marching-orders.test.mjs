import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/marching-orders.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter, the
// same entry point the merged chain uses for card programs.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7665f836ecbe39043d8dd42f110ad82560fe857373dbf87d7348d347e764617c";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_3: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Choose a friendly unit anywhere and an enemy unit at a battlefield. " +
  "They deal damage equal to their Mights to each other.";

const [speed, play] = program.abilities;
const [friendlyDeals, enemyDeals] = play.body;

// The reference kernel compares filter values literally, so the friendly/enemy
// placeholders are bound as finalized targets (the production target pipeline
// resolves them at Finalize). The card's own TargetSpecs are asserted below and
// the body runs without re-declaring them, the merged challenge convention.
const bodyWithoutTargetSpecs = play.body.map(({ targets, ...rest }) => rest);

test("sfd-114-221 Marching Orders: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-114-221 Marching Orders: judgeReason names the [Repeat] cost gap and its tasks", () => {
  assert.match(program.judgeReason, /\[Repeat\]/);
  assert.match(program.judgeReason, /820\.1\.c/);
  assert.match(program.judgeReason, /RIFT-261/);
  // The damage half is executable and must be reported as such, not as a gap.
  assert.match(program.judgeReason, /golden 已真实执行/);
});

test("sfd-114-221 Marching Orders: [Action] keyword plus the [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // 820.1.c: the printed "Repeat :rb_energy_3:" cost travels on the play
  // CostSpec (356.2.b.1), the merged sfd/danger-zone shape; the Repeat
  // The KeywordDef is merged, but the card-program cost plan that would collect it
  // is not wired through Finalize (RIFT-261).
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    energy: { kind: "literal", value: 3 }
  });
});

test("sfd-114-221 Marching Orders: two targeted, unlinked Deals that read each unit's Might", () => {
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["marching-orders.friendly-deals", "effect.damage"],
      ["marching-orders.enemy-deals", "effect.damage"]
    ]
  );

  // "an enemy unit at a battlefield": the unit is the target (355.9.a.1) and
  // "at a battlefield" is only a targeting restriction (355.10.b).
  assert.deepEqual(friendlyDeals.targets, [
    {
      id: "marching-orders.enemy-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        location: "battlefield"
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "a friendly unit anywhere": only the controller is restricted.
  assert.deepEqual(enemyDeals.targets, [
    {
      id: "marching-orders.friendly-unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 418.6.b.3: each chosen unit is the source of its own Deal; the amount is
  // that unit's Might, read at resolution (contract 3.6). Neither instruction
  // is linked to the other (359.3.e.7/.12: no last-known substitution).
  for (const [instruction, self, other] of [
    [friendlyDeals, "marching-orders.friendly-unit", "marching-orders.enemy-unit"],
    [enemyDeals, "marching-orders.enemy-unit", "marching-orders.friendly-unit"]
  ]) {
    assert.deepEqual(instruction.args.amount, {
      kind: "object-property",
      object: { target: self },
      property: "might"
    });
    assert.deepEqual(instruction.args.source, {
      kind: "object-property",
      object: { target: self },
      property: "ref"
    });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: other });
    assert.equal(instruction.args.combat, undefined);
    assert.equal(instruction.args.divide, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("sfd-114-221 Marching Orders golden: the chosen units damage each other by their Mights", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [kernel.ref("enemy")]);
  // 418.6.b.3 makes each chosen unit the source of its own damage; the
  // submitted GameActions are observed (a hook that applies no replacement) to
  // prove the source references, not just the marked damage.
  const submitted = [];
  kernel.addReplacement((action) => {
    if (action.type === "damage") submitted.push(action);
    return null;
  });

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.result.status), [
    "executed",
    "executed"
  ]);
  assert.equal(kernel.getObject("ally").damage, 5);
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.deepEqual(submitted, [
    {
      type: "damage",
      source: kernel.ref("ally"),
      target: kernel.ref("enemy"),
      amount: 3,
      combat: false
    },
    {
      type: "damage",
      source: kernel.ref("enemy"),
      target: kernel.ref("ally"),
      amount: 5,
      combat: false
    }
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage", "damage"]);
});

test("sfd-114-221 Marching Orders golden: Might is read at resolution, after an intervening change", () => {
  // Contract 3.6: value expressions are evaluated when used, so a Might change
  // between finalization and resolution is respected (418.6.b.3's unit source
  // is the same unit that was chosen).
  const kernel = world()
    .unit("ally", { owner: "A", might: 1 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").damage, 4);
  assert.equal(kernel.getObject("enemy").damage, 1);
});

test("sfd-114-221 Marching Orders golden: a stale enemy target ignores both Deals", () => {
  // 359.3.e.6-e.8 / .12: with the chosen unit gone, neither the Might read nor
  // the damage against it is replaced by a last-known value.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [stale]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => entry.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("ally").damage, 0);
  assert.equal(outcome.events.length, 0);
});

test.todo(
  "sfd-114-221 Marching Orders: [Repeat] :rb_energy_3: — collecting the optional additional cost at " +
    "Finalize and executing the effect one extra time per paid instance with re-made choices " +
    "(820.1.b/820.1.d/820.2.a) needs the card-program Repeat cost plan and payment adapter (RIFT-261)"
);

test.todo(
  "sfd-114-221 Marching Orders: the printed [Action] Showdown permission must be enforced through the " +
    "continuous.timing consumer and a CardProgram -> ChainDraft play adapter " +
    "(chain/engine.ts describePlay, contract 3.7) — RIFT-257"
);
