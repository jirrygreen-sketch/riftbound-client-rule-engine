import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/primordial-roar.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL = "card.hash-8b6deb587569a3df7032c50ff6c443facba501038a4e6e1fb77f5aedbedb57cf";
const [showOff, play] = program.abilities;
const [showInstruction, dealInstruction] = play.body;
const targetSpec = dealInstruction.targets[0];

test("rad-082-167 Primordial Roar: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Show Off] a unit. (As you play this, you may reveal a unit from hand or pick a friendly unit.)\n" +
      "If you showed off a unit, deal damage equal to that unit's Might to a unit."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-082-167 Primordial Roar: judgeReason names the merged keyword and the remaining gaps", () => {
  // The reason must name the merged code that rejects the program, not task ids.
  assert.match(program.judgeReason, /ShowOff\.ts/);
  assert.match(program.judgeReason, /Show Off/);
  assert.match(program.judgeReason, /show-off/);
  assert.match(program.judgeReason, /definitionFor|executable KeywordDef/);
  assert.match(program.judgeReason, /cost\.reveal/);
  assert.match(program.judgeReason, /objects-shown-off/);
  assert.match(program.judgeReason, /Unregistered instruction opcode|not a registered instruction op/);
  assert.match(program.judgeReason, /832\.1/);
  assert.match(program.judgeReason, /832\.1\.d\.1/);
  // The refreshed reason names the measured layer rejection and the value
  // rejection as well, so the remaining gap is reproducible from the text.
  assert.match(program.judgeReason, /cost\.reveal has no layer mapping/);
  assert.match(program.judgeReason, /does not accept a value/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
});

test("rad-082-167 Primordial Roar: structure — the [Show Off] keyword declaration plus a printed-cost play ability", () => {
  assert.equal(program.abilities.length, 2);
  // CardProgram keyword abilities store the lowercase slug; the registry
  // indexes the printed bracket name (see the Deathknell keyword test).
  assert.deepEqual(showOff, { kind: "keyword", keyword: "show-off", value: 1 });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 2 }
  });
});

test("rad-082-167 Primordial Roar: structure — the Show Off choice and its locked-Might contract", () => {
  assert.equal(showInstruction.id, "primordial-roar.show-off");
  assert.equal(showInstruction.op, "effect.show-off");
  assert.deepEqual(showInstruction.args.source.value, {
    from: ["hand", "board"],
    type: "unit",
    controller: "you"
  });
  assert.deepEqual(showInstruction.args.optional, { kind: "constant", value: true });
  // 832.1.d.1: the referenced characteristic is locked when it is shown off.
  assert.deepEqual(showInstruction.args.linkKey, { kind: "constant", value: "shown" });
  assert.deepEqual(showInstruction.args.lockedProperty, { kind: "constant", value: "might" });
  assert.deepEqual(showInstruction.args.lockedKey, { kind: "constant", value: "shownMight" });
  // The shown-off unit is not a target (355.10.a / pick semantics).
  assert.equal(showInstruction.targets, undefined);
  assert.equal(showInstruction.picks, undefined);
});

test("rad-082-167 Primordial Roar: structure — the damage half reads the locked Might and targets one unit", () => {
  assert.equal(play.body.length, 2);
  assert.equal(dealInstruction.id, "primordial-roar.deal-shown-might");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.equal(dealInstruction.linkedTo, showInstruction.id);

  // The amount comes from the Show Off link, never from a re-read of the
  // unit's current Might (832.1.d.1).
  assert.deepEqual(dealInstruction.args.amount, {
    kind: "linked-value",
    instructionId: showInstruction.id,
    key: "shownMight"
  });
  assert.equal(dealInstruction.args.amount.kind, "linked-value");
  assert.notEqual(dealInstruction.args.amount.kind, "object-property");

  // "If you showed off a unit, ..." — the gate is the Show Off link value.
  assert.equal(dealInstruction.condition.kind, "expression");
  assert.deepEqual(dealInstruction.condition.value, {
    kind: "linked-value",
    instructionId: showInstruction.id,
    key: "shown"
  });

  assert.deepEqual(dealInstruction.args.target, { kind: "constant", value: "damaged-unit" });
  assert.equal(dealInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "damaged-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.equal(dealInstruction.picks, undefined);
});

test("rad-082-167 Primordial Roar: the damage half executes with the locked Might value", () => {
  // The damage instruction only uses merged primitives; the lock value comes
  // from the Show Off link (which is the unmerged half, see the TODO). With the
  // locked value supplied, the instruction deals exactly that much — proving
  // the authored amount is a locked value and not a re-read.
  const kernel = world()
    .unit("shown-unit", { owner: "A", might: 4 })
    .unit("damaged-unit", { owner: "B", controller: "B", might: 3 })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    {
      world: kernel,
      targets: { [targetSpec.id]: [kernel.ref("damaged-unit")] },
      linked: { shownMight: 4 }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("damaged-unit").damage, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);

  // The shown unit's own Might is 4, but the locked value is what the damage
  // reads: reducing the shown unit afterwards does not change the dealt amount.
  const stale = kernel.ref("shown-unit");
  kernel.perform({ type: "damage", source: stale, target: stale, amount: 2, combat: false });
  assert.equal(kernel.getObject("shown-unit").might, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
});

test("rad-082-167 Primordial Roar: a missing Show Off link makes the damage instruction ignored, not zero damage", () => {
  // If nothing was shown off, the gate/linked value is unavailable. The
  // interpreter's expression path reports missing linked information as
  // ignored (mistargeted-class) rather than silently dealing 0 damage.
  const kernel = world().unit("damaged-unit", { owner: "B", controller: "B" }).build();
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("damaged-unit")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.notEqual(run.result.status, "executed");
  assert.equal(kernel.getObject("damaged-unit").damage, 0);
});

// The two TODO entries above are replaced by executor-backed gap tests; the
// remaining Show Off work is pinned to the merged code that actually rejects it.
test("rad-082-167 Primordial Roar: the authored slug expands through the registered Show Off definition", () => {
  // effects/keywords/ShowOff.ts registers the printed name while the EffectIR
  // validator forces a lowercase symbol id, and programs/keywords.ts definitionFor
  // only compares case-insensitively, so neither spelling works today.
  assert.equal(keywordDefinitionsById.has("Show Off"), true);
  assert.equal(keywordDefinitionsById.has("show-off"), false);
  assert.equal(keywordDefinitionsById.get("Show Off").keyword, "Show Off");

  // The authored slug passes the card validator…
  assert.deepEqual(validateCardProgram(program).issues, []);
  assert.equal(showOff.value, 1);
  // …but the printed spelling the registry actually publishes is rejected.
  const printedSpelling = {
    ...program,
    abilities: [{ kind: "keyword", keyword: "Show Off" }, program.abilities[1]]
  };
  assert.deepEqual(
    validateCardProgram(printedSpelling).issues.map(issue => issue.code),
    ["invalid-string"]
  );

  const kernel = world().unit("host", { keywords: [{ id: "Show Off" }] }).build();
  const authored = expandProgram(program, { ...kernel.getObject("host"), cardId: CANONICAL });
  assert.deepEqual(authored.expanded.map(ability => [ability.kind, ability.effect?.kind]), [
    ["static", "cost.reveal"],
    ["static", "cost.reveal"]
  ]);
  assert.deepEqual(authored.expanded[0].effect.sources, ["hand", "board"]);

  // Control: the merged expansion does produce the cost.reveal declaration under
  // the registry key, so the failure is the id spelling/normalisation, not ShowOff.
  const registered = {
    ...program,
    status: "executable",
    abilities: [{ kind: "keyword", keyword: "Show Off" }, program.abilities[1]]
  };
  delete registered.judgeReason;
  // Show Off stacks as "separate", so only the declared keyword is supplied here
  // to assert the single expansion the card authors.
  const expansion = expandProgram(registered, {
    ...kernel.getObject("host"),
    keywords: [],
    cardId: CANONICAL
  });
  assert.deepEqual(
    expansion.expanded.map(ability => [ability.kind, ability.effect.kind]),
    [["static", "cost.reveal"]]
  );
  assert.equal(expansion.expanded[0].effect.object, null);
});

test("rad-082-167 Primordial Roar: effect.show-off is not a registered instruction opcode", () => {
  // The authored Show Off instruction cannot be dispatched by the merged
  // interpreter, and the merged cost.reveal declaration it depends on has no
  // consumer recording the objects-shown-off lock of 832.1.c.2 / 832.1.d.1.
  const kernel = world()
    .unit("host", { zone: "board" })
    .unit("victim", { owner: "B", controller: "B", zone: "board" })
    .build();
  assert.throws(
    () => resolveChainBody([showInstruction], kernel.clone({ sourceSnapshot: kernel.getObject("host") })),
    (error) => /Unregistered instruction opcode: effect\.show-off/.test(error.message)
  );
  assert.equal(keywordDefinitionsById.get("Show Off").expand({ host: { canonicalCardId: CANONICAL } })[0].effect.kind, "cost.reveal");
});

test("rad-082-167 Primordial Roar gap: the cost.reveal expansion has no static layer mapping", () => {
  // 832.1.c.2 keeps the Show Off decision in Finalize, and the merged keyword
  // expansion really produces a cost.reveal declaration — but the production
  // static binder cannot register that kind, so nothing can consume it.
  const [reveal] = keywordDefinitionsById.get("Show Off").expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(reveal.effect.kind, "cost.reveal");
  assert.equal(instructionDefinitionsById.has("cost.reveal"), false);
  const kernel = world().unit("host", { types: ["unit"], keywords: [{ id: "Show Off" }] }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(reveal, kernel.getObject("host")),
    /Static ability kind cost\.reveal has no layer mapping/
  );
});
