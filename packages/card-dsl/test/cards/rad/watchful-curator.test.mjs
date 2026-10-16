// Golden test for Watchful Curator (rad-037-167).
//
// judge-required (see the program's judgeReason): granting [Deflect] to your
// gear needs the unmerged keyword-grant layer and its registration from a card
// program. The runnable evidence is the declared grant shape plus the real
// LayerEngine applying a grant-keyword effect to a gear (809.1.c/809.3).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/watchful-curator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL =
  "card.hash-dc5774a38ed543aac39bd40a45c96e08acddedf25a91e979a8a3576715ec1a5b";
const SOURCE_TEXT =
  "Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a spell or ability.)";

const [grant] = program.abilities;

/** A minimal board object for the real layer engine. */
function boardObject(id, types, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: id,
    name: id,
    types,
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: null,
    energy: 2,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values
  };
}

test("rad-037-167 Watchful Curator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-037-167 Watchful Curator: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the missing grant consumer, the rules and the task.
  assert.match(program.judgeReason, /continuous\.keyword/);
  assert.match(program.judgeReason, /809\.2/);
  assert.match(program.judgeReason, /809\.3/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-037-167 Watchful Curator: one static grant of Deflect 1 to your gear", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 809.1.b.3: priority is Deflect 1 when the printed number is omitted.
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.equal(grant.effect.layer, "ability");
  // "Your gear": gear controlled by this card's controller, on the board.
  assert.deepEqual(grant.effect.filter, {
    type: "gear",
    controller: "controller",
    zone: "board"
  });
});

test("rad-037-167 Watchful Curator: the grant scope covers your gear and nothing else", () => {
  // The declared static IR keeps "controller" as the symbolic controller
  // placeholder (as the sibling card programs do). The consumers resolve it
  // against the live ability controller, which the layer filter spells as an
  // explicit player id (events/trigger-spec.ts PlayerSelector).
  const resolved = { ...grant.effect.filter, controller: { playerId: "A" } };
  const gear = boardObject("gear", ["gear"]);
  const unit = boardObject("unit", ["unit"], { might: 4 });
  const enemyGear = boardObject("enemy-gear", ["gear"], { owner: "B", controller: "B" });
  assert.equal(matchesObjectFilter(resolved, gear), true);
  assert.equal(matchesObjectFilter(resolved, unit), false);
  assert.equal(matchesObjectFilter(resolved, enemyGear), false);
  assert.equal(grant.effect.filter.controller, "controller");
});

test("rad-037-167 Watchful Curator: the merged layer engine really applies the granted keyword (809.3)", () => {
  const gear = boardObject("gear", ["gear"]);
  const unit = boardObject("unit", ["unit"], { might: 4 });
  const engine = createLayerEngine([gear, unit], []);
  // The card declares the grant; this is the merged consumer that would carry
  // it once the card→layers registration exists. 809.3 makes the granted
  // keyword a readable characteristic.
  engine.addContinuous(
    {
      id: "watchful-curator.grant",
      layer: "ability",
      filter: { ...grant.effect.filter, controller: { playerId: "A" } },
      effect: {
        kind: "grant-keyword",
        keyword: grant.effect.keyword,
        // The layer engine reads a resolved numeric keyword value
        // (keywordValue() accepts numbers); the card layer carries the printed
        // value in the Expr envelope, so evaluating it is part of the missing
        // card→layers registration path.
        value: grant.effect.value.value
      }
    },
    { type: "permanent" }
  );
  const evaluated = engine.evaluateAll();
  const evaluatedGear = evaluated.find((object) => object.ref.id === "gear");
  const evaluatedUnit = evaluated.find((object) => object.ref.id === "unit");
  assert.deepEqual(evaluatedGear.keywords, [{ id: "deflect", value: 1 }]);
  assert.deepEqual(evaluatedUnit.keywords, []);
  // The sibling enemy gear is untouched, and the source's own types are unchanged.
  assert.deepEqual(
    evaluated.filter((object) => object.keywords.length > 0).map((object) => object.ref.id),
    ["gear"]
  );
  // The declaration itself names the lowercase keyword id the engine stores.
  assert.equal(grant.effect.keyword, "deflect");
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  // 809.2: additional Deflect sources sum, so the granted value is additive.
  assert.equal(deflect.stacking, "sum");
});

test("rad-037-167 Watchful Curator: the target-tax consumer exists but has no producer for this grant", () => {
  // The Deflect expansion produces the target.tax effect the target plan reads;
  // what is missing is the card-program → layer registration that would put the
  // granted Deflect onto each gear's keyword characteristic.
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.notEqual(grant.effect.kind, expansion.effect.kind);
});

test.todo(
  "Watchful Curator: 'Your gear have [Deflect]' — blocked because no merged primitive or layer consumer grants a keyword to a " +
    "matched object set (continuous.keyword has no instruction file and ability-templates.md records that family at 0/0), and no " +
    "merged path registers a card program's static ability as a ContinuousEffectSpec (RIFT-91)"
);

test.todo(
  "Watchful Curator: 809.2 addition with a gear's own Deflect and 809.3 readable characteristic in production — blocked by the same " +
    "card→layers registration gap; the layer engine applies grants, but nothing feeds this card's declaration into it (RIFT-91)"
);
