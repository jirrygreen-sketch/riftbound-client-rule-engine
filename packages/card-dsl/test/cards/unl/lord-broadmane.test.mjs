import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lord-broadmane.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7fca30537894dafdae14a16780cb746b71b61799934fb26663599e56c55fe2bd";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play me, give your other units here [Assault] this turn. " +
  "(+1 :rb_might: while they're attackers.)";

const [keyword, triggered] = program.abilities;
const [grantAssault] = triggered.body;
const grantedFilter = grantAssault.args.filter.value;

/** Mirrors chain/engine.ts's normalization of the static controller spellings. */
function chainQuery(kernel, controller) {
  return value => {
    const normalized = { ...value };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.listObjects().filter(object => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      return matchesObjectFilter({
        ...normalized,
        ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
        ...(normalized.owner === "opponent" ? { owner: "any" } : {})
      }, object);
    });
  };
}

test("unl-012-219 Lord Broadmane: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-012-219 Lord Broadmane: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.b/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-84/);
});

test("unl-012-219 Lord Broadmane: Ambush keyword plus a self play trigger", () => {
  assert.equal(program.abilities.length, 2);
  // 822.1 / 822.1.a: Ambush is a Passive Ability keyword, normally on Units, and
  // 822 has no numeric form.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ambush" });
  assert.equal(keyword.value, undefined);

  // 383.4.a / 383.4.a.1: "When you play me…" is a Play Effect for this card.
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
});

test("unl-012-219 Lord Broadmane: the granted Assault lasts this turn and exempts the source itself", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["lord-broadmane.grant-assault"]);
  // 801.3.a: another effect may grant a Keyword; 801.3.a.2: the granting effect
  // states the duration, printed here as "this turn".
  assert.equal(grantAssault.op, "continuous.grant-keyword");
  assert.deepEqual(grantAssault.args.keyword, { kind: "constant", value: "assault" });
  assert.deepEqual(grantAssault.args.duration, { kind: "constant", value: "end-of-turn" });
  // 807.1.b.3: the reminder's "+1" is the granted Assault's default value, so the
  // grant itself carries no value and is not invented here.
  assert.equal(grantAssault.args.value, undefined);
  assert.equal(grantAssault.targets, undefined, "355.10.d: the set is programmatic, so it is not a TargetSpec");
  assert.equal(grantAssault.picks, undefined, "355.10.d: not a pick either");
  assert.equal(grantAssault.linkedTo, undefined);
});

test("unl-012-219 Lord Broadmane: 'your other units here' is a same-location set excluding the source", () => {
  assert.deepEqual(grantedFilter, {
    zone: "board",
    type: "unit",
    controller: "self",
    exclude: "self",
    sameLocationAs: "self"
  });
  // README section 3: object anchors are symbolic selectors, never runtime refs.
  assert.equal(grantedFilter.sameLocationAs, "self");
  assert.equal(grantedFilter.exclude, "self");

  const kernel = world()
    .unit("broadmane", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-here", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-elsewhere", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const matched = queryObjects(grantedFilter, {
    context: kernel,
    host: kernel.ref("broadmane"),
    query: chainQuery(kernel, "A"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  }).map(object => object.ref.id);
  // "other" excludes the source (355.9.c); "here" keeps only the same location
  // (053.3); "your" excludes the opposing unit (740.1.a).
  assert.deepEqual(matched, ["friendly-here"]);
});

test("unl-012-219 Lord Broadmane: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-012-219 Lord Broadmane: expand [Ambush] (CR 822.1.b/.c) — the battlefield-where-you-control-Units play " +
    "location plus the Reaction permission for that play only; effects/keywords/Ambush.ts is not merged (RIFT-84)"
);

test.todo(
  "unl-012-219 Lord Broadmane: grant [Assault] to your other units here until end of turn (CR 801.3.a.2, 807.1.b.3) — " +
    "no registered continuous.grant-keyword instruction primitive and no consumer that registers a card's abilities " +
    "through layers (RIFT-81 / RIFT-91)"
);
