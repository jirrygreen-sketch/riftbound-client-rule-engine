import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/harpoon-squad.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-f696312134479041b97777c95666ee948dd620df1b82a432d5d877753660bfd2";
const SOURCE_TEXT = "When I move from a battlefield, give me +2 :rb_might: this turn.";
const MIGHT_ID = "harpoon-squad.give-plus-2";

const [ability] = program.abilities;
const [might] = ability.body;

test("sfd-137-221 Harpoon Squad: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-137-221 Harpoon Squad: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-137-221 Harpoon Squad: one object-moved trigger filtered to this unit leaving a battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 449.2: a Move is a permanent changing Location; 458/458.1
  // keeps Recalls out of Move triggers.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    fromZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-137-221 Harpoon Squad: the body declares a temporary +2 Might on the host, not a Buff counter", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(might.id, MIGHT_ID);
  assert.equal(might.op, "continuous.might");
  // 143.2.a / 317.2.c: a Might modification that expires at end of turn.
  assert.deepEqual(might.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(might.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the ability host: the symbolic selector "self", never a
  // fabricated TargetSpec and never a runtime ObjectRef (contract 3.6).
  assert.deepEqual(might.args.object, { kind: "constant", value: "self" });
  assert.equal(might.targets, undefined);
  assert.equal(might.picks, undefined);
  assert.equal(might.linkedTo, undefined);
});

test("sfd-137-221 Harpoon Squad: the merged arithmetic layer applies the declared +2 Might to the host", () => {
  // The layers engine (RIFT-91) consumes the declared continuous.might effect
  // when a caller registers it; this executes the real arithmetic path for the
  // amount this card declares. The object-moved trigger and the card-facing
  // continuous.might instruction stay TODO (see judgeReason).
  const kernel = world()
    .unit("harpoon", { zone: "board", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = kernel.getObject("harpoon");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: MIGHT_ID,
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "harpoon" },
        effect: { kind: "continuous.might", mode: "add", amount: { kind: "constant", value: 2 } }
      },
      // 317.2.c: the end-of-turn duration is what this card's "this turn" needs.
      duration: { type: "end-of-turn" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 6);

  // A permanent registration of the same effect keeps the +2 as well; the
  // amount this card declares is never turned into a Buff counter (702-704).
  assert.equal(snapshot.buffs, 0);
});

test.todo(
  "sfd-137-221 Harpoon Squad: the object-moved emission must carry the Move's origin payload " +
    "(fromKind/fromLocationId, timing-points.ts) so fromZone: \"battlefield\" matches only genuine Moves " +
    "starting at a battlefield (449.1/449.2, with 458/458.1 excluding Recalls) and must expose the moved " +
    "object's identity to the card registration (RIFT-120)"
);

test.todo(
  "sfd-137-221 Harpoon Squad: '+2 Might this turn' needs a merged continuous.might instruction that registers " +
    "the arithmetic-layer effect through ResolveContext.addContinuous with an end-of-turn duration (the layers " +
    "engine itself can evaluate it, but effects/instructions/ has no such opcode) — RIFT-9 / RIFT-91"
);
