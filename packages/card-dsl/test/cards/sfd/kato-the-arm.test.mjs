import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/kato-the-arm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-5c42b9538a43758dced9b213312dffeb6ebdd4fa21de3590ccf10cb802f80cd0";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When I move to a battlefield, give a friendly unit my keywords and +:rb_might: equal to my Might this turn.";

const [deflectKeyword, moveAbility] = program.abilities;
const [grantKeywords, grantMight] = moveAbility.body;
const [unitSpec] = grantKeywords.targets;

test("sfd-112-221 Kato the Arm: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-112-221 Kato the Arm: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-112-221 Kato the Arm: judgeReason names all three gaps with task ids", () => {
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /toZone/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-112-221 Kato the Arm: [Deflect] is declared without a value (809.1.b.3)", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflectKeyword.value, undefined);
  // RIFT-83's KeywordDef is registered and expands to the merged target.tax
  // static effect, whose consumer is still pending (RIFT-90/91).
  const definition = keywordDefinitionsById.get("Deflect");
  assert.equal(definition, deflect);
  const expansion = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(expansion, [
    { kind: "static", effect: { kind: "target.tax", value: { kind: "constant", value: 1 } } }
  ]);
});

test("sfd-112-221 Kato the Arm: 'When I move to a battlefield' subscribes to object-moved", () => {
  // 421.1 / 449.1 / 449.2: a Move changes Board locations; 458/458.1 keep Recall
  // out. The battlefield destination is the toZone payload match, matching the
  // merged sfd/ribbon-dancer and sfd/corinna-veraza programs.
  assert.equal(moveAbility.kind, "triggered");
  assert.equal(moveAbility.trigger.at, "object-moved");
  assert.deepEqual(moveAbility.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(moveAbility.trigger.condition, undefined);
  assert.equal(moveAbility.trigger.once, undefined);
  assert.equal(moveAbility.optional, false);
});

test("sfd-112-221 Kato the Arm: one friendly-unit target serves both printed clauses", () => {
  // The English sentence names "a friendly unit" once and gives it two results,
  // so a single TargetSpec locks the choice and the second instruction reuses
  // that same spec id instead of making a second choice (355.5, 355.7).
  assert.equal(moveAbility.body.length, 2);
  assert.deepEqual(moveAbility.body.map(instruction => instruction.id), [
    "kato-the-arm.grant-keywords",
    "kato-the-arm.grant-might"
  ]);
  assert.deepEqual(unitSpec, {
    id: "kato-the-arm.friendly-unit",
    filter: { type: "unit", zone: "board", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.linkedTo, "kato-the-arm.grant-keywords");
});

test("sfd-112-221 Kato the Arm: 'my keywords' is read from the source, not restated", () => {
  // 364.2 / 756-757.1: the granted set is whatever keywords the source has; the
  // program must not enumerate them (that would freeze a moment-in-time list).
  assert.equal(grantKeywords.op, "continuous.grant-keyword");
  assert.deepEqual(grantKeywords.args.keywords, {
    kind: "object-property",
    object: "source",
    property: "keywords"
  });
  assert.deepEqual(grantKeywords.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantKeywords.picks, undefined);
  assert.equal(grantKeywords.linkedTo, undefined);
});

test("sfd-112-221 Kato the Arm: the Might grant reads the source's Might at resolution (143.2.a)", () => {
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.target, {
    kind: "constant",
    value: "kato-the-arm.friendly-unit"
  });
  assert.deepEqual(grantMight.args.amount, {
    kind: "object-property",
    object: "source",
    property: "might"
  });
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
});

test("sfd-112-221 Kato the Arm golden: the merged arithmetic layer applies the source's Might as a bonus", () => {
  // RIFT-91's layer engine consumes the declared amount for the unit the card
  // names; running it proves the +N shape, while the "this turn" lifetime and
  // the card-program registration stay TODO below.
  const kernel = world()
    .unit("kato", { might: 3, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 2, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("kato");
  const ally = kernel.getObject("ally");

  const engine = createLayerEngine([source, ally], [
    {
      effect: {
        id: "kato-the-arm.grant-might",
        layer: "arithmetic",
        source: source.ref,
        filter: { objectId: "ally" },
        effect: {
          kind: "continuous.might",
          mode: "add",
          // 143.2.a / 478: the amount is the source's effective Might as this
          // arithmetic layer is evaluated (source 3 -> ally 2 + 3).
          amount: { kind: "constant", value: source.might }
        }
      },
      duration: { type: "end-of-turn" },
      timestamp: 1,
      sequence: 1
    }
  ]);

  assert.equal(engine.evaluate(ally.ref).might, 5);
  assert.equal(engine.evaluate(source.ref).might, 3);
});

test("sfd-112-221 Kato the Arm golden: the Might bonus tracks the source value, never a fixed constant", () => {
  for (const [sourceMight, expected] of [[3, 5], [5, 7], [1, 3]]) {
    const kernel = world()
      .unit("kato", { might: sourceMight })
      .unit("ally", { might: 2 })
      .build();
    const source = kernel.getObject("kato");
    const ally = kernel.getObject("ally");
    const engine = createLayerEngine([source, ally], [
      {
        effect: {
          id: "kato-the-arm.grant-might",
          layer: "arithmetic",
          source: source.ref,
          filter: { objectId: "ally" },
          effect: {
            kind: "continuous.might",
            mode: "add",
            amount: { kind: "constant", value: source.might }
          }
        },
        duration: { type: "end-of-turn" },
        timestamp: 1,
        sequence: 1
      }
    ]);
    assert.equal(engine.evaluate(ally.ref).might, expected, "source Might " + sourceMight);
  }
});

test.todo(
  "sfd-112-221 Kato the Arm: the object-moved event must carry to/toKind so toZone: \"battlefield\" matches " +
    "only genuine Moves onto a battlefield (449.1/449.2, with 458/458.1 excluding Recalls) and must expose " +
    "the moved object to the card registration (RIFT-120)"
);

test.todo(
  "sfd-112-221 Kato the Arm: 'give a friendly unit my keywords' needs a card-facing continuous.grant-keyword " +
    "instruction that reads the source's live keyword set and registers an end-of-turn grant through " +
    "ResolveContext.addContinuous (layers already evaluate granted keywords) — RIFT-91"
);

test.todo(
  "sfd-112-221 Kato the Arm: 'equal to my Might this turn' needs a card-facing continuous.might instruction " +
    "whose amount is evaluated against the source at resolution and whose lifetime ends with the turn " +
    "(143.2.a, 317.2.c) — the closed GameAction set has no Might-modification action (RIFT-91)"
);

test.todo(
  "sfd-112-221 Kato the Arm: [Deflect]'s target.tax expansion (809.1.c/809.1.d) must append the Power tax " +
    "when an opponent's spell or ability chooses this unit (RIFT-90/91)"
);
