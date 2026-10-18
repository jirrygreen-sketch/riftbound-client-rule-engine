// RIFT-648 template execution evidence: ../templates/empty-648.test.mjs.
// The template rows play this Gear through the real chain and assert the
// printed-cost, target-restriction and Equip-payment boundaries; this file
// keeps validation, identity, the keyword structure and the merged
// effect.attach slice.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/hand-hammer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

/**
 * The reference kernel compares filter values literally, so the symbolic
 * "controller": "self" of 818.1.c.2 is bound to the acting player for the
 * reselection check (the same convention as ogn/master-yi-meditative and
 * ven/protective-sands).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

const CANONICAL =
  "card.hash-e38beb4c962c62133ef5050acc2896b4578a668939323e65af883d81c8ada753";
const SOURCE_TEXT =
  "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The merged Equip expansion for this card's printed value (818.1.c.2). */
function expansionFor() {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  return definition.expand({
    value: equip.value,
    host: { canonicalCardId: CANONICAL }
  });
}

/** The Gear on the Board plus one controlled unit and one enemy unit. */
function equipWorld() {
  const base = world()
    .unit("hand-hammer", {
      types: ["gear"],
      tags: ["Equipment"],
      energy: 2,
      power: null,
      might: 1,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 3 })
    .unit("enemy-unit", { owner: "B" })
    .build();
  return base.clone({
    source: base.ref("hand-hammer"),
    sourceSnapshot: base.getObject("hand-hammer")
  });
}

test("ven-027-166 Hand Hammer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-027-166 Hand Hammer: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /818\.1\.c/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /ChainContractBlockedError/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-027-166 Hand Hammer: one valued Calm Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip [Calm]": one resource symbol, the Calm Power rune.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Calm");
});

test("ven-027-166 Hand Hammer: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  const expansion = expansionFor();
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues));

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["equip"]);
  // 818.1.b.1: the attachment choice is a Target limited to friendly units.
  assert.deepEqual(ability.body[0].targets, [
    {
      id: "equip-target",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-027-166 Hand Hammer golden: the merged Equip body attaches this Gear to a controlled Unit", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();
  const run = runInstruction(
    attach,
    { host: expansion.body[0].args.host },
    { world: kernel, targets: { "equip-target": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("hand-hammer").attachedTo, kernel.ref("ally"));
  assert.deepEqual(run.events.map((event) => event.action), ["attach"]);
  // 150.2/150.4: the printed Equipment characteristics stay as printed.
  assert.equal(kernel.getObject("hand-hammer").energy, 2);
  assert.equal(kernel.getObject("hand-hammer").power, null);
  assert.equal(kernel.getObject("hand-hammer").might, 1);
});

test("ven-027-166 Hand Hammer golden: with no controlled unit the Equip target reselects to nothing (818.1.c.2)", () => {
  // 818.1.c.2 prints "a unit you control" as a Target restriction, so an
  // opponent's unit can never satisfy it. The real interpreter issues the
  // per-spec target query from the declared filter; only a controlled unit is
  // ever a candidate.
  const base = world()
    .unit("hand-hammer", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("enemy-unit", { owner: "B" })
    .build();
  const kernel = base.clone({
    source: base.ref("hand-hammer"),
    sourceSnapshot: base.getObject("hand-hammer")
  });
  const [expansion] = expansionFor();
  const [instruction] = expansion.body;
  const body = [
    {
      ...instruction,
      targets: instruction.targets.map(target => substituteController(target, "A"))
    }
  ];

  const outcome = runAbilityBody(body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["equip-attach", "ignored"]
  ]);
  assert.equal(kernel.getObject("hand-hammer").attachedTo, null);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "ven-027-166 Hand Hammer: paying the printed Equip cost (1 Calm Power, CR 818.1.c) needs the \"equip\" " +
    "payment kind in cost/plan-values.ts and the contract 3.8.3 params.cost passthrough from the card program " +
    "through expandProgram (the interface declares it, the expander does not forward it)"
);
test.todo(
  "ven-027-166 Hand Hammer: the card-program -> keyword expansion -> chain activation wiring (contract 3.5) " +
    "is merged: ProgramBinding + ChainEngine.describeActivate registers the Equip activated ability and returns " +
    "the cost draft; the whole card stays judge-required only because chain.execute blocks on the \"equip\" " +
    "payment kind (ChainContractBlockedError)"
);
