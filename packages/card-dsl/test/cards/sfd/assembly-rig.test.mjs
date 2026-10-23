import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import tokenDefinition from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/sfd/assembly-rig.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569.
// The activated ability is Pending. Its printed cost combines 151.2/357.1 resources, the 417.3 recycle
// cost, and the 415.4 source Exhaust. Finalize locks the trash Unit, computes
// and pays the total, then the permanent is a Finalized Chain Item; 337.1.a
// does not pass Priority, 337.4/338.1 grants the response window, and 359.3.d
// resolves the body only after both passes. The body uses the 187.4 Mech token
// through a 440.2/440.2.c Play, entering exhausted under 143.4/185.2.d.
// The activation creates no Focus outside a Showdown, and its recycle cost reads
// the exact selected trash incarnation. The resolved token is a new object;
// the body consumes no departed-object LKI.

test("Assembly Rig card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base.");
});

test("Assembly Rig has one action-speed activated ability with the printed three-part cost", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(ability.cost.power, { kind: "constant", value: ["Fury"] });
  const payments = ability.cost.payments;
  assert.equal(payments.length, 2);
  const [recyclePayment, exhaustPayment] = payments;
  assert.equal(recyclePayment.kind, "recycle");
  assert.equal(exhaustPayment.kind, "exhaust");
  assert.deepEqual(recyclePayment.choice, {
    id: "recycled-unit",
    options: ["unit-in-controller-trash"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "trash",
    type: "unit",
    owner: "controller"
  });
});

test("Assembly Rig body is one effect.token instruction creating a Mech at the controller base", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  assert.deepEqual(instruction.args.locations.value, [{ type: "base", player: "controller" }]);
  assert.equal(instruction.args.choiceId.value, "token-base");
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("Assembly Rig body executes through the reference kernel: a 3 Might Mech token lands in the controller base", () => {
  const kernel = world()
    .hand("assembly-rig", { name: "Assembly Rig", types: ["gear"], tags: ["Equipment"], energy: null, power: null })
    .build();
  const base = { type: "base", player: "A" };
  const [instruction] = program.abilities[0].body;
  // The reference kernel evaluates Expr args itself; substitute the printed
  // controller-base placeholder with the concrete player base.
  const args = {
    ...instruction.args,
    locations: { kind: "constant", value: [base] }
  };
  const run = runInstruction(tokenDefinition, args, { world: kernel });
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  const [tokenRef] = run.linked["token.objects"];
  assert.deepEqual(tokenRef, created[0].ref);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].tags, ["Mech"]);
  assert.deepEqual(created[0].location, base);
  assert.equal(created[0].owner, "A");
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.deepEqual(run.events.map(event => event.action), ["create-token"]);
});

test("sfd-019-221 Assembly Rig production golden: Finalize pays Energy, Fury Power, recycle and Exhaust, then Resolve creates one exhausted Mech", () => {
  const f = productionPlay({
    programs: [program],
    answers: { "recycled-unit": ["fodder"] },
    build: w => w
      .player("A", { energy: 1, power: ["Fury"] })
      .player("B")
      .object("rig", {
        owner: "A", controller: "A", cardId: program.canonicalCardId,
        types: ["gear"], zone: "board", location: { type: "base", player: "A" },
        energy: 4, power: null, might: null
      })
      .card("fodder", {
        owner: "A", types: ["unit"], tags: ["Mech"], zone: "trash",
        energy: 2, power: null, might: 2
      })
  });

  const draft = f.binding.describeActivate(f.kernel.getObject("rig"), "A", 0);
  assert.equal(draft.speed, "action");
  f.engine.execute(draft);
  const [item] = f.engine.items;
  assert.equal(item.status, "finalized");
  assert.equal(f.engine.priority, "A");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.getObject("fodder").location, null);
  assert.equal(f.kernel.getObject("fodder").zone, "deck");
  assert.equal(f.kernel.getObject("rig").exhausted, true);
  assert.deepEqual(f.kernel.events.map(event => event.action), ["pay", "recycle", "exhaust"]);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0,
    "Finalize pays the complete cost before the body is resolved");

  f.engine.pass("A");
  assert.equal(f.engine.priority, "B");
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
  f.engine.pass("B");
  assert.deepEqual(f.engine.items, []);

  const tokens = f.kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Mech");
  assert.equal(tokens[0].might, 3);
  assert.deepEqual(tokens[0].tags, ["Mech"]);
  assert.equal(tokens[0].controller, "A");
  assert.deepEqual(tokens[0].location, { type: "base", player: "A" });
  assert.equal(tokens[0].exhausted, true);
  assert.equal(tokens[0].energy, null);
  assert.equal(tokens[0].power, null);
  assert.equal(f.engine.trace.filter(entry => entry.item === item.id &&
    ["pending", "finalized", "resolved"].includes(entry.step)).map(entry => entry.step).join(","),
  "pending,finalized,resolved");
  const resolvedAt = f.engine.pipeline.events.findIndex(event =>
    event.timingPoint === "chain-item-resolve" && event.details?.item === item.id);
  const boardEntryAt = f.engine.pipeline.events.findIndex(event =>
    event.timingPoint === "object-enters-board" && event.object?.ref.id === tokens[0].ref.id);
  assert.ok(boardEntryAt >= 0 && boardEntryAt < resolvedAt,
    "the token body performs its Board action during the activation's Resolve");
});
