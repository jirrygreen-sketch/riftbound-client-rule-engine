import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/veteran-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CARD_ID = "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7";

const production = { ...program, status: "executable", judgeReason: undefined };

const veteranPoroBoard = ({ equip = false } = {}) => w => {
  let table = w
    .player("A", { energy: 20, power: ["Body"] })
    .player("B", { energy: 20, power: ["Body"] })
    .unit("poro", {
      owner: "A", controller: "A", cardId: CARD_ID, name: "Veteran Poro",
      types: ["unit"], tags: ["Poro"], zone: "hand", location: null,
      energy: 2, power: [], might: 2
    });
  if (equip) table = table.object("sword", {
    owner: "A", controller: "A", cardId: "card:long-sword", name: "Long Sword",
    types: ["gear"], tags: ["Equipment"], zone: "board",
    location: { type: "base", player: "A" }, energy: null, power: null, might: null
  });
  return table;
};

const weaponmasterExpansion = () => {
  const definition = keywordDefinitionsById.get("Weaponmaster");
  assert.ok(definition, "effects/keywords/Weaponmaster.ts must be registered");
  return definition.expand({ host: { canonicalCardId: CARD_ID } });
};

test("sfd-099-221 Veteran Poro: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The blocker is authoritative Equip cost and symbol provenance.
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /821\.1/);
  assert.match(program.judgeReason, /\[A\]\/\[C\]/);
  assert.match(program.judgeReason, /reduce-equip-cost/);
  assert.equal(
    program.sourceText,
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
  );
});

test("sfd-099-221 Veteran Poro: exactly one unvalued Weaponmaster keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "weaponmaster");
  assert.equal(ability.value, undefined);
});

test("sfd-099-221 Veteran Poro: the merged Weaponmaster expansion is structurally valid EffectIR", () => {
  // The merged Weaponmaster expansion renders 821.1.c as a play trigger whose body
  // pays the chosen Equipment's reduced Equip cost before attaching.
  const [ability] = weaponmasterExpansion();
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  const [choice] = ability.body;
  assert.equal(choice.op, "sequence");
  assert.deepEqual(choice.targets, [
    {
      id: "weaponmaster-equipment",
      filter: { type: "gear", controller: "self", tags: ["Equipment"] },
      min: 0,
      max: 1,
      selection: "up-to"
    }
  ]);
  assert.deepEqual(choice.args.body.value.map((instruction) => instruction.op), [
    "cost.modify",
    "cost.pay",
    "effect.attach"
  ]);
});

test("sfd-099-221 Veteran Poro: selecting no Equipment skips the whole cost/attach sequence", () => {
  // The expansion's own guard: with no Equipment chosen the body is a skipped
  // negation, so nothing is paid and nothing is attached. This executes on the
  // merged interpreter and proves the authored shape is well-formed.
  const [ability] = weaponmasterExpansion();
  const kernel = world().object("gear", { types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" } }).build();
  kernel.setTargets("weaponmaster-equipment", []);
  const outcome = runAbilityBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["weaponmaster-choice"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
});

test("sfd-099-221 Veteran Poro: the chosen Equipment's Equip cost still fails closed without an authoritative binding (821.1.c.2)", () => {
  // The merged cost.modify source branch resolves the exact selected Equipment
  // and then raises judge-required because ObjectSnapshot carries play costs and
  // keyword names, never the Equip ability's cost or original [A]/[C] symbols.
  const [ability] = weaponmasterExpansion();
  const kernel = world()
    .player("A", { energy: 20, power: ["Fury"] })
    .object("gear-host", { types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 3 })
    .object("sword", { types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const sword = kernel.ref("sword");
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("gear-host"),
    controller: "A",
    targets: new Map([["weaponmaster-equipment", [sword]]])
  });
  const [sequence] = ability.body;
  const [costInstruction] = sequence.args.body.value;
  assert.throws(
    () => runAbilityBody([costInstruction], context, undefined, { targets: { "weaponmaster-equipment": [sword] } }),
    (error) => /821\.1\.c\.2: missing authoritative Equip-cost binding/.test(String(error.message))
  );
  // No payment and no attachment may happen while that binding is missing.
  assert.equal(kernel.player("A").energy, 20);
  assert.equal(kernel.getObject("sword").attachedTo, null);
});

test("sfd-099-221 Veteran Poro: reduce-equip-cost still refuses six-domain Power as original [A]/[C] provenance (821.1.c.3)", () => {
  // A six-domain Power requirement does not preserve whether the printed Equip
  // cost used the original [A] symbol. Treating it as [A] would turn a printed
  // [C] into a discountable symbol, so the primitive fails closed.
  const [ability] = weaponmasterExpansion();
  const [sequence] = ability.body;
  const [costInstruction] = sequence.args.body.value;
  const modifier = costInstruction.args.modifier.value;
  const kernel = world()
    .player("A", { energy: 20, power: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] })
    .object("gear-host", { types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 3 })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("gear-host"),
    controller: "A"
  });
  assert.throws(() => runInstruction(costModify, {
    id: costInstruction.id,
    cost: {
      kind: "explicit",
      payments: [{
        kind: "power",
        amount: { kind: "constant", value: modifier.amount },
        allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
      }]
    },
    modifier
  }, { world: context }), /821\.1\.c\.3: Equip discounts require original \[A\] symbols/);
  assert.equal(context.linked("cost"), undefined, "a failed profile does not publish a cost plan");
});

test("sfd-099-221 Veteran Poro production: declining the optional Equipment leaves it unattached", () => {
  // This uses the registry program through createProgramBinding and a real
  // ChainEngine. The real card-played event registers Weaponmaster; the empty
  // up-to-one choice skips cost and attachment without a second prompt.
  const f = productionPlay({
    programs: [production],
    answers: { "target:weaponmaster-equipment": [] },
    build: veteranPoroBoard({ equip: true })
  });
  const draft = f.play("poro");
  assert.equal(draft.speed, "normal");
  assert.equal(f.kernel.player("A").energy, 18, "only Veteran Poro's printed 2 Energy is paid");
  assert.equal(f.kernel.getObject("poro").zone, "board");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(f.engine.items, []);
  assert.deepEqual(f.targetRequests().map(request => request.id), ["target:weaponmaster-equipment"]);
  assert.deepEqual(f.targetRequests()[0].options, [f.kernel.ref("sword")]);
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "card-played" && event.object.ref.id === "poro").length,
    1
  );
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-attached"), false);
});

test("sfd-099-221 Veteran Poro production: an opponent's Equipment is not a legal choice (821.1.c)", () => {
  const f = productionPlay({
    programs: [production],
    build: w => w.player("A", { energy: 20, power: ["Body"] })
      .player("B", { energy: 20, power: ["Body"] })
      .unit("poro", {
        owner: "A", controller: "A", cardId: CARD_ID, name: "Veteran Poro",
        types: ["unit"], tags: ["Poro"], zone: "hand", location: null,
        energy: 2, power: [], might: 2
      })
      .object("enemy-sword", {
        owner: "B", controller: "B", cardId: "card:long-sword", name: "Long Sword",
        types: ["gear"], tags: ["Equipment"], zone: "board",
        location: { type: "base", player: "B" }, energy: null, power: null, might: null
      })
  });
  f.play("poro");
  assert.equal(f.kernel.player("A").energy, 18);
  assert.equal(f.kernel.getObject("poro").zone, "board");
  assert.equal(f.kernel.getObject("enemy-sword").attachedTo, null);
  assert.deepEqual(f.targetRequests().map(request => ({ min: request.min, options: request.options })), [
    { min: 0, options: [] }
  ]);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-attached"), false);
});

test("sfd-099-221 Veteran Poro production: a selected Equipment fails closed without paying or attaching (821.1.c.2)", () => {
  // The production Finalize path really locks the selected Equipment before
  // resolution. The trigger then reaches cost.modify and stops on the current
  // engine gap; Poro itself has already been played and only its own cost paid.
  const f = productionPlay({
    programs: [production],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: veteranPoroBoard({ equip: true })
  });
  assert.throws(
    () => f.play("poro"),
    /821\.1\.c\.2: missing authoritative Equip-cost binding for sword; original \[A\]\/\[C\] symbols required/
  );
  assert.equal(f.kernel.player("A").energy, 18, "the failed Weaponmaster trigger pays no play or Equip cost");
  assert.equal(f.kernel.getObject("poro").zone, "board");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.getObject("sword").zone, "board");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-played" && event.object.ref.id === "poro").length, 1);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-attached"), false);
  assert.deepEqual(f.targetRequests().map(request => ({ id: request.id, options: request.options })), [
    { id: "target:weaponmaster-equipment", options: [f.kernel.ref("sword")] }
  ]);
});
