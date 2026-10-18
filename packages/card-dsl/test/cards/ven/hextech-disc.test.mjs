import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/hextech-disc.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
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
  assert.match(program.judgeReason, /Unsupported cost kind empower/);
  assert.match(program.judgeReason, /Unsupported payment kind: disempower/);
  assert.match(program.judgeReason, /card-program adapter/);
  assert.doesNotMatch(program.judgeReason, /没有 \"empower\"\/\"empowered\" 展开的 KeywordDef/);
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

test("ven-087-166 Hextech Disc probe: the merged Empower expansion loses the printed exhaust cost", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world().player("A").player("B")
    .unit("hextech-disc", {
      cardId: CARD_ID,
      types: ["gear"],
      might: null,
      energy: 4,
      power: ["Body"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const expanded = binding.inspect(kernel.getObject("hextech-disc")).abilities.filter(a => a.kind === "activated");
  assert.equal(expanded.length, 2, "declared activation + merged Empower expansion");
  const empowered = expanded.at(-1);
  // 827.1.c: the printed cost is exhausting the source, but the expansion has
  // no carrier for it: KeywordAbility has no params field.
  assert.deepEqual(empowered.cost, { kind: "empower" });
  assert.throws(
    () => binding.describeActivate(kernel.getObject("hextech-disc"), "A", 1),
    error => error.code === "judge-required" && /Unsupported cost kind empower/.test(error.message)
  );
});

test("ven-087-166 Hextech Disc probe: the printed Disempower payment is rejected by the merged cost plan", () => {
  const kernel = discWorld();
  const bound = kernel.clone({ source: kernel.ref("hextech-disc"), sourceSnapshot: kernel.getObject("hextech-disc") });
  assert.throws(
    () => buildCostPlan(bound, { id: "cost:hextech-disc", cost: activated.cost }),
    error => error.reason === "judge-required" && /Unsupported payment kind: disempower/.test(error.message)
  );
});

test("ven-087-166 Hextech Disc probe: the production chain has no receiver for a played token", () => {
  const kernel = world().player("A").player("B")
    .deck(["A:d"], { owner: "A" }).deck(["B:d"], { owner: "B" })
    .rune(["A:r"], { owner: "A" }).rune(["B:r"], { owner: "B" })
    .build();
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
  const created = engine.commit({
    type: "create-token",
    player: "A",
    token: { cardId: null, name: "Mech", types: ["unit"], tags: ["Mech"], might: 3, energy: null, power: null },
    to: "chain"
  });
  assert.equal(created.status, "done");
  // routeAction requires a bound card program (describePlay); a token has no
  // cardId, so the play handoff cannot be dispatched without an adapter.
  assert.throws(
    () => engine.commit({ type: "play", object: created.result, player: "A", location: { type: "base", player: "A" } }),
    /Play action requires a card-program adapter/
  );
});
