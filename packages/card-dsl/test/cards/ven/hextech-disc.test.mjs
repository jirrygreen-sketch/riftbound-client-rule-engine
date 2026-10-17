import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/hextech-disc.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import tokenDefinition from "../../../../engine-core/dist/effects/instructions/effect.token.js";

const CARD_ID = "card.hash-ef829cc2fd46f6ca1486fc90e662a97b9fb324fa8a832165e80e9896ab89c6ad";
const SOURCE_TEXT =
  "[Empower] — :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)\n" +
  "Disempower this, :rb_energy_1:, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base.";

const [empower, activated] = program.abilities;
const [playMech] = activated.body;

const discWorld = () => world()
  .unit("hextech-disc", {
    types: ["gear"],
    might: null,
    energy: 4,
    power: ["Body"],
    zone: "board",
    location: { type: "base", player: "A" }
  })
  // The activation cost is 1 Energy + Disempower + exhaust; give the controller
  // the printed Energy in the Rune Pool so the merged half can actually settle.
  .player("A", { energy: 1 })
  .player("B", { energy: 0 })
  .build();

test("ven-087-166 Hextech Disc: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-087-166 Hextech Disc: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /Disempower/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-087-166 Hextech Disc: Empower keyword plus the Disempower/energy/exhaust activation", () => {
  assert.equal(program.abilities.length, 2);
  // 827.1.c: the printed Empower cost is exhausting the source; declared only.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });

  // 151.2 default action timing; the printed cost line is
  // "Disempower this, :rb_energy_1:, :rb_exhaust:".
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(activated.cost.payments, [
    { kind: "disempower", object: "self" },
    { kind: "exhaust", object: "self" }
  ]);
});

test("ven-087-166 Hextech Disc: the body plays the frozen 187.4 Mech definition to the controller's base", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(playMech.id, "hextech-disc.play-mech-token");
  assert.equal(playMech.op, "effect.token");
  assert.deepEqual(playMech.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(playMech.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played token is created on the Chain first.
  assert.deepEqual(playMech.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playMech.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.equal(playMech.targets, undefined);
  assert.equal(playMech.picks, undefined);
  assert.equal(playMech.linkedTo, undefined);
});

test("ven-087-166 Hextech Disc golden: effect.token really creates and plays a 3-Might Mech at the controller's base", () => {
  const kernel = discWorld();
  const run = runInstruction(
    tokenDefinition,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      // The declared symbolic "controller" base is bound to the acting player here.
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "mechToken" }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  const tokens = kernel.objects.filter((object) => object.isToken);
  assert.equal(tokens.length, 1);
  const [mech] = tokens;
  // 187.4: Mech unit token, Might 3, tag Mech, at the controller's base.
  assert.equal(mech.name, "Mech");
  assert.equal(mech.might, 3);
  assert.deepEqual(mech.tags, ["Mech"]);
  assert.deepEqual(mech.types, ["unit"]);
  assert.deepEqual(mech.location, { type: "base", player: "A" });
  assert.deepEqual(run.linked["mechToken.objects"], [mech.ref]);
  // The play handoff really happened (440.2.c / 185.2.a), not just a Board insert.
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
});

test("ven-087-166 Hextech Disc: the merge-able half of the cost (energy + exhaust) really settles", () => {
  const kernel = discWorld();
  const bound = kernel.clone({
    source: kernel.ref("hextech-disc"),
    sourceSnapshot: kernel.getObject("hextech-disc")
  });
  // 443.2.a's Disempower is still the missing payment kind; the merged cost plan
  // is exercised with the rest of the printed cost to show exactly what blocks.
  const plan = buildCostPlan(bound, {
    id: "cost:hextech-disc-merged-half",
    cost: { kind: "activated", energy: { kind: "constant", value: 1 }, payments: [{ kind: "exhaust", object: "self" }] }
  });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(bound, plan);
  assert.equal(receipt.paid, true);
  assert.equal(bound.getObject("hextech-disc").exhausted, true);
});

test.todo(
  "ven-087-166 Hextech Disc: [Empower] (exhaust the source, CR 827.1.c.1/415.5) needs an Empower/Empowered " +
    "KeywordDef — keywords/registry.generated.ts has no \"empower\"/\"empowered\" entry"
);
test.todo(
  "ven-087-166 Hextech Disc: paying \"Disempower this\" (CR 443.2/443.2.a) needs the disempower payment kind in " +
    "cost/plan-values.ts readCost, whose nonstandard kinds are only " +
    "exhaust/discard/recycle/kill/reveal/spend-buff"
);
test.todo(
  "ven-087-166 Hextech Disc: the production Chain-side receiver for a played token (440.2.c / 185.2.a) and the " +
    "card-program describePlay adapter are unmerged: routeAction requires a bound card program for play actions, " +
    "and a token has no cardId to bind; the reference kernel run above proves the token definition and play handoff only"
);
