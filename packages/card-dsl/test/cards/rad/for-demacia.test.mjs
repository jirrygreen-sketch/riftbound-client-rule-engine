
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/for-demacia.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a battlefield. Give friendly units there [Shield 2] this turn. " +
  "(+2 :rb_might: while they're defenders.)";

const [keyword, play] = program.abilities;
const [grantInstruction] = play.body;

const unit = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: "card:" + id,
  name: id,
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "bf-1" },
  might: 2,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

test("For Demacia! program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("For Demacia! identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /designation/);
  // The merged grant op must no longer be described as unregistered.
  assert.doesNotMatch(program.judgeReason, /该原语未注册/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("For Demacia! structure: [Reaction], printed cost, battlefield target plus Shield 2 grant", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(play.body.length, 1);

  // 814.1.c: "[Shield 2] this turn" is an end-of-turn keyword grant of Shield 2.
  assert.equal(grantInstruction.id, "for-demacia.grant-shield");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Shield" });
  assert.deepEqual(grantInstruction.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });

  // 170 / 170.7 / 355.10.a.1: the chosen battlefield is a target.
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "for-demacia.battlefield",
      filter: { type: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // 355.10.d: "friendly units there" is a criteria-based set, not a target. The
  // set is carried by the objects query so the interpreter resolves the "here"
  // anchor at resolution time (053.3), and no unit TargetSpec is declared.
  assert.equal(grantInstruction.targets.length, 1);
  assert.deepEqual(grantInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        controller: "self",
        zone: "board",
        sameLocationAs: { target: "for-demacia.battlefield" }
      }
    }
  });
  assert.equal(grantInstruction.picks, undefined);
});

test("For Demacia! golden: only friendly units at the chosen battlefield receive [Shield 2]", () => {
  const kernel = world()
    .unit("bf", { types: ["battlefield"], location: { type: "battlefield", id: "bf-9" } })
    .unit("allyHere", { location: { type: "battlefield", id: "bf-9" } })
    .unit("allyElsewhere", { location: { type: "battlefield", id: "bf-1" } })
    .unit("foeHere", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-9" } })
    .build();
  // The chain context resolves the selector spelling and the "here" anchor
  // (src/chain/engine.ts overrides query for controller self/opponent and the
  // interpreter resolves sameLocationAs); this stub mirrors that one override.
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => raw({
    ...filter,
    ...(filter.controller === "self" ? { controller: "A" } : {}),
    ...(filter.controller === "opponent" ? { controller: "B" } : {})
  });
  // Finalize locked the printed battlefield target; the card's own instruction
  // then resolves its own set through the interpreter's anchor resolution.
  kernel.setTargets("for-demacia.battlefield", [kernel.ref("bf")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["for-demacia.grant-shield", "executed"]]
  );
  // Exactly one object-scoped ability-layer grant, for the friendly unit at the
  // chosen battlefield.
  assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.effect.filter), [
    { objectId: "allyHere", zone: "board", zoneEntryId: 1 }
  ]);
  // The ability-layer payload names the granted keyword and its value; the
  // registration (not the card) decides the remaining bookkeeping fields.
  assert.equal(kernel.snapshot().continuous[0].effect.effect.kind, "continuous.grant-keyword");
  assert.equal(kernel.snapshot().continuous[0].effect.effect.keyword, "Shield");
  assert.equal(kernel.snapshot().continuous[0].effect.effect.keywordValue, 2);
  // CR 317.2.c: "this turn" is the end-of-turn duration.
  assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.duration), [
    { type: "end-of-turn" }
  ]);
});

test("For Demacia! golden: the granted Shield really lands in the ability layer and the printed Might keyword", () => {
  const kernel = world()
    .unit("bf", { types: ["battlefield"], location: { type: "battlefield", id: "bf-9" } })
    .unit("allyHere", { location: { type: "battlefield", id: "bf-9" } })
    .build();
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => raw({
    ...filter,
    ...(filter.controller === "self" ? { controller: "A" } : {})
  });
  kernel.setTargets("for-demacia.battlefield", [kernel.ref("bf")]);
  resolveChainBody(play.body, kernel);

  // The merged layers engine applies the registered ability-layer grant: the
  // unit really gains Shield 2 as a keyword characteristic (814.3).
  const engine = createLayerEngine(
    kernel.query({}),
    kernel.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.deepEqual(
    engine.evaluate(kernel.ref("allyHere")).keywords,
    [{ id: "Shield", value: 2 }]
  );
});

test("For Demacia! golden: the granted Shield cannot be honoured as printed yet (814.1.d)", () => {
  // Shield's merged expansion (effects/keywords/Shield.ts) is a
  // continuous.might static ability gated on `designation === "defender"`.
  // The merged arithmetic layer ignores that Compare condition (layers/engine.ts
  // conditionMatches only implements always/never/type/has-tag/has-keyword), so
  // the +2 Might would apply unconditionally: 814.1.d has no consumer. This
  // pins the actual current behaviour instead of assuming the grant works.
  const shielded = unit("allyHere", { keywords: [{ id: "Shield", value: 2 }], might: 2 });
  const spec = {
    id: "shield",
    layer: "arithmetic",
    source: shielded.ref,
    filter: { objectId: "allyHere" },
    effect: {
      kind: "continuous.might",
      mode: "add",
      appliesTo: "self",
      amount: { kind: "constant", value: 2 }
    },
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "designation" },
      operator: "eq",
      right: { kind: "constant", value: "defender" }
    }
  };
  const engine = createLayerEngine([shielded], [{ effect: spec, duration: { type: "permanent" } }]);
  // The condition is not evaluated, so the +2 lands even without a defender
  // designation — the reason the card stays judge-required.
  assert.equal(engine.evaluate(shielded.ref).might, 4);
});

test.todo(
  "For Demacia!: the granted [Shield 2] may only add Might while the unit is a defender (CR 814.1.c/814.1.d); " +
    "the merged arithmetic layer ignores the Shield expansion's designation condition, so the effect cannot be " +
    "honoured — the defender designation characteristic and combat designation wiring are still unmerged " +
    "(contract 3.8 combatRole exists but no producer sets it)"
);

test.todo(
  "For Demacia!: resolve the printed play body through the production target/chain path, including locking the " +
    "chosen battlefield before the friendly-unit set is evaluated; current golden coverage invokes the body with " +
    "that battlefield target already locked"
);
