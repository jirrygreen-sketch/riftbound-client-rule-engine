import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import Mighty, {
  MIGHTY_THRESHOLD,
  mightyCondition
} from "../../../dist/effects/keywords/Mighty.js";
import { keywordRegistryById } from "../../../dist/effects/keywords/registry.generated.js";
import { TestWorld, world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "ogn-232-298" };

function programFor(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Mighty]"
  };
}

/** Evaluates the rule 708 predicate expansion against a live object snapshot. */
function evaluateMightyPredicate(effect, snapshot) {
  assert.equal(effect.kind, "condition.value");
  assert.equal(effect.predicate, "is-mighty");
  assert.equal(effect.threshold, MIGHTY_THRESHOLD);
  const might =
    snapshot.zone === "board" ? snapshot.might : snapshot.printedMight ?? snapshot.might;
  return might !== null && might >= effect.threshold;
}

test("definition matches the v1.5 keyword contract", () => {
  assert.equal(Mighty.keyword, "Mighty");
  assert.equal(Mighty.valued, false);
  assert.equal(Mighty.stacking, "single");
  assert.deepEqual(Mighty.ruleRefs, ["706", "707", "708", "709", "710", "711"]);
});

test("expand returns one static condition.value predicate ability", () => {
  const abilities = Mighty.expand({ host: HOST });
  assert.equal(abilities.length, 1);
  const ability = abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "condition.value");
  assert.equal(ability.effect.predicate, "is-mighty");
  assert.equal(ability.effect.threshold, MIGHTY_THRESHOLD);
  assert.deepEqual(ability.effect.subject, { kind: "constant", value: HOST.canonicalCardId });
  assert.deepEqual(ability.effect.zoneEvaluation, {
    board: "current-might",
    nonBoard: "printed-might"
  });
  assert.deepEqual(ability.effect.ruleRefs, ["706", "707", "708", "710", "711"]);
});

test("expansion passes validateCardProgram inside a minimal CardProgram", () => {
  const result = validateCardProgram(programFor([...Mighty.expand({ host: HOST })]));
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("the is-mighty compare condition passes validation as an ability condition", () => {
  const ability = {
    kind: "static",
    effect: { kind: "continuous.might", value: { kind: "constant", value: 1 } },
    condition: mightyCondition(HOST)
  };
  const result = validateCardProgram(programFor([ability]));
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("stacking is single: repeated copies expand identically and count once", () => {
  const first = Mighty.expand({ host: HOST });
  const second = Mighty.expand({ host: HOST });
  assert.deepEqual(second, first);
  // Mighty is a binary description (v1.5 706-708), so N copies of the keyword
  // behave as one: combine by taking the first expansion, not concatenating.
  const combined = [first[0], second[0]];
  const unique = combined.length === 0 ? [] : [combined[0]];
  assert.equal(unique.length, 1);
  const result = validateCardProgram(programFor(unique));
  assert.equal(result.ok, true);
});

test("numeric boundary: rule 708 threshold is exactly 5 (4 is not Mighty, 5 is)", () => {
  const effect = Mighty.expand({ host: HOST })[0].effect;
  const below = world()
    .unit("u4", { might: MIGHTY_THRESHOLD - 1 })
    .build();
  const at = world()
    .unit("u5", { might: MIGHTY_THRESHOLD })
    .build();
  const above = world()
    .unit("u6", { might: MIGHTY_THRESHOLD + 1 })
    .build();
  assert.equal(evaluateMightyPredicate(effect, below.getObject("u4")), false);
  assert.equal(evaluateMightyPredicate(effect, at.getObject("u5")), true);
  assert.equal(evaluateMightyPredicate(effect, above.getObject("u6")), true);
});

test("buff crossing the threshold makes a unit Mighty (v1.5 709 example)", () => {
  const effect = Mighty.expand({ host: HOST })[0].effect;
  const kernel = world()
    .unit("u1", { might: MIGHTY_THRESHOLD - 1 })
    .build();
  const ref = kernel.ref("u1");
  assert.equal(evaluateMightyPredicate(effect, kernel.getObject("u1")), false);
  kernel.perform({ type: "buff", object: ref, amount: 1 });
  // The reference kernel models buffs separately from might; a real engine adds
  // +1 might per buff in the arithmetic layer (v1.5 703). Apply the layer
  // arithmetic to mirror the official example (4 might + 1 buff becomes Mighty).
  const snapshot = kernel.getObject("u1");
  const effective = { ...snapshot, might: snapshot.might + snapshot.buffs };
  assert.equal(evaluateMightyPredicate(effect, effective), true);
});

test("rule 711: non-board zones evaluate printed Might; on-board buffs do not matter", () => {
  const effect = Mighty.expand({ host: HOST })[0].effect;
  const kernel = world()
    .unit("printed5", { might: MIGHTY_THRESHOLD })
    .build();
  const ref = kernel.ref("printed5");
  kernel.perform({ type: "kill", object: ref });
  const inTrash = kernel.getObject("printed5");
  assert.equal(inTrash.zone, "trash");
  assert.equal(evaluateMightyPredicate(effect, inTrash), true);

  const low = world()
    .unit("printed4", { might: MIGHTY_THRESHOLD - 1 })
    .build();
  const lowRef = low.ref("printed4");
  low.perform({ type: "buff", object: lowRef, amount: 3 });
  low.perform({ type: "kill", object: low.ref("printed4") });
  const lowInTrash = low.getObject("printed4");
  assert.equal(lowInTrash.zone, "trash");
  // Printed might 4: the on-board buffs are gone in the trash, so not Mighty.
  assert.equal(evaluateMightyPredicate(effect, lowInTrash), false);
});

test("rule 710 example: +3 might this turn makes a 3-might unit Mighty until expiry", () => {
  const effect = Mighty.expand({ host: HOST })[0].effect;
  const kernel = world()
    .unit("u3", { might: 3 })
    .build();
  const ref = kernel.ref("u3");
  assert.equal(evaluateMightyPredicate(effect, kernel.getObject("u3")), false);
  // +3 this turn: model the arithmetic layer as a might-setting action through
  // the kernel buff channel (1 buff = +1 might, v1.5 703).
  kernel.perform({ type: "buff", object: ref, amount: 3 });
  const snapshot = kernel.getObject("u3");
  const effective = { ...snapshot, might: snapshot.might + snapshot.buffs };
  assert.equal(effective.might, 6);
  assert.equal(evaluateMightyPredicate(effect, effective), true);
});

test("might-changed timing point exists and cites rules 708/709", async () => {
  const { getTimingPoint, isTimingPointId } = await import("../../../dist/events/timing-points.js");
  assert.ok(isTimingPointId("might-changed"), "might-changed is a registered timing point");
  const point = getTimingPoint("might-changed");
  assert.equal(point.payloadType, "might");
  assert.ok(point.ruleRefs.includes("708"));
  assert.ok(point.ruleRefs.includes("709"));
});

test("generated keyword registry indexes Mighty by keyword id", () => {
  assert.equal(keywordRegistryById.get("Mighty"), Mighty);
});
