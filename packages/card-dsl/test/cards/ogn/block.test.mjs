import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import block from "../../../dist/cards/ogn/block.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { queryTargetCandidates } from "../../../../engine-core/dist/target/target-plan.js";

const CANONICAL = "card.hash-211d0bb8cf4f5b5202c2a9b7996e483898644aa24714b1e10edd80a54ba4b560";

const [hidden, action, play] = block.abilities;
const [grantInstruction] = play.body;
const literal = (value) => ({ kind: "constant", value });

test("Block program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(block);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Block identity, ruleset, status and printed text", () => {
  assert.equal(block.canonicalCardId, CANONICAL);
  assert.equal(block.rulesetVersion, "core-1.5");
  assert.equal(block.status, "judge-required");
  assert.match(block.judgeReason, /Tank/);
  assert.match(block.judgeReason, /815/);
  assert.match(block.judgeReason, /cost\.hidden|continuous\.combat/);
  assert.equal(cardRegistryById.get(block.canonicalCardId), block);
  assert.equal(
    block.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a defender. " +
      "It must be assigned combat damage first.)"
  );
});

test("Block declares the printed [Hidden] and [Action] keywords (CR 811 / 806)", () => {
  assert.equal(block.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
});

test("Block body: one duration-bound [Shield 3] + [Tank] grant over a unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(grantInstruction.id, "grant-shield-3-and-tank");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.objects, { kind: "constant", value: { kind: "target", id: "granted-unit" } });
  // 814.1.b.2 keeps the Shield Value on the keyword entry itself: the merged
  // continuous.grant-keyword ignores a top-level `value` when `keywords` is
  // given, so the printed 3 lives on the Shield entry.
  assert.deepEqual(grantInstruction.args.keywords, {
    kind: "constant",
    value: [{ id: "Shield", value: 3 }, { id: "Tank" }]
  });
  assert.equal(grantInstruction.args.value, undefined);
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantInstruction.picks, undefined);
  assert.equal(grantInstruction.linkedTo, undefined);
  // "a unit" — any one unit, targeted (355.7 / 355.9.a.1).
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "granted-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("Block targets only Board units, including either controller, without exposing hand or deck units (355.9.a.1)", () => {
  const kernel = world().unit("friendly").unit("enemy", { owner: "B" })
    .hand("hand-unit").deck(["top-unit", "bottom-unit"], { owner: "B" }).build();
  const candidates = queryTargetCandidates(kernel, grantInstruction.targets[0]);
  assert.deepEqual(candidates.map(ref => ref.id).sort(), ["enemy", "friendly"]);
});

test("Block original play body grants both timed keywords only to its locked target", () => {
  for (const departed of [false, true]) {
    const base = world().unit("block-source", { types: ["spell"] }).unit("target", { owner: "B", might: 4 }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("block-source") });
    const target = kernel.ref("target");
    kernel.setTargets("granted-unit", [target]);
    if (departed) kernel.perform({ type: "return-to-hand", object: target });
    const outcome = resolveChainBody(play.body, kernel);
    assert.equal(outcome.results[0].result.status, departed ? "ignored" : "executed");
    assert.deepEqual(outcome.events, []);
    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 })));
    assert.deepEqual(layers.evaluate(kernel.ref("block-source")).keywords, []);
    if (departed) {
      assert.equal(outcome.results[0].result.reason, "mistargeted");
      assert.equal(kernel.continuousEffects.length, 0);
    } else {
      assert.deepEqual(layers.evaluate(target).keywords.map(({ id, value }) => [id, value ?? null]), [["Shield", 3], ["Tank", null]]);
      assert.equal(layers.evaluate(target).might, 4, "keyword registration alone does not assert combat execution");
      layers.advance({ id: "turn-end" });
      assert.deepEqual(layers.evaluate(target).keywords, []);
    }
  }
});

test("Block original body sums Shield 3 with existing Shield 1 and expires only the granted keywords (814.2)", () => {
  const base = world().unit("block-source", { types: ["spell"] })
    .unit("poro", { keywords: [{ id: "Shield", value: 1 }] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("block-source") });
  const target = kernel.ref("poro");
  kernel.setTargets("granted-unit", [target]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 })));
  assert.deepEqual(layers.evaluate(target).keywords.map(({ id, value }) => [id, value ?? null]), [["Shield", 4], ["Tank", null]]);
  layers.advance({ id: "turn-end" });
  assert.deepEqual(layers.evaluate(target).keywords, [{ id: "Shield", value: 1 }]);
});

test("Block keywords are merged: Shield and Tank both have KeywordDefs", () => {
  // CR 814 Shield and CR 815 Tank are both registered (RIFT-264 added Tank).
  assert.ok(keywordDefinitionsById.has("Shield"));
  assert.ok(keywordDefinitionsById.has("Tank"));
  assert.equal(keywordDefinitionsById.get("Tank").keyword, "Tank");
});

test("Block: Shield's merged expansion is defender-conditional, not a flat +3 Might (CR 814.1.c)", () => {
  const shield = keywordDefinitionsById.get("Shield");
  const [expansion] = shield.expand({ value: 3, host: { cardId: "block", source: { id: "block", zoneEntryId: 1 } } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 3 });
  // The +3 Might applies only while the host holds the Defender designation,
  // which Combat assigns (814.1.d / 466.2.c.3) — never unconditionally.
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.left.property, "designation");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });
  // Shield values from multiple sources sum (814.2; the keyword is stacking "sum").
  assert.equal(shield.stacking, "sum");
});

test("Block golden: the printed grant registers Shield 3 and Tank in the ability layer and expires at end of turn", () => {
  const base = world()
    .unit("block", { owner: "A", types: ["spell"] })
    .unit("granted-unit", { owner: "B", controller: "B", keywords: [] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("block") });
  const run = runInstruction(
    grantKeyword,
    {
      keywords: grantInstruction.args.keywords,
      duration: grantInstruction.args.duration,
      objects: literal({ kind: "target", id: "granted-unit" })
    },
    { world: kernel, targets: { "granted-unit": [kernel.ref("granted-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects.map((entry) => entry.duration), [
    { type: "end-of-turn" }
  ]);
  const engine = createLayerEngine(
    [kernel.getObject("granted-unit")],
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  const ref = kernel.ref("granted-unit");
  // Semantic compare: the layer engine keeps an explicit `value: undefined`
  // key for unvalued grants, which deepEqual distinguishes from an absent key.
  assert.deepEqual(
    engine.evaluate(ref).keywords.map((keyword) => ({ id: keyword.id, value: keyword.value ?? null })),
    [
      { id: "Shield", value: 3 },
      { id: "Tank", value: null }
    ]
  );
  engine.advance({ id: "turn-end" });
  assert.deepEqual(engine.evaluate(ref).keywords, []);
});

test.todo(
  "Block: give a unit [Shield 3] for this turn, summing with an existing Shield (CR 814.2 / 814.1.c: +3 Might " +
    "only while it is a defender) - the merged KeywordGrantLayerEngine re-expansion is not attached to the " +
    "production assembly, and the Shield defender condition still needs the designation-to-combatRole mapping " +
    "wired outside that engine (814.1.d)"
);

test.todo(
  "Block: give that unit [Tank] for this turn so it must be assigned lethal combat damage first (CR 815.1.b / " +
    "815.1.c.2) - the Tank KeywordDef is merged; the combat damage step still needs its continuous.combat consumer"
);

test.todo(
  "Block [Hidden]: hide for [A] and play from the facedown zone for [0] (CR 811.1.b / 811.1.c.2) - " +
    "needs the cost.hidden, Hide action, and facedown-zone consumers"
);
