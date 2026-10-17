import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crowd-favorite.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
// The program binding is the production path the [Hunt] expansion has to take;
// the golden below records exactly where event registration still stops.
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { resolveChainBody as resolveProductionBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID =
  "card.hash-204eccc6166c5de77fb944367f972c5488c896a4054343aae4b3c15ca9b01b0f";
const SOURCE_TEXT =
  "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
  "Spend 2 XP: [Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)";

const [hunt, activated] = program.abilities;
const [buffSelf] = activated.body;

function unit(overrides = {}) {
  return {
    ref: { id: "crowd-favorite", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Crowd Favorite",
    types: ["unit"],
    tags: ["Noxus"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 3,
    energy: 3,
    power: ["Body"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

test("unl-102-219 Crowd Favorite: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-102-219 Crowd Favorite: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /823\.2/);
});

test("unl-102-219 Crowd Favorite: [Hunt] is declared without a value (823.1.c.2 presumes X = 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });
});

test("unl-102-219 Crowd Favorite: 'Spend 2 XP:' is an action-speed activated ability", () => {
  // 145.1 / 145.2: costs before the colon; no [Reaction] is printed, so the
  // ability is activated on the controller's Main Phase (action timing).
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.restriction, undefined);
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "xp", amount: { kind: "constant", value: 2 } }]
  });
});

test("unl-102-219 Crowd Favorite: the effect buffs the host through effect.buff", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(buffSelf.id, "crowd-favorite.buff-self");
  assert.equal(buffSelf.op, "effect.buff");
  assert.deepEqual(buffSelf.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "crowd-favorite.self" }
  });
  assert.equal(buffSelf.linkedTo, undefined);
  assert.equal(buffSelf.picks, undefined);
  assert.equal(buffSelf.targets.length, 1);
  const [spec] = buffSelf.targets;
  assert.equal(spec.id, "crowd-favorite.self");
  // 053.1 + contract 3.6: "me" is the ability host, spelled with the symbolic
  // self anchor rather than a runtime ObjectRef.
  assert.deepEqual(spec.filter, { object: "self", type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("unl-102-219 Crowd Favorite golden: the merged cost plan really spends exactly 2 XP", () => {
  const kernel = world().player("A", { xp: 5 }).build();
  kernel.addObject(unit());
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("crowd-favorite") });
  const plan = buildCostPlan(context, {
    id: "crowd-favorite.activated",
    cost: activated.cost,
    domains: ["Body"]
  });
  assert.equal(plan.finalized, true);
  assert.equal(plan.total.energy, 0);
  assert.equal(plan.total.xp, 2);
  assert.deepEqual(plan.total.power, []);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player("A").xp, 3);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "spend-xp"]);
  assert.deepEqual(receipt.actions[1].action, { type: "spend-xp", player: "A", amount: 2 });
});

test("unl-102-219 Crowd Favorite golden: an unpayable XP cost is rejected before any action", () => {
  const kernel = world().player("A", { xp: 1 }).build();
  kernel.addObject(unit());
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("crowd-favorite") });
  const plan = buildCostPlan(context, {
    id: "crowd-favorite.activated",
    cost: activated.cost,
    domains: ["Body"]
  });
  assert.equal(plan.total.xp, 2);
  assert.throws(() => payCostPlan(context, plan), /Insufficient XP/);
  assert.equal(context.player("A").xp, 1);
});

test("unl-102-219 Crowd Favorite golden: [Buff] me places one Buff counter on the host", () => {
  const kernel = world().player("A", { xp: 5 }).build();
  kernel.addObject(unit());
  kernel.setTargets("crowd-favorite.self", [kernel.ref("crowd-favorite")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("crowd-favorite") });
  const outcome = runAbilityBody([{ ...buffSelf, targets: undefined }], context);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.equal(context.getObject("crowd-favorite").buffs, 1);
  assert.deepEqual(context.events.map(event => event.action), ["buff"]);
});

test("unl-102-219 Crowd Favorite golden: a unit that already has a Buff is not buffed again (702.3.a)", () => {
  const kernel = world().player("A", { xp: 5 }).build();
  kernel.addObject(unit({ buffs: 1 }));
  kernel.setTargets("crowd-favorite.self", [kernel.ref("crowd-favorite")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("crowd-favorite") });
  const outcome = runAbilityBody([{ ...buffSelf, targets: undefined }], context);
  // effect.buff reports the no-op as negated/skipped and places nothing.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(context.getObject("crowd-favorite").buffs, 1);
  assert.deepEqual(context.events, []);
});

test("unl-102-219 Crowd Favorite: [Hunt] expands into conquer/hold XP triggers (823.1.c.1)", () => {
  const hunt = keywordDefinitionsById.get("Hunt");
  assert.ok(hunt, "effects/keywords/Hunt.ts must be in the generated registry");
  assert.equal(hunt.valued, true);
  assert.equal(hunt.stacking, "sum");

  const expanded = hunt.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expanded.map((ability) => ability.trigger.at), ["conquer", "hold"]);
  for (const ability of expanded) {
    assert.equal(ability.body[0].op, "effect.xp");
    // 823.1.c.2: an omitted Hunt value is 1.
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 1 });
  }
});

test("unl-102-219 Crowd Favorite golden: the [Hunt] expansion's real xp body grants XP through the production adapter", () => {
  const hunt = keywordDefinitionsById.get("Hunt");
  const [conquer] = hunt.expand({ host: { canonicalCardId: CANONICAL_ID } });
  const kernel = world().player("A", { xp: 0 }).build();
  const outcome = resolveProductionBody(conquer.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(outcome.results[0].result.linkedValues.gained, 1);
});

test("unl-102-219 Crowd Favorite the binding inspects the authored activated cost/body while preserving judge-required", () => {
  // Inspect the actual program; do not promote an unsupported Hunt program
  // merely to bypass ProgramRegistry admission for a structural assertion.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const board = fixture({
    cards: [{ id: "crowd-favorite", cardId: program.canonicalCardId, types: ["unit"], energy: 3, power: [], might: 3 }]
  });
  board.kernel.perform({
    type: "move-zone",
    object: board.kernel.ref("crowd-favorite"),
    to: "battlefield",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = board.kernel.getObject("crowd-favorite");
  const abilities = binding.inspect(source).abilities.filter(ability => ability.kind === "activated");
  assert.equal(abilities.length, 1);
  assert.deepEqual(abilities[0].cost, {
    kind: "activated",
    payments: [{ kind: "xp", amount: { kind: "constant", value: 2 } }]
  });
  // The declared effect body is the merged effect.buff instruction, which the
  // golden above already executes through the real interpreter.
  assert.equal(abilities[0].body.length, 1);
  assert.equal(abilities[0].body[0].op, "effect.buff");
});
