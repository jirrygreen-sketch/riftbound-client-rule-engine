// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/laurent-duelist.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CARD_ID = "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6";

const snapshot = (combatRole = null) => ({
  ref: { id: "duelist", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Laurent Duelist",
  types: ["unit"],
  tags: [],
  // The declared keyword is the card data under test; the snapshot carries no
  // duplicate printed copy (expandProgram combines declared + printed entries).
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: null,
  combatRole,
  might: 3,
  energy: 4,
  power: null,
  exhausted: false,
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
  assert.match(program.judgeReason, /[Aa]ssault/);
  assert.match(program.judgeReason, /combat\/flow\.ts:196-200/);
  assert.match(program.judgeReason, /chain\/engine\.ts:414-416/);
  assert.match(program.judgeReason, /static-adapters\/model\.ts:256-288/);
  assert.match(program.judgeReason, /Might 3/);
  assert.match(program.judgeReason, /807\.1\.d\.1/);
  assert.equal(program.sourceText, "[Assault 2] (+2 :rb_might: while I'm an attacker.)");
});

test("abilities: exactly one Assault keyword ability with value 2", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "assault");
  assert.equal(ability.value, 2);
});

test("the merged Assault expansion resolves the keyword into a +2 Might static ability (807.1.c)", () => {
  const expanded = expandProgram(program, snapshot());
  assert.equal(expanded.expanded.length, 1);
  const [staticAbility] = expanded.expanded;
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 2 });
  // 807.1.d.1: the bonus lasts exactly while the unit holds the Attacker designation.
  assert.deepEqual(staticAbility.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

const ADMITTED = { ...program, status: "executable", judgeReason: undefined };
const BATTLEFIELD = { type: "battlefield", id: "bf1" };

function hostFor(kernel, choose) {
  return createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
}

function bindProductionAssault(engine, kernel) {
  const source = kernel.getObject("duelist");
  const [staticAbility] = expandProgram(ADMITTED, source).expanded;
  assert.equal(staticAbility.kind, "static");
  const binding = createProgramBinding({
    cardPrograms: [ADMITTED],
    staticBinder: createEngineStaticBinder(engine)
  });
  const handle = binding.bindStatic(staticAbility, source);
  return { handle, source };
}

function layerRuntime(combatRole) {
  const kernel = world().player("A").player("B")
    .unit("duelist", {
      cardId: CARD_ID,
      owner: "A",
      controller: "A",
      might: 3,
      energy: 4,
      power: null,
      combatRole,
      location: BATTLEFIELD
    })
    .build();
  const choose = request => { throw new AwaitChoice(request); };
  const host = hostFor(kernel, choose);
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const { handle } = bindProductionAssault(engine, kernel);
  engine.layers.setObjects(kernel.objects);
  return { engine, kernel, handle };
}

for (const [combatRole, expected] of [["attacker", 5], ["defender", 3], [null, 3]]) {
  test(`production binder consumes designation for ${combatRole ?? "no combat role"} (807.1.d.1)`, () => {
    const f = layerRuntime(combatRole);
    assert.equal(f.engine.layers.evaluate(f.kernel.ref("duelist")).might, expected);
    f.handle.unbind();
  });
}

function combatRuntime() {
  const builder = world().player("A").player("B")
    .unit("duelist", {
      cardId: CARD_ID,
      owner: "A",
      controller: "A",
      might: 3,
      energy: 4,
      power: null,
      location: BATTLEFIELD
    })
    .unit("defender", {
      owner: "B",
      controller: "B",
      might: 3,
      power: null,
      location: BATTLEFIELD
    });
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const choose = request => {
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    if (request.type === "order") return [request.options[0]];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = hostFor(kernel, choose);
  const chain = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const flow = new CombatFlow(chain, host,
    [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }],
    () => {}, { events: true, lifecycle: true });
  const { handle } = bindProductionAssault(chain, kernel);
  return { kernel, chain, flow, handle };
}

test("real CombatFlow designates the attacker but the default layer still sees Might 3 (production gap)", () => {
  const f = combatRuntime();
  f.flow.entered(f.kernel.getObject("duelist"));
  f.flow.cleanup();
  f.chain.advance();
  const started = f.flow.startCombat("bf1");

  assert.deepEqual(started, {
    field: "bf1", combatId: "combat:bf1:1", attacker: "A", defender: "B", focus: "A"
  });
  // CR 466.2.c.3: both Units at the contested Battlefield receive the matching designation.
  assert.equal(f.flow.snapshot(f.kernel.getObject("duelist")).combatRole, "attacker");
  assert.equal(f.flow.snapshot(f.kernel.getObject("defender")).combatRole, "defender");
  assert.deepEqual(
    f.chain.pipeline.events.filter(event => ["combat-start", "attack-declared", "defense-declared"]
      .includes(event.timingPoint)).map(event => event.timingPoint),
    ["combat-start", "attack-declared", "defense-declared"]
  );

  // This is the fail-closed production result until engine-core publishes the
  // CombatFlow role projection into the layer/condition source.
  f.chain.layers.setObjects(f.kernel.objects);
  assert.equal(f.chain.layers.evaluate(f.kernel.ref("duelist")).might, 3);
  const [entry] = f.chain.layers.registry.list()
    .filter(item => item.effect.effect.kind === "continuous.might");
  assert.equal(typeof entry.effect.effect.condition, "function");
  assert.equal(entry.effect.effect.condition(f.flow.snapshot(f.kernel.getObject("duelist"))), false,
    "the role-bearing Combat snapshot is not the source used by the bound condition");
  f.handle.unbind();
});
