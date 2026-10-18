import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/veteran-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry, createEngineStaticBinder, describePlay } from "../../../../engine-core/dist/programs/index.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7";

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

test("sfd-099-221 Veteran Poro: the chosen Equipment's Equip cost still fails closed without an authoritative binding (821.1.c.2/.3)", () => {
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

test("sfd-099-221 Veteran Poro: the chain adapter cannot yet decode the expanded cost.modify body", () => {
  // Measured against chain/interpreter-adapter.ts: LITERAL_FIELDS has no entry
  // for cost.modify, so the expansion's constant-wrapped modifier reaches the
  // primitive's schema unchanged and the chain body cannot execute.
  const [ability] = weaponmasterExpansion();
  const [sequence] = ability.body;
  const [costInstruction] = sequence.args.body.value;
  const f = fixture();
  assert.throws(() => resolveChainBody([costInstruction], f.kernel), /Invalid cost\.modify modifier argument: value/);
});

test("sfd-099-221 Veteran Poro: the expanded card-played trigger registers and locks the chosen Equipment on a real play", () => {
  // The previously-recorded "match the played object" gap is closed: the
  // production lifecycle registers the keyword expansion's trigger, the real
  // play emits card-played with matching object/source, and Finalize locks the
  // selected Equipment. The cost half still fails closed, so resolution is
  // asserted to stop on the missing Equip binding rather than to attach.
  const live = { ...program, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([live]);
  const f = fixture({ describePlay: (action, source) => describePlay(registry, action, source) });
  attachProgramLifecycle(f.engine, registry, createEngineStaticBinder(f.engine));

  const base = f.kernel.getObject("source");
  f.kernel.addObject({
    ...base, ref: { id: "poro", zoneEntryId: 1 }, cardId: CARD_ID, name: "Veteran Poro",
    types: ["unit"], tags: ["Poro"], zone: "hand", location: null, energy: 2, power: [], might: 3
  });
  f.kernel.addObject({
    ...base, ref: { id: "sword", zoneEntryId: 1 }, cardId: null, name: "Long Sword",
    types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
    energy: null, power: null, might: null
  });
  const sword = f.kernel.ref("sword");
  f.answers.set("target:weaponmaster-equipment", [sword]);

  assert.equal(f.engine.commit({ type: "play", object: f.kernel.ref("poro"), player: "A" }).status, "done");
  f.engine.advance();
  const played = f.engine.pipeline.events.filter((event) => event.timingPoint === "card-played");
  assert.equal(played.length, 1);
  assert.equal(played[0].object.ref.id, "poro");
  assert.equal(played[0].object.cardId, CARD_ID);
  assert.equal(played[0].source.ref.id, "poro");
  const triggers = [...f.engine.pipeline["triggers"].keys()].filter((id) => id.startsWith("program:poro"));
  assert.ok(triggers.length > 0, "the keyword expansion's card-played trigger must be registered for the played unit");
  // One triggered chain item is installed from the real event; its locked pick
  // is the Equipment chosen through the scenario answer above.
  const item = f.engine.items.find((entry) => entry.kind === "triggered");
  assert.ok(item, "the card-played trigger must have produced a chain item");
  // Resolution stops on the un-decoded cost.modify body above; whatever the
  // failure, no Equipment cost may be paid and nothing may become attached.
  assert.throws(() => { while (f.engine.items.length) f.engine.pass(f.engine.priority); },
    /Invalid cost\.modify modifier argument: value/);
  assert.equal(f.kernel.player("A").energy, 20 - 2, "only the printed play cost may have been paid");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
});
