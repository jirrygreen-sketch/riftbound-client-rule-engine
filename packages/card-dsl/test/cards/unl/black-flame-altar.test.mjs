import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/black-flame-altar.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56";
const SOURCE_TEXT =
  "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're defenders.)";

const [ability] = program.abilities;

test("unl-208-219 Black Flame Altar: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-208-219 Black Flame Altar: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /Temporary/);
  // RIFT-265 merged the Temporary KeywordDef, so the reason must name the real
  // remaining gaps (the static registration path and the layer filter).
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-265/);
  assert.doesNotMatch(program.judgeReason, /没有 Temporary\.ts/);
});

test("unl-208-219 Black Flame Altar: one static ability-layer keyword grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 476/477: granting a keyword changes what the objects are, which is the
  // ability layer of the contract §3.4 order (copy → trait → ability →
  // arithmetic).
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.layer, "ability");
  // 814.1.b.3: printed [Shield] without a value is Shield 1; the expansion
  // (defender-gated +1 Might) lives in keywords/Shield.ts, not here.
  assert.deepEqual(ability.effect.keywords, [{ id: "shield", value: 1 }]);

  // 053.3/199.1: "here" is this Battlefield; 816.3: "with [Temporary]" is a
  // keyword-characteristic gate. Neither anchor/predicate is implemented by
  // the merged layer filter, which is exactly the judged gap.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self",
    keywords: ["Temporary"]
  });
});

test("unl-208-219 Black Flame Altar: the granted Shield is real EffectIR the merged layer engine applies", () => {
  // The registration path is the gap, not the grant: RIFT-258's ability layer
  // reads effect.keywords and adds them to the object. Feed the card's own
  // declared specification through the merged layers engine to prove the IR is
  // executable once a binder supplies it.
  const objects = [
    {
      ref: { id: "temporary-unit", zoneEntryId: 1 }, cardId: null, name: "Temporary Unit", types: ["unit"],
      tags: [], keywords: [{ id: "Temporary" }], owner: "A", controller: "A", zone: "board",
      location: { type: "battlefield", id: "bf-1" }, combatRole: null, might: 3, energy: null, power: null,
      exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
      counters: {}, empowered: false
    }
  ];
  const registration = {
    effect: {
      id: "test.black-flame-altar",
      layer: "ability",
      filter: { objectId: "temporary-unit", zone: "board", zoneEntryId: 1 },
      effect: { kind: ability.effect.kind, keywords: ability.effect.keywords }
    },
    duration: { type: "permanent" }
  };
  const layers = createLayerEngine(objects, [registration]);
  const evaluated = layers.evaluate(objects[0].ref);
  assert.deepEqual(
    evaluated.keywords.map(keyword => [keyword.id, keyword.value]),
    [["Temporary", undefined], ["shield", 1]]
  );
});

test("unl-208-219 Black Flame Altar: the Temporary KeywordDef is merged and keeps this card's gate meaningful", () => {
  // CR 816.1/816.3: RIFT-265 merged effects/keywords/Temporary.ts, so
  // "with [Temporary]" is now a real registry characteristic; what is missing is
  // the filter predicate in the layer matcher and the card static registration.
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  assert.equal(temporary.valued, false);
  assert.equal(temporary.stacking, "single");
  const [expanded] = temporary.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "beginning-start");
});

test.todo(
  "unl-208-219 Black Flame Altar: register the static ability as a ContinuousEffectSpec (RIFT-257 ProgramStaticBinder) " +
    "and implement the 053.3 sameLocationAs anchor plus a keyword predicate in the layer filter, so the " +
    "[Temporary]-gated Shield grant applies to units here and nowhere else (the layer matcher reads neither anchor, " +
    "so the printed gate cannot be evaluated today)"
);

test.todo(
  "unl-208-219 Black Flame Altar: consume the Shield expansion (keywords/Shield.ts, 814.1.c: +1 Might " +
    "while the unit is a defender) so the granted keyword really reaches the arithmetic layer — the layer " +
    "engine does not evaluate the result's defender designation"
);
