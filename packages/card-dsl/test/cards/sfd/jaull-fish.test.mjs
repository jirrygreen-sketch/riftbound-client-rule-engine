import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/jaull-fish.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";

const CARD_ID = "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732";

const snapshot = () => ({
  ref: { id: "jaull", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Jaull-Fish",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "base", player: "A" },
  might: 3,
  energy: 2,
  power: [],
  exhausted: true,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /mightGte/);
  assert.match(program.judgeReason, /programs\/play\.ts:150-153/);
  assert.match(program.judgeReason, /chain\/engine\.ts:876/);
  assert.match(program.judgeReason, /cost\/discounts\/values\.ts:48-92/);
  assert.match(program.judgeReason, /ReplacementRegistration\.matches\/apply/);
  assert.doesNotMatch(program.judgeReason, /bindProgramCost/);
  assert.doesNotMatch(program.judgeReason, /没有调用/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /805\.2\.b/);
  assert.ok(program.sourceText.includes("[Accelerate]"));
  assert.ok(program.sourceText.includes("cost :rb_energy_2: less for each of your [Mighty] units"));
});

test("abilities: exactly one unvalued Accelerate keyword ability", () => {
  assert.equal(program.abilities.length, 2);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "accelerate");
  assert.equal(ability.value, undefined);
});

test("the Mighty discount keeps the full count expression and fails closed at the cost predicate gap", () => {
  const discount = program.abilities[1];
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.effect.appliesTo, "self");
  assert.deepEqual(discount.effect.amount, {
    kind: "arithmetic",
    operator: "multiply",
    operands: [
      { kind: "constant", value: 2 },
      {
        kind: "count",
        subject: "units",
        filter: { type: "unit", controller: "self", zone: "board", mightGte: 5 }
      }
    ]
  });

});

test("the merged Accelerate expansion resolves the declared keyword into cost + enter-ready abilities", () => {
  // 805.1/805.1.b: the optional additional cost [1][C]; 805.6: paying it replaces
  // the exhausted entry with a ready entry. The expansion is owned by
  // effects/keywords/Accelerate.ts and resolved by expandProgram —
  // the card only declares the keyword (contract 3.7).
  const expanded = expandProgram(program, snapshot());
  assert.deepEqual(expanded.expanded.map((ability) => ability.kind), ["static", "replacement"]);
  assert.equal(expanded.expanded[0].effect.kind, "accelerate.cost");
  assert.equal(expanded.expanded[0].effect.appliesTo, "self");
  assert.equal(expanded.expanded[1].replaces.event, "object-enters-board");
  assert.deepEqual(expanded.expanded[1].with.map((instruction) => instruction.op), ["effect.ready"]);
});

test("production: the judge-required program refuses to describe a play without charging or moving the card", () => {
  const f = productionPlay({
    programs: [program],
    build: w => w.player("A", { energy: 20, power: ["Body", "Body", "Body"] })
      .player("B")
      .hand("jaull", { cardId: CARD_ID, types: ["unit"], energy: 7, power: ["Body"], might: 6 })
  });
  const source = f.kernel.getObject("jaull");
  assert.throws(
    () => f.binding.describePlay({ type: "play", object: source.ref, player: "A" }, source),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      /continuous\.cost-modification/.test(error.message)
  );
  assert.equal(source.zone, "hand");
  assert.equal(f.kernel.player("A").energy, 20);
  assert.deepEqual(f.kernel.player("A").power, ["Body", "Body", "Body"]);
  assert.equal(f.engine.items.length, 0);
});

test("golden: the expanded enter-ready replacement really readies the entering unit", () => {
  // 805.6: the paid replacement makes the unit enter ready instead of exhausted.
  const expansion = expandProgram(program, snapshot()).expanded.find((ability) => ability.kind === "replacement");
  const kernel = world()
    .unit("jaull", { cardId: CARD_ID, types: ["unit"], exhausted: true, location: { type: "base", player: "A" } })
    .build();
  const context = kernel.clone({ source: kernel.ref("jaull"), sourceSnapshot: kernel.getObject("jaull"), controller: "A" });
  const outcome = resolveChainBody(expansion.with, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [["accelerate.enter-ready", "executed"]]);
  assert.equal(context.getObject("jaull").exhausted, false);
});

const admitted = { ...program, status: "executable", judgeReason: undefined };
const accelerateOnly = { ...admitted, abilities: [program.abilities[0]] };
const printed = {
  id: "sfd-103-221",
  cardType: "Unit",
  domains: ["Body"],
  energy: 7,
  power: 2
};

function accelerateScene(selected, { programs = [accelerateOnly] } = {}) {
  const f = productionPlay({
    programs,
    answers: { "cost:play": () => selected },
    build: w => w.player("A", { energy: 20, power: ["Body", "Body", "Body"] })
      .player("B", { energy: 0 })
      .hand("jaull", {
        cardId: CARD_ID,
        name: "Jaull-Fish",
        types: ["unit"],
        energy: 7,
        // ObjectSnapshot.power is the distinct Domain set. The numeric
        // printed Power amount is supplied by the trusted catalog projection below.
        power: ["Body"],
        might: 6
      })
      .unit("friendly-four", { owner: "A", controller: "A", might: 4 })
      .unit("mighty", { owner: "A", controller: "A", might: 5 })
      .unit("enemy-mighty", { owner: "B", controller: "B", might: 8 })
  });
  const source = f.kernel.getObject("jaull");
  const described = f.binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  const draft = { ...described, cost: { ...described.cost, printed } };
  let finalized = null;
  const originalOnEvent = f.engine.pipeline.onEvent;
  f.engine.pipeline.onEvent = event => {
    originalOnEvent?.(event);
    if (event.timingPoint === "chain-item-finalize") {
      const item = f.engine.items[0];
      finalized = item ? structuredClone({ plan: item.costPlan, receipt: item.payment }) : null;
    }
  };
  f.engine.execute(draft);
  f.settle();
  return { f, described, draft, finalized: () => finalized };
}

test("production: declining Accelerate pays only the printed cost and records the declined decision", () => {
  const { f, draft, finalized } = accelerateScene(false);
  assert.equal(Object.hasOwn(draft.cost, "discounts"), false,
    "the Accelerate-only view has no static cost modification");
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  assert.equal(f.kernel.player("A").energy, 13);
  assert.deepEqual(f.kernel.player("A").power, ["Body"]);
  const final = finalized();
  assert.ok(final);
  assert.deepEqual(final.plan.selectedAdditional, []);
  assert.equal(final.plan.declinedAdditional.length, 1);
  assert.deepEqual(final.plan.total, {
    energy: 7,
    power: [{ amount: 2, allowedDomains: ["Body"] }],
    xp: 0,
    actions: []
  });
  assert.deepEqual(final.plan.discounts, [],
    "the Accelerate-only view records no static discount");
  assert.equal(f.kernel.getObject("jaull").zone, "board");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
});

test("production: paying Accelerate adds [1][Body] and enters ready with the two Power base intact", () => {
  const { f, finalized } = accelerateScene(true);
  assert.equal(f.kernel.player("A").energy, 12);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("jaull").exhausted, false);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0,
    "805.6.a: the direct ready entry does not emit an object-readied transition");
  const final = finalized();
  assert.ok(final);
  assert.equal(final.plan.selectedAdditional.length, 1);
  assert.equal(final.plan.selectedAdditional[0].kind, "accelerate");
  assert.deepEqual(final.plan.declinedAdditional, []);
  assert.equal(final.plan.total.energy, 8);
  assert.deepEqual(final.plan.total.power, [
    { amount: 2, allowedDomains: ["Body"] },
    { amount: 1, allowedDomains: ["Body"] }
  ]);
  assert.deepEqual(final.plan.discounts, [],
    "the Accelerate-only view records no static discount");
});

test("production: the executable view reaches Finalize with its own discount and then blocks fail-closed", () => {
  const f = productionPlay({
    programs: [admitted],
    answers: { "cost:play": () => false },
    build: w => w.player("A", { energy: 10 })
      .object("jaull-board", {
        cardId: CARD_ID,
        name: "Jaull-Fish",
        owner: "A",
        controller: "A",
        types: ["unit"],
        zone: "board",
        location: { type: "base", player: "A" },
        energy: 7,
        power: ["Body"],
        might: 6,
        exhausted: false
      })
      .unit("mighty", { owner: "A", controller: "A", might: 5 })
  });
  const source = f.kernel.getObject("jaull-board");
  const described = f.binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.ok(described.costStatics?.some(entry =>
    entry.ability.effect.kind === "continuous.cost-modification"));
  assert.throws(
    () => f.engine.execute(described),
    error => error?.message === "Unsupported cost filter field mightGte"
  );
  assert.equal(f.kernel.getObject("jaull-board").zone, "board");
  assert.equal(f.kernel.player("A").energy, 10);
  assert.equal(f.engine.items.length, 0);
});
