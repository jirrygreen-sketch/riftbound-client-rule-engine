// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ksante-dauntless.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import mightOp from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import keywordOp from "../../../../engine-core/dist/effects/instructions/continuous.keyword.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateInstructionTargets, translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import Shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL = "card.hash-5d66044d59f3bf4f17b4143a7229c8e12673e34e92591de0005f64fad8dd2a82";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "When I attack or defend, double the [Shield] of a unit you control here this turn.";

const [keyword, attackAbility, defendAbility] = program.abilities;
const [attackInstruction] = attackAbility.body;
const [defendInstruction] = defendAbility.body;

test("rad-045-167 K'Sante, Dauntless: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-045-167 K'Sante, Dauntless: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Shield 值/);
  assert.match(program.judgeReason, /arithmetic/);
  assert.match(program.judgeReason, /designation|combatRole/);
  assert.match(program.judgeReason, /sameLocationAs|source-location/);
  assert.doesNotMatch(program.judgeReason, /continuous\.grant-keyword 的 value 是新增一则带值关键词/);
  // The reason must name the merged code that fails, not a task number.
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-045-167 K'Sante, Dauntless: unvalued Shield keyword (814.1.b.3 default 1)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "shield" });
  assert.equal(keyword.value, undefined);
  // RIFT-81 已合入 Shield KeywordDef，展开会消费这个声明。
  assert.equal(keywordDefinitionsById.get("Shield")?.keyword, "Shield");
  assert.equal(keywordDefinitionsById.get("Shield")?.valued, true);
});

test("rad-045-167 K'Sante, Dauntless: one trigger per combat designation (383.4.e / 383.4.f)", () => {
  assert.equal(attackAbility.kind, "triggered");
  assert.equal(attackAbility.trigger.at, "attack-declared");
  assert.deepEqual(attackAbility.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackAbility.optional, false);

  assert.equal(defendAbility.kind, "triggered");
  assert.equal(defendAbility.trigger.at, "defense-declared");
  assert.deepEqual(defendAbility.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(defendAbility.optional, false);
});

test("rad-045-167 K'Sante, Dauntless: both bodies declare doubling the Shield of a unit you control here, this turn", () => {
  for (const [instruction, expectedId] of [
    [attackInstruction, "ksante-dauntless.attack"],
    [defendInstruction, "ksante-dauntless.defend"]
  ]) {
    assert.equal(instruction.id, expectedId);
    // 814.1.b 的 Shield Value 倍增：arithmetic 层的乘 2（本回合到期）。
    assert.equal(instruction.op, "continuous.might");
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "multiply" });
    assert.deepEqual(instruction.args.layer, { kind: "constant", value: "arithmetic" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
    assert.deepEqual(instruction.args.objects, {
      kind: "constant",
      value: { kind: "target", id: "ksante-dauntless.unit-here" }
    });
    assert.deepEqual(instruction.targets, [
      {
        id: "ksante-dauntless.unit-here",
        filter: {
          type: "unit",
          controller: "controller",
          zone: "board",
          sameLocationAs: "self"
        },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("rad-045-167 K'Sante, Dauntless boundary: the multiply form is not an executable continuous.might argument", () => {
  // 814.1.b/814.2: doubling the target's Shield Value needs an arithmetic-layer
  // multiplier over the keyword value. The merged continuous.might accepts only
  // add/set, so the declared multiply mode is rejected at parse and at runtime.
  assert.equal(mightOp.argsSchema.safeParse({
    amount: { kind: "constant", value: 2 },
    mode: { kind: "constant", value: "multiply" },
    objects: { kind: "constant", value: { kind: "target", id: "ksante-dauntless.unit-here" } }
  }).success, true, "the static shape still parses as a declaration");

  const kernel = world().unit("ksante", { might: 4 }).unit("ally", { might: 2 }).build();
  assert.throws(
    () => runInstruction(
      mightOp,
      {
        amount: { kind: "constant", value: 2 },
        mode: { kind: "constant", value: "multiply" },
        objects: { kind: "constant", value: { kind: "target", id: "ksante-dauntless.unit-here" } }
      },
      { world: kernel, targets: { "ksante-dauntless.unit-here": [kernel.ref("ally")] } }
    ),
    /mode must evaluate to "add" or "set"/
  );
  assert.throws(
    () => mightOp.argsSchema.parse({
      amount: { kind: "constant", value: 2 },
      layer: { kind: "constant", value: "arithmetic" },
      objects: { kind: "constant", value: { kind: "target", id: "ksante-dauntless.unit-here" } }
    }),
    /Invalid continuous\.might argument: layer/
  );
});

test("rad-045-167 K'Sante, Dauntless boundary: continuous.keyword can only add a fixed value, never double the current Shield", () => {
  // CR 814.1.b/814.2: doubling doubles the Shield Value the object has now.
  // The merged continuous.keyword primitive only adds a printed grant, so the
  // measured result matches a true doubling only when the grant happens to
  // equal the printed value. This pins the gap instead of approximating it.
  for (const [printed, grant] of [[3, 3], [3, 2], [5, 3], [1, 3]]) {
    const kernel = world()
      .unit("ksante", { might: 4, zone: "board", keywords: [{ id: "Shield", value: printed }] })
      .build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ksante") });
    scoped.setTargets("ksante-dauntless.unit-here", [kernel.ref("ksante")]);
    const run = runInstruction(
      keywordOp,
      {
        keywords: { kind: "constant", value: [{ id: "Shield", value: grant }] },
        target: "ksante-dauntless.unit-here"
      },
      { world: scoped }
    );
    assert.equal(run.result.status, "executed");
    const layers = createLayerEngine(
      scoped.objects,
      scoped.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration }))
    );
    const value = layers.evaluate(kernel.ref("ksante")).keywords.find(entry => entry.id === "Shield")?.value;
    assert.equal(value, printed + grant, `Shield ${printed} plus a fixed grant ${grant} adds to ${printed + grant}`);
    assert.equal(value === printed * 2, printed === grant, "only a coincidental equal grant matches a doubling");
  }
  // 814.2 doubles the value read at resolution; the primitive cannot read it.
  const kernel = world().unit("ksante", { might: 4, keywords: [{ id: "Shield", value: 3 }] }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ksante") });
  scoped.setTargets("ksante-dauntless.unit-here", [kernel.ref("ksante")]);
  assert.throws(
    () => runInstruction(
      keywordOp,
      {
        keyword: { kind: "constant", value: "Shield" },
        value: { kind: "object-property", object: "self", property: "keywords" },
        target: "ksante-dauntless.unit-here"
      },
      { world: scoped }
    ),
    /continuous\.keyword value must be a non-negative integer/
  );
});

test("rad-045-167 K'Sante, Dauntless boundary: the 'here' target filter is not expressible with the merged vocabularies", () => {
  // "a unit you control here" (383.4.e/464.2.b). The card IR filter itself is
  // legal and the reference interpreter's set query honors the anchor; only the
  // production translator refuses it, so nothing can reach the chain yet.
  assert.equal(
    validateCardProgram(program).ok,
    true,
    "the declared sameLocationAs filter passes the card-side validator"
  );
  assert.throws(
    () => translateInstructionTargets(attackAbility.body),
    /Unsupported filter field sameLocationAs/
  );
  const kernel = world().player("A")
    .unit("ksante", { might: 4, controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { might: 2, controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { might: 2, controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const snapshot = kernel.getObject("ksante");
  const scoped = kernel.clone({ sourceSnapshot: snapshot, host: snapshot.ref });
  // The reference kernel compares player selectors literally; the production
  // binding normalizes the card's relative "controller" spelling before the
  // chain sees it (translateObjectFilter -> normalizePlayer, asserted below).
  // Only the location anchor is therefore still a card-side gap.
  const hereCount = runAbilityBody([{
    id: "ksante.here-count",
    op: "condition.predicate",
    args: {
      condition: {
        kind: "constant",
        value: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "objects",
            filter: { type: "unit", controller: "A", zone: "board", sameLocationAs: "self" }
          },
          operator: "eq",
          right: { kind: "constant", value: 2 }
        }
      }
    }
  }], scoped);
  assert.equal(
    hereCount.linkedValues["ksante.here-count.value"],
    true,
    "the sameLocationAs anchor selects exactly K'Sante and the unit at the same battlefield"
  );
  // The merged program filter translation normalizes the relative player
  // anchors, which is why the sameLocationAs anchor - not the controller - is
  // what the card cannot express today.
  assert.deepEqual(
    translateObjectFilter({ type: "unit", controller: "controller", zone: "board" }),
    { type: "unit", controller: "self", zone: "board" }
  );
  const relativeSelector = { ...attackInstruction.targets[0], filter: { type: "unit", zone: "board" }, location: "source-location" };
  assert.equal(relativeSelector.location, "source-location");
  assert.equal(attackInstruction.targets[0].filter.sameLocationAs, "self");
  // target.location is the other route to "here", and it is closed too: only a
  // concrete Battlefield id or a concrete Base reaches the selector validator,
  // so the 359.3.f relative spellings are read as location filters.
  for (const location of [
    { kind: "relative", relation: "source-location" },
    { kind: "location-of", object: "self" },
    { kind: "location-selector", locationOf: "self" }
  ]) {
    const withLocation = validateCardProgram({
      canonicalCardId: program.canonicalCardId,
      rulesetVersion: program.rulesetVersion,
      status: "executable",
      abilities: [{
        kind: "activated",
        timing: "action",
        cost: { energy: { kind: "constant", value: 1 } },
        body: [{ ...attackInstruction, targets: [{ ...attackInstruction.targets[0], filter: { type: "unit", zone: "board" }, location }] }]
      }],
      sourceText: program.sourceText
    });
    assert.equal(withLocation.ok, false);
    assert.deepEqual(
      withLocation.issues.map(issue => [issue.path.split(".").at(-1), issue.code]),
      [["kind", "invalid-location-kind"]]
    );
  }
});

test("rad-045-167 K'Sante, Dauntless boundary: the [Shield] expansion leaves the printed Might unchanged", () => {
  // 814.1.c: the defender bonus reads `designation`, which the merged
  // ObjectSnapshot does not provide (it exposes combatRole); binding therefore
  // produces no Might change rather than an invented +1.
  const expansion = Shield.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion[0].condition.left, {
    kind: "object-property", object: "self", property: "designation"
  });
  const kernel = world().unit("ksante", { might: 4, combatRole: "defender" }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(engine).bindStatic(expansion[0], kernel.getObject("ksante"));
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ksante")).might, 4);
});
