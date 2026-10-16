import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import siphonPower from "../../../dist/cards/ogn/siphon-power-viktor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-d619150ac39f656ea38c332ad3a03989be755c3114becae61bb346ae3996951d";
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [keyword, play] = siphonPower.abilities;
const [friendlyInstruction, enemyInstruction] = play.body;

/** A minimal board object for direct layer-engine evaluation. */
function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: `card:${id}`,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: values.owner ?? "A",
    controller: values.controller ?? "A",
    zone: "board",
    location: values.location ?? BATTLEFIELD("bf1"),
    might: values.might ?? 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
}

test("Siphon Power program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(siphonPower);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Siphon Power identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(siphonPower.canonicalCardId, CANONICAL);
  assert.equal(siphonPower.rulesetVersion, "core-1.5");
  assert.equal(siphonPower.status, "judge-required");
  assert.equal(
    siphonPower.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Choose a battlefield. Give friendly units there +1 :rb_might: this turn and enemy units there " +
      "-1 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  // The judgeReason must name the missing continuous.might registration, the
  // printed minimum and the rule it comes from.
  assert.match(siphonPower.judgeReason, /continuous\.might/);
  assert.match(siphonPower.judgeReason, /479\.4\.b/);
  assert.match(siphonPower.judgeReason, /addContinuous/);
  assert.match(siphonPower.judgeReason, /355\.10\.d/);
  assert.equal(cardRegistryById.get(siphonPower.canonicalCardId), siphonPower);
});

test("Siphon Power declares the printed [Reaction] keyword (CR 813)", () => {
  assert.equal(siphonPower.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
});

test("Siphon Power structure: the battlefield choice plus the two Might instructions", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 2);

  // "Choose a battlefield" (355.5 / 355.7 / 355.9.a) — the Zone is chosen, so
  // it is the target the unit sets anchor on with sameLocationAs.
  assert.equal(friendlyInstruction.targets.length, 1);
  assert.deepEqual(friendlyInstruction.targets[0], {
    id: "chosen-battlefield",
    filter: { type: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(enemyInstruction.targets, undefined);

  // "Give friendly units there +1 Might this turn" — a programmatic set
  // (355.10.d), not a target group, with the end-of-turn duration.
  assert.equal(friendlyInstruction.id, "grant-plus-1-to-friendly-units");
  assert.equal(friendlyInstruction.op, "continuous.might");
  assert.deepEqual(friendlyInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(friendlyInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(friendlyInstruction.args.minimum, undefined);
  assert.deepEqual(friendlyInstruction.args.appliesTo, {
    kind: "constant",
    value: {
      filter: {
        type: "unit",
        controller: "self",
        sameLocationAs: { target: "chosen-battlefield" }
      }
    }
  });
  assert.equal(friendlyInstruction.linkedTo, undefined);

  // "... and enemy units there -1 Might this turn, to a minimum of 1 Might."
  // The printed limit is carried explicitly (479.4.b snapshots it).
  assert.equal(enemyInstruction.id, "grant-minus-1-to-enemy-units");
  assert.equal(enemyInstruction.op, "continuous.might");
  assert.deepEqual(enemyInstruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(enemyInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(enemyInstruction.args.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(enemyInstruction.args.appliesTo, {
    kind: "constant",
    value: {
      filter: {
        type: "unit",
        controller: "opponent",
        sameLocationAs: { target: "chosen-battlefield" }
      }
    }
  });
  assert.equal(enemyInstruction.linkedTo, undefined);
  assert.equal(play.cost, undefined);
});

test("Siphon Power: continuous.might is not a registered instruction opcode", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  // Fail closed rather than silently resolving with no Might change at all.
  const kernel = world().build();
  const body = play.body.map(({ targets, ...rest }) => rest);
  assert.throws(
    () => runAbilityBody(body, kernel),
    /continuous\.might/
  );
});

test("Siphon Power: the layers engine can apply the arithmetic, but nothing registers it from a spell", () => {
  // The gap is the missing instruction-level entry point, not the layer math:
  // RIFT-91 landed the arithmetic layer and its end-of-turn expiry, and the
  // official 478.1.c example in the CR is this card.
  const friendly = unit("friendly", { controller: "A", might: 4 });
  const enemy = unit("enemy", { controller: "B", might: 4 });
  const engine = createLayerEngine([friendly, enemy], [
    {
      effect: {
        id: "siphon-plus",
        layer: "arithmetic",
        filter: { type: "unit", controller: "A" },
        effect: { kind: "increase", amount: 1 }
      },
      duration: { type: "end-of-turn" }
    },
    {
      effect: {
        id: "siphon-minus",
        layer: "arithmetic",
        filter: { type: "unit", controller: "B" },
        effect: { kind: "decrease", amount: 1 }
      },
      duration: { type: "end-of-turn" }
    }
  ]);

  const evaluated = engine.evaluateAll();
  assert.equal(evaluated.find(object => object.ref.id === "friendly").might, 5);
  assert.equal(evaluated.find(object => object.ref.id === "enemy").might, 3);
  // The end-of-turn lifetime is real and expirable.
  assert.deepEqual(engine.expireAt("turn-end"), ["siphon-plus", "siphon-minus"]);
  assert.equal(engine.evaluateAll().find(object => object.ref.id === "friendly").might, 4);
});

test("Siphon Power: the printed minimum of 1 is not implied by the merged layer math", () => {
  // 479.4.b snapshots the printed limitation when the effect is applied. The
  // merged arithmetic layer only clamps at 0, so a plain decrease of 4 turns a
  // 2-Might unit into 0 — proof that the floor must come from the missing
  // primitive and may not be assumed or written as a fixed final value.
  const weak = unit("weak", { controller: "B", might: 2 });
  const engine = createLayerEngine([weak], [
    {
      effect: {
        id: "siphon-minus-4",
        layer: "arithmetic",
        filter: { type: "unit", controller: "B" },
        effect: { kind: "decrease", amount: 4 }
      },
      duration: { type: "end-of-turn" }
    }
  ]);

  assert.equal(engine.evaluate(weak.ref).might, 0);
  assert.notEqual(engine.evaluate(weak.ref).might, 1);
});

test.todo(
  "Siphon Power: register an instruction-level continuous.might effect through ctx.addContinuous with a " +
    "this-turn duration, the friendly/enemy programmatic sets anchored on the chosen battlefield, and the " +
    "printed minimum-1 snapshot for the decrease (479.4.b / 479.4.e.1-e.2; the layers evaluation side " +
    "landed with RIFT-91)"
);

test.todo(
  "Siphon Power: choose a battlefield as a Zone target (355.5 / 355.7 / 355.9.a) and keep the unit sets " +
    "non-targeted (355.10.d / 355.10.d.1) — needs the location-target form in the target system (RIFT-90)"
);

test.todo(
  "Siphon Power: the official 478.1.c dependency-loop example (two 4-Might units with mutually referencing " +
    "conditional buffs end at 4 each) stays with the layers dependency work, not with card data"
);

