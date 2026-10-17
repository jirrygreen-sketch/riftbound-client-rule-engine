// Template scenarios: ../templates/play-effect-damage-659.test.mjs (set damage pending).
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/avalanche.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
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

test("rad-079-167 Avalanche: judgeReason names the missing batch set damage path", () => {
  assert.match(program.judgeReason, /ctx\.targets/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /target\/target-plan/);
  assert.doesNotMatch(program.judgeReason, /RIFT-90/);
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
      // The evaluated string spelling (object.location.type) the production
      // filter consumes (layers/rules/query.ts).
      filter: { type: "unit", location: "base" },
      selection: "all"
    }
  });
});

test("rad-079-167 Avalanche: the production filter evaluates the 'in bases' restriction", () => {
  // "in bases" is expressible: the production layer filter compares the
  // string spelling against object.location.type, so a unit in a Base matches
  // while a unit at a Battlefield does not. The reference kernel's set query
  // matches the location object as an exact JSON value, so it is the
  // production filter — not the kernel — that evaluates this restriction
  // (same convention as the merged sibling goldens).
  const kernel = world().base("base-unit", { location: { type: "base", player: "A" } }).build();
  const inBases = dealInstruction.args.objects.value.filter;
  const baseSnapshot = kernel.getObject("base-unit");
  assert.equal(matchesObjectFilter(inBases, baseSnapshot), true);
  const battlefieldKernel = world().unit("bf-unit", { location: { type: "battlefield", id: "bf-1" } }).build();
  assert.equal(matchesObjectFilter(inBases, battlefieldKernel.getObject("bf-unit")), false);
  const snapshot = kernel.getObject("base-unit");
  assert.deepEqual(snapshot.location, { type: "base", player: "A" });
});

test.todo(
  "rad-079-167 Avalanche: 'Deal 3 to all units in bases' needs a batch damage path over a " +
    "characteristic-selected set (target.many semantics, 355.10.d): effect.damage " +
    "reads ctx.targets(TargetSpec id) only and its argsSchema requires a target string, so the " +
    "authored objects selector has no consumer."
);

test.todo(
  "rad-079-167 Avalanche: proving the simultaneous-damage and rule-055 partial-resolution behaviour " +
    "(418.1.c/418.1.d, 055) needs the batch set op above and the event pipeline."
);
