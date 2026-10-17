import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/cull.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-bb1fcaa45b988af1dbf230e70a71fec0ff63d89d772cedb858639514745d573d";
const SOURCE_TEXT =
  "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** Cull as it sits on the Board; printed energy/power/might stay untouched. */
function cullWorld() {
  const base = world()
    .object("cull", {
      name: "Cull",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: null,
      might: 1
    })
    .unit("ally", { might: 2 })
    .unit("enemy-unit", { owner: "B" })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("cull") });
}

function expansionFor() {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  return definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL } });
}

test("sfd-134-221 Cull: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-134-221 Cull: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap and the real dependencies
  // (cards/README.md section 2).
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /Unsupported payment kind/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.doesNotMatch(program.judgeReason, /RIFT-261|RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-134-221 Cull: one valued Chaos Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Chaos");
});

test("sfd-134-221 Cull: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2: functionally "[Cost]: Attach this gear to a unit you control."
  const expansion = expansionFor();
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target limited to units you control.
  assert.deepEqual(ability.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("sfd-134-221 Cull golden: the merged Equip attach body attaches this Gear to a controlled Unit", () => {
  const kernel = cullWorld();
  const [expansion] = expansionFor();
  const run = runInstruction(
    attach,
    { host: expansion.body[0].args.host },
    { world: kernel, targets: { "equip-target": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("cull").attachedTo, kernel.ref("ally"));
  assert.deepEqual(run.events.map((event) => event.action), ["attach"]);
  // 150.2/150.4: printed Equipment characteristics are never coerced.
  assert.equal(kernel.getObject("cull").energy, 1);
  assert.equal(kernel.getObject("cull").power, null);
  assert.equal(kernel.getObject("cull").might, 1);
});

test("sfd-134-221 Cull golden: a controlled Unit that left the Board is ignored, not re-attached (CR 359.3.e.6)", () => {
  const kernel = cullWorld();
  const [expansion] = expansionFor();
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");

  const run = runInstruction(
    attach,
    { host: expansion.body[0].args.host },
    { world: kernel, targets: { "equip-target": [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("cull").attachedTo, null);
});

test.todo(
  "sfd-134-221 Cull: paying the printed Chaos Equip cost (818.1.b / 818.1.c.2) needs the " +
    "\"equip\" cost-payment kind in cost/plan-values.ts plus ExpandInput params.cost " +
    "(contract 3.8 item 3); expandProgram currently passes only { value, host }."
);
test.todo(
  "sfd-134-221 Cull: the programs/ activation path is merged, but its Finalize cost plan " +
    "cannot plan the expansion's \"equip\" payment until the payment kind exists."
);
