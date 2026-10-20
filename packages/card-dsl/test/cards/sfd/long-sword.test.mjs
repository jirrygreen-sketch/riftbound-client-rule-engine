import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/long-sword.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";

test("Long Sword card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
  );
});

test("Long Sword hosts Quick-Draw and a valued Fury Equip keyword", () => {
  assert.equal(program.abilities.length, 2);
  const [quickDraw, equip] = program.abilities;
  assert.deepEqual(quickDraw, { kind: "keyword", keyword: "quick-draw" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
});

test("Long Sword carries its printed Equip cost as exactly one Fury Power through params.cost", () => {
  const [, equip] = program.abilities;
  assert.deepEqual(equip.params, {
    cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }]
    }
  });
  assert.equal(equip.params.cost.energy, undefined);
  assert.equal(equip.params.cost.payments.some(payment => payment.kind === "equip"), false);
});

// Production fixture: the unchanged registry program bound through
// createProgramBinding and a real ChainEngine whose describePlay is the binding's.
function fixture({ zone, energy = 2, power = ["Fury"] }) {
  const kernel = world()
    .player("A", { energy, power })
    .player("B", { energy: 2, power: ["Fury"] })
    .object("sword", {
      owner: "A",
      controller: "A",
      cardId: CANONICAL_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone,
      ...(zone === "board" ? { location: { type: "base", player: "A" } } : {}),
      energy: 2,
      power: ["Fury"],
      might: 2
    })
    .base("ally", { might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 2, location: { type: "base", player: "B" } })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "select-objects") return [kernel.ref("ally")];
    throw new Error(`Unexpected production choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false, describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => { while (engine.items.length) engine.pass(engine.priority); };
  return { kernel, engine, binding, requests, settle };
}

test("Long Sword: a Main-Phase play pays 2 Energy + 1 Fury and Quick-Draw attaches it to the only friendly Unit (CR 819.1.d)", () => {
  const f = fixture({ zone: "hand" });
  const source = f.kernel.getObject("sword");
  f.engine.execute(f.binding.describePlay({ type: "play", object: source.ref, player: "A" }, source));
  f.settle();
  const sword = f.kernel.getObject("sword");
  assert.equal(sword.zone, "board");
  assert.deepEqual(sword.attachedTo, f.kernel.ref("ally"));
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.player("B").power, ["Fury"], "the opponent pays nothing");
  const targets = f.requests.filter(request => request.type === "select-objects");
  assert.equal(targets.length, 1, "the trigger asks for exactly one attach host");
  assert.deepEqual(targets[0].options, [f.kernel.ref("ally")], "only a Unit its controller controls is offered");
  assert.equal(f.kernel.getObject("enemy").attachedTo ?? null, null);
  assert.deepEqual(f.engine.items, []);
});

test("Long Sword: without the Fury Power the play is rejected before anything moves", () => {
  const f = fixture({ zone: "hand", power: [] });
  const source = f.kernel.getObject("sword");
  const before = f.kernel.snapshot();
  assert.throws(() => f.engine.execute(f.binding.describePlay({ type: "play", object: source.ref, player: "A" }, source)), /insufficient matching Power/);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.getObject("sword").zone, "hand");
});

test("Long Sword: Equip pays exactly one Fury Power and attaches to a friendly Unit (CR 818.1.c.2, 818.2)", () => {
  const f = fixture({ zone: "board", energy: 3, power: ["Fury", "Fury"] });
  f.engine.execute(f.binding.describeActivate(f.kernel.getObject("sword"), "A", 0));
  f.settle();
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.ref("ally"));
  assert.deepEqual(f.kernel.player("A").power, ["Fury"]);
  assert.equal(f.kernel.player("A").energy, 3, "the printed Equip cost has no Energy");
  const targets = f.requests.filter(request => request.type === "select-objects");
  assert.deepEqual(targets.map(request => request.options), [[f.kernel.ref("ally")]]);
});

test("Long Sword: Equip without Fury Power is rejected atomically", () => {
  const f = fixture({ zone: "board", energy: 3, power: ["Body"] });
  const before = f.kernel.snapshot();
  assert.throws(() => {
    f.engine.execute(f.binding.describeActivate(f.kernel.getObject("sword"), "A", 0));
    f.settle();
  }, /insufficient matching Power/);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.getObject("sword").attachedTo ?? null, null);
  assert.deepEqual(f.engine.items, []);
});

test("Long Sword: [Quick-Draw] Reaction - played into a Closed Chain on the opponent's turn, attached, +2 Might Bonus (CR 819.1.b/819.1.c, 137.3)", () => {
  const VOID_SEEKER = "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10";
  const f = productionPlay({
    programs: [program, cardProgramsById.get(VOID_SEEKER)],
    turnPlayer: "B",
    answers: { "target:unit-at-battlefield": ["ally"] },
    build: w => w.player("A", { energy: 2, power: ["Fury"] }).player("B", { energy: 3, power: ["Fury"] })
      .object("sword", { owner: "A", controller: "A", cardId: CANONICAL_ID, types: ["gear"], tags: ["Equipment"], zone: "hand", energy: 2, power: ["Fury"], might: 2 })
      .object("vs", { owner: "B", controller: "B", cardId: VOID_SEEKER, types: ["spell"], zone: "hand", energy: 3, power: ["Fury"] })
      .unit("ally", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf1" } })
  });
  f.engine.execute(f.describe("vs", "B"));
  f.engine.pass("B");
  assert.equal(f.engine.priority, "A");
  const draft = f.describe("sword", "A");
  assert.equal(draft.speed, "reaction");
  f.engine.execute(draft);
  f.settle();
  assert.equal(f.kernel.getObject("sword").zone, "board");
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.ref("ally"));
  assert.equal(f.might("ally"), 5, "printed Might 3 + Long Sword Might Bonus 2");
  assert.equal(f.kernel.getObject("vs").zone, "trash", "the opposing spell still resolved afterwards");
});
