// Template execution evidence: ../templates/play-effect-damage-685.test.mjs.
// This file keeps validation/identity and the key structural assertions; the
// real-path rows live in that template suite. The card stays judge-required:
// the characteristic-selected batch damage set has no merged consumer.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/avalanche.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import heal from "../../../../engine-core/dist/effects/instructions/effect.heal.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /355\.10\.d\.1/);
  assert.match(program.judgeReason, /target\/target-plan/);
  assert.match(program.judgeReason, /became-target/);
  // The reason must name the measured rejection the sibling merged primitives
  // do not share (effect.heal accepts the same descriptor).
  assert.match(program.judgeReason, /effect\.heal/);
  assert.match(program.judgeReason, /args\.target must be a TargetSpec id string/);
  assert.match(program.judgeReason, /play-effect-damage-685/);
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
  // The set descriptor uses the merged non-target query shape
  // ({ kind: "query", filter }), the same one effect.ready / effect.heal read.
  assert.deepEqual(dealInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: "unit", location: "base" }
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
  assert.deepEqual(baseSnapshot.location, { type: "base", player: "A" });
});

test("rad-079-167 Avalanche gap: the non-target query descriptor has no effect.damage consumer", () => {
  // The authored set descriptor is not invented: the merged effect.heal really
  // reads { kind: "query", filter } and resolves, while the same descriptor
  // handed to effect.damage fails at args parsing. That contrast is the exact
  // measured gate named in judgeReason.
  const set = dealInstruction.args.objects;
  const damaged = world()
    .unit("base-unit", { location: { type: "base", player: "A" }, damage: 2 })
    .build();

  // Same descriptor shape, evaluable filter: the merged heal primitive reads the
  // authored set form for real.
  const plainSet = { kind: "constant", value: { kind: "query", filter: { type: "unit" } } };
  const healed = runInstruction(heal, { amount: { kind: "constant", value: 1 }, objects: plainSet }, { world: damaged });
  assert.equal(healed.result.status, "executed");
  assert.deepEqual(healed.linked.healed, {
    amount: 1,
    count: 1,
    objects: [damaged.ref("base-unit")]
  });
  assert.equal(damaged.getObject("base-unit").damage, 1);

  // The card's own descriptor (it adds the "in bases" restriction) is still a
  // valid set form for the merged heal: it parses and resolves. Its zero match
  // count is the reference kernel's literal location comparison, which the
  // production filter above evaluates correctly.
  const restricted = runInstruction(heal, { amount: { kind: "constant", value: 1 }, objects: set }, { world: damaged.clone() });
  assert.equal(restricted.result.status, "executed");
  assert.equal(restricted.linked.healed.count, 0);

  // The same descriptor is refused by effect.damage before any damage action.
  const before = damaged.getObject("base-unit").damage;
  assert.throws(
    () => runInstruction(damage, { amount: dealInstruction.args.amount, objects: set }, { world: damaged }),
    /effect\.damage args\.target must be a TargetSpec id string/
  );
  assert.equal(damaged.getObject("base-unit").damage, before);
});

test.todo(
  "rad-079-167 Avalanche full printed resolution: 'Deal 3 to all units in bases' needs a batch damage path over a " +
    "characteristic-selected set (355.10.d) — effect.damage reads ctx.targets(TargetSpec id) only and its " +
    "argsSchema requires a target string, so the authored query set has no consumer."
);

test.todo(
  "rad-079-167 Avalanche: proving the simultaneous-damage and rule-055 partial-resolution behaviour " +
    "(418.1.c/418.1.d, 055) needs the batch set op above and the event pipeline."
);
