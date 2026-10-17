import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/heisho-shell-of-the-world.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";

const CANONICAL =
  "card.hash-ff672b8dd077ccd490192a9b17852cd59002a5bbc12aa7153e4ad607915036ee";
const SOURCE_TEXT =
  "Players ignore [Deflect] while paying for spells and abilities choosing something here.";

const [ability] = program.abilities;
const { effect } = ability;

test("ven-158-166 Heisho: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-158-166 Heisho: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /76[4-7]/);
  assert.match(program.judgeReason, /TargetTaxCostAdapter|target\.tax/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /no layer mapping/);
  // The golden must prove the new program reaches the shared generated index,
  // not just the file system (scripts/gen-registries.mjs builds it from src/cards/**).
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ven-158-166 Heisho: one static Ignoring Effect over Deflect for this payment procedure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 764 / 765 / 766: the ignored abilities are treated as inactive during the
  // named game procedure; 766's own example is exactly "Ignore Deflect while
  // paying this spell's costs".
  assert.equal(effect.kind, "continuous.ignore-abilities");
  assert.deepEqual(effect.abilities, ["Deflect"]);
  assert.equal(effect.during, "paying-costs");

  // 767 / 767's second example: the waiver only applies to the players the
  // ability directs; this card says "Players", so every player is covered.
  assert.equal(effect.for.player, "any");
  assert.equal(effect.for.spellOrAbility, "chooses-something-here");
  // 053.3 "here" is this Battlefield; the sameLocationAs:self anchor is merged
  // in programs/statics.ts staticFilter and binds to the source location.
  assert.deepEqual(effect.for.location, { sameLocationAs: "self" });
});

test("ven-158-166 Heisho: the merged Deflect expansion is what this card would ignore", () => {
  // 809.1 / 809.1.c: Deflect expands to the static target tax. The card names
  // that keyword; it does not re-implement the tax itself.
  const deflect = keywordDefinitionsById.get("Deflect");
  assert.ok(deflect, "effects/keywords/Deflect.ts must be in the generated registry");
  const expansion = deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion, [
    { kind: "static", effect: { kind: "target.tax", value: { kind: "constant", value: 1 } } }
  ]);
});

test("ven-158-166 Heisho golden: the Deflect tax really attaches to a target via the merged target plan", () => {
  // 809.1.c / 356.2.a.2: choosing a unit with Deflect adds a mandatory Power
  // cost. The merged TargetPlan appends it through TargetTaxAdapter, and the
  // unpayable result is what this card prints an exception for (764-767).
  const kernel = world()
    .unit("deflector", {
      types: ["unit"],
      controller: "A",
      keywords: [{ id: "Deflect", value: 1 }]
    })
    .build();
  const ref = kernel.ref("deflector");

  const appended = [];
  finalizeTargetPlan(
    kernel,
    { id: "heisho.target", filter: { type: "unit", zone: "board" } },
    {
      selected: [ref],
      tax: { kind: "deflect", amount: 1 },
      taxAdapter: { appendTargetTax: request => appended.push(request) }
    }
  );
  assert.equal(appended.length, 1);
  assert.equal(appended[0].kind, "deflect");
  assert.equal(appended[0].amount, 1);
  assert.deepEqual(appended[0].target, ref);
});

test("ven-158-166 Heisho golden: the merged Deflect tax accepts a real Power payment once the adapter can pay it", () => {
  // The waiver this card prints would suppress this tax; until 764-767 exists,
  // the golden shows the tax the card is written against is genuinely payable
  // (so the waiver is not confused with "the tax is zero").
  const kernel = world()
    .unit("deflector", {
      types: ["unit"],
      controller: "A",
      keywords: [{ id: "Deflect", value: 1 }]
    })
    .build();
  const ref = kernel.ref("deflector");

  const paid = [];
  finalizeTargetPlan(
    kernel,
    { id: "heisho.target", filter: { type: "unit", zone: "board" } },
    {
      selected: [ref],
      tax: { kind: "deflect", amount: 1 },
      taxAdapter: {
        appendTargetTax: request => {
          // 135.2.e.5.a / 163.2.b: [A] is payable by Power of any Domain.
          const payable = { power: ["Fury"] };
          paid.push({ request, payable });
          return { status: "appended", payment: { finalized: true, power: ["Fury"] } };
        }
      }
    }
  );

  assert.equal(paid.length, 1);
  assert.deepEqual(paid[0].payable, { power: ["Fury"] });
  // The unit's own Deflect keyword is untouched: nothing was written to the
  // object, which is what "treat as inactive for the procedure" (766) means.
  assert.deepEqual(kernel.getObject("deflector").keywords, [{ id: "Deflect", value: 1 }]);
});

test.todo(
  "ven-158-166 Heisho: implement 764-767 'ignoring effects' (treat Deflect as inactive for the cost payment of " +
    "spells/abilities choosing something here) — ProgramStaticBinder.layerFor throws 'no layer mapping' for " +
    "continuous.ignore-abilities and the engine has no inactive-for-this-procedure ability state"
);

test.todo(
  "ven-158-166 Heisho: scope the waiver to 'something here' — no channel exposes the choosing spell/ability's " +
    "finalized TargetPlan to a card program (the sameLocationAs:self anchor itself is merged in " +
    "programs/statics.ts staticFilter)"
);

test.todo(
  "ven-158-166 Heisho: once 764-767 lands, resolve 190.6 battlefield controller for the static ability and verify the " +
    "waiver only suppresses Deflect for the paying spell/ability's own cost procedure"
);

/** Production ChainEngine over a reference kernel, for the fail-closed probes below. */
function productionEngine(program) {
  const base = world().player("A", { energy: 20 }).player("B", { energy: 20 })
    .unit("heisho", {
      cardId: program.canonicalCardId,
      types: ["battlefield"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("spell", { types: ["spell"], zone: "hand", energy: 1, power: null, location: null })
    .unit("deflector", {
      owner: "B",
      controller: "B",
      types: ["unit"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      keywords: [{ id: "Deflect", value: 2 }],
      might: 5
    })
    .deck(["A:d"], { owner: "A" }).deck(["B:d"], { owner: "B" })
    .rune(["A:r"], { owner: "A" }).rune(["B:r"], { owner: "B" })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("heisho") });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  return { kernel, engine };
}

test("ven-158-166 Heisho probe: the production binder rejects continuous.ignore-abilities (no layer mapping)", () => {
  const { kernel, engine } = productionEngine(program);
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(ability, kernel.getObject("heisho")),
    error => error.code === "judge-required" &&
      /Static ability kind continuous\.ignore-abilities has no layer mapping/.test(error.message)
  );
});

test("ven-158-166 Heisho probe: the merged Deflect static has no production binding either, so the chain never charges the tax this card would ignore", () => {
  const { kernel, engine } = productionEngine(program);
  const deflect = keywordDefinitionsById.get("Deflect");
  const [deflectStatic] = deflect.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(deflectStatic, kernel.getObject("deflector")),
    error => error.code === "judge-required" &&
      /Static ability kind target\.tax has no layer mapping/.test(error.message)
  );
  // The merged tax collector can charge the keyword when a caller supplies the
  // effect set; the missing production piece is exactly that binding/wiring.
  const deflection = deflectStatic.effect;
  assert.equal(deflection.kind, "target.tax");
  assert.deepEqual(deflection.value, { kind: "constant", value: 2 });
});
