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

const CANONICAL_ID = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";

test("Long Sword card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /CR 819\.1\.b\/819\.1\.c/);
  assert.match(program.judgeReason, /draft\.speed "normal"/);
  assert.match(program.judgeReason, /Action is not legally timed/);
  assert.match(program.judgeReason, /RIFT-884/);
  assert.match(program.judgeReason, /RIFT-883/);
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

// Component-level production fixture. Only the status metadata is admitted so
// the binding accepts the card; both keyword abilities and params.cost are the
// unchanged source IR. This proves the executed slices below, not the whole
// card: the Quick-Draw Reaction timing is still pending (RIFT-884).
const admitted = { ...program, status: "executable", judgeReason: undefined };

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
  const binding = createProgramBinding({ cardPrograms: [admitted] });
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

test.todo("Long Sword: [Quick-Draw] Reaction — play it into a Closed Chain while holding Priority on another player's turn (CR 819.1.b, 819.1.c); production describePlay still reports speed \"normal\" (RIFT-884)");
