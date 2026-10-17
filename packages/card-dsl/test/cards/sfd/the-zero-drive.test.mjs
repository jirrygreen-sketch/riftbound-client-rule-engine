import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/the-zero-drive.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-91fa755a4f2e1cf5d93c1792c1f0be8e6c8af0d26bda9b82049276b62ce94102";
const SOURCE_TEXT =
  "[Equip] :rb_energy_1::rb_rune_mind: (:rb_energy_1::rb_rune_mind:: Attach this to a unit you control.)\n" +
  ":rb_energy_3::rb_rune_mind:, Banish this: Play all units banished with this, ignoring their costs. (Use only if unattached.)";

const PICK_ID = "the-zero-drive.banished-units";
const PLAY_ID = "the-zero-drive.play-banished-units";

const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      key === "controller" && value === "self" ? kernel.controller : value
    ])),
    object
  ))
});

const [equip, activated] = program.abilities;
const playInstruction = activated.body[0];

const zeroDriveWorld = () => world()
  .unit("the-zero-drive", {
    types: ["gear"],
    might: 2,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .unit("ally", { might: 3 })
  .unit("banished-a", { might: 2, zone: "banishment" })
  .unit("banished-b", { might: 4, zone: "banishment" })
  .build();

test("sfd-090-221 The Zero Drive: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-090-221 The Zero Drive: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name every real gap and the data note.
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /banish-as-cost/);
  assert.match(program.judgeReason, /394.*398/);
  assert.match(program.judgeReason, /use-only-if-unattached|Use only if unattached/);
  assert.match(program.judgeReason, /Deathknell/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-090-221 The Zero Drive: Equip declaration plus the linked-play activated ability", () => {
  assert.equal(program.abilities.length, 2);

  // Printed "Equip [1][Mind]": two resource symbols (1 Energy + 1 Mind Power).
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 2);
  assert.equal(equip.costDomain, "Mind");

  // 377.1: "[3][Mind], Banish this:" is an Activated Ability with both a
  // resource cost and a banish-as-cost payment.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 3 });
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["Mind"] });
  assert.deepEqual(activated.cost.payments, [{ kind: "banish", object: "self" }]);
  assert.deepEqual(activated.restriction, { kind: "use-only-if-unattached" });

  // 420.3/356.1.b.1: a Limited Play Effect with the finalized zero-cost plan and
  // a non-target pick of the units banished with this source (394-398).
  assert.equal(activated.body.length, 1);
  assert.equal(playInstruction.id, PLAY_ID);
  assert.equal(playInstruction.op, "effect.play");
  assert.deepEqual(playInstruction.args.pick, { kind: "constant", value: PICK_ID });
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [] }
  });
  assert.deepEqual(playInstruction.args.linkKey, { kind: "constant", value: "played" });
  assert.equal(playInstruction.targets, undefined);
  assert.equal(playInstruction.picks.length, 1);
  assert.equal(playInstruction.picks[0].id, PICK_ID);
  assert.equal(playInstruction.picks[0].selection, "all");
});

test("sfd-090-221 The Zero Drive: the merged Equip body attaches the gear to the chosen controlled unit", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });

  const kernel = zeroDriveWorld();
  // Bind the resolver source to the live gear instance (the builder's default
  // source may be a different object ordering).
  const bound = kernel.clone({
    source: kernel.ref("the-zero-drive"),
    sourceSnapshot: kernel.getObject("the-zero-drive")
  });
  bound.setTargets("equip-target", [bound.ref("ally")]);
  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("the-zero-drive")],
    host: bound.ref("ally")
  });
  assert.deepEqual(bound.getObject("the-zero-drive").attachedTo, bound.ref("ally"));
});

test("sfd-090-221 The Zero Drive: the linked play moves every picked banished unit to the board", () => {
  const kernel = zeroDriveWorld();
  kernel.setPicks(PICK_ID, [kernel.ref("banished-a"), kernel.ref("banished-b")]);

  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "executed");
  const [playResult] = outcome.results;
  assert.equal(playResult.id, PLAY_ID);
  assert.equal(playResult.result.status, "executed");
  assert.equal(playResult.result.linkedValues.played, 2);
  assert.equal(kernel.getObject("banished-a").zone, "board");
  assert.equal(kernel.getObject("banished-b").zone, "board");
  assert.equal(kernel.objectsInZone("A", "banishment").length, 0);
  assert.equal(kernel.events.filter((event) => event.action === "play").length, 2);
});

test("sfd-090-221 The Zero Drive: with no eligible banished unit the play does nothing and resolution continues", () => {
  // CR 420.3.c: no eligible card to play → nothing happens.
  const kernel = zeroDriveWorld();
  const outcome = resolveChainBody(activated.body, kernel);
  const [playResult] = outcome.results;
  assert.deepEqual(playResult.result, { status: "ignored", reason: "mistargeted" });
  // Board already holds the gear and the friendly unit before the play; the
  // empty pick leaves both banished units where they were.
  assert.equal(kernel.objectsInZone("A", "board").length, 2);
  assert.equal(kernel.getObject("banished-a").zone, "banishment");
});

test("sfd-090-221 The Zero Drive: the merged program binding consumes the Gear's keyword expansion and activated ability", () => {
  // The binding exposes both the keyword expansion and the activated ability;
  // payment and linked-scope gaps are documented by the program reason.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = {
    ref: { id: "the-zero-drive", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "The Zero Drive",
    types: ["gear"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 2,
    energy: 3,
    power: ["Mind"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const inspected = binding.inspect(source);
  assert.equal(inspected.abilities.some((entry) => entry.kind === "activated"), true);
  assert.equal(inspected.abilities.some((entry) => entry.kind === "keyword"), true);
});

test.todo(
  "sfd-090-221 The Zero Drive: production Linked Ability tracking must supply the units banished with this source to the " +
    "all-units play pick, and each ignored-cost play must receive its finalized zero-cost plan"
);

test.todo(
  "sfd-090-221 The Zero Drive: the declared Use only if unattached restriction must be consumed by activated-ability " +
    "legality before the Banish-this cost is attempted"
);
