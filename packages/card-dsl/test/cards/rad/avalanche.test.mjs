import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/avalanche.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-93ccf4a04222adbd61db565ce07b24bcbe42a6cf03edc5ff3ab1d63feb45bad5";
const [play] = program.abilities;
const [dealInstruction] = play.body;

test("rad-079-167 Avalanche: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "Deal 3 to all units in bases.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-079-167 Avalanche: judgeReason names the set-selection damage path", () => {
  assert.match(program.judgeReason, /ctx\.targets/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /location/);
  assert.match(program.judgeReason, /target\.many|RIFT-90/);
});

test("rad-079-167 Avalanche: structure — printed energy 5 plus 2 power, one set damage instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(dealInstruction.id, "avalanche.deal-3");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 3 });
  // "all units in bases" is chosen by characteristics, so it is not a target:
  // no TargetSpec and no pick may be declared (355.10.d).
  assert.equal(dealInstruction.targets, undefined);
  assert.equal(dealInstruction.picks, undefined);
  assert.equal(dealInstruction.linkedTo, undefined);
  assert.deepEqual(dealInstruction.args.objects, {
    kind: "constant",
    value: {
      filter: { type: "unit", location: { type: "base" } },
      selection: "all"
    }
  });
});

test("rad-079-167 Avalanche: the authored set selector is rejected by the merged damage primitive", () => {
  // effect.damage reads its affected set from ctx.targets(TargetSpec id) only,
  // so a characteristic-selected set is not expressible: the primitive rejects
  // the instruction instead of silently damaging a wrong set. This assertion
  // pins that the card does not smuggle the set in as a fake target.
  const kernel = world().base("base-unit").build();
  const args = { amount: dealInstruction.args.amount, objects: dealInstruction.args.objects };
  assert.throws(() => damage.argsSchema.parse(args), /args\.target must be a TargetSpec id string/);
  assert.equal(kernel.getObject("base-unit").damage, 0);
});

test("rad-079-167 Avalanche: neither the kernel nor the layer filter evaluates a nested location filter", () => {
  // "in bases" cannot be expressed with the merged filter vocabulary: the
  // reference kernel matches location as an exact JSON value (so a unit in a
  // base never matches { type: "base" }), and layers/filter.ts compares
  // location against a zone-name string. Both directions are asserted so a
  // future filter change cannot silently make this card look executable.
  const kernel = world().base("base-unit", { location: { type: "base", player: "A" } }).build();
  const nestedFilter = dealInstruction.args.objects.value.filter;
  assert.equal(kernel.query(nestedFilter).length, 0);
  assert.equal(kernel.query({ type: "unit", location: "base" }).length, 0);
  const snapshot = kernel.getObject("base-unit");
  assert.deepEqual(snapshot.location, { type: "base", player: "A" });
});

test.todo(
  "rad-079-167 Avalanche: 'Deal 3 to all units in bases' needs a batch damage path over a " +
    "characteristic-selected set (target.many semantics, 355.10.d) plus a filter that evaluates " +
    "location.type (Base vs Battlefield) — RIFT-90 (target system / set primitives)."
);

test.todo(
  "rad-079-167 Avalanche: proving the simultaneous-damage and rule-055 partial-resolution behaviour " +
    "(418.1.c/418.1.d, 055) needs the batch set op above and the event pipeline — RIFT-89/90."
);
