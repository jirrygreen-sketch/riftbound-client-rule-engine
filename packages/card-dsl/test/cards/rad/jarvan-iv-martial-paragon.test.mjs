import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/jarvan-iv-martial-paragon.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateObjectFilter, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { actionTimings } from "../../../../engine-core/dist/layers/rules/query.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import action from "../../../../engine-core/dist/effects/keywords/Action.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-24736fa17d67e359a6f4e4ecf2a322db223ee66f6f8e1041e5e227e305a50dee";
const SOURCE_TEXT =
  "Your gear with [Deploy] have [Action]. (They can be played on your turn or in showdowns.)\n" +
  "When I conquer, if there is a friendly gear with [Deploy] here, channel 1 rune exhausted.";

test("rad-091-167 Jarvan IV, Martial Paragon: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the current binding and predicate gaps.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /keyword/);
  assert.match(program.judgeReason, /canAct/);
  assert.match(program.judgeReason, /830\.3/);
  // Point at the merged binder/query behaviour that actually rejects the grant.
  assert.match(program.judgeReason, /translateObjectFilter|staticFilter/);
  assert.match(program.judgeReason, /appliesTo/);
  assert.match(program.judgeReason, /RIFT-710/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.doesNotMatch(program.judgeReason, /静态绑定器拒绝 keyword 过滤字段，无法选出/);
  // The Deploy location consumer remains a real gap, but the reason must no
  // longer rest on a missing binder entry point.
  assert.match(program.judgeReason, /Deploy 展开/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-091-167 Jarvan IV, Martial Paragon: static [Action] grant to Deploy gear", () => {
  assert.equal(program.abilities.length, 2);
  const grant = program.abilities[0];
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Action");
  assert.deepEqual(grant.effect.filter, {
    type: "gear",
    controller: "controller",
    zone: "board",
    keyword: "Deploy"
  });
});

test("rad-091-167 Jarvan IV, Martial Paragon: conquer trigger gated on a friendly Deploy gear here", () => {
  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(triggered.optional, false);

  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left, {
    kind: "count",
    subject: "gear",
    filter: {
      type: "gear",
      controller: "controller",
      zone: "board",
      keyword: "Deploy",
      sameLocationAs: "self"
    }
  });
});

test("rad-091-167 Jarvan IV, Martial Paragon: channel 1 rune exhausted is declared exactly", () => {
  const triggered = program.abilities[1];
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["jarvan-iv-martial-paragon.channel"]);
  const [instruction] = triggered.body;
  assert.equal(instruction.op, "effect.channel");
  assert.deepEqual(instruction.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-091-167 Jarvan IV, Martial Paragon: the channel-exhausted body runs through the interpreter", () => {
  const triggered = program.abilities[1];
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues, { "jarvan-iv-martial-paragon.channel.channeled": 1 });
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
  // 431.2: the exhausted stipulation is forwarded as part of the channel-rune action.
  assert.equal(outcome.events[0].action, "channel-rune");
});

test("rad-091-167 Jarvan IV, Martial Paragon: the exhausted stipulation reaches the GameAction", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const actions = [];
  kernel.addReplacement(action => {
    if (action.type === "channel-rune") actions.push(action);
    return null;
  });
  const run = runInstruction(channel, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(actions, [{ type: "channel-rune", player: "A", amount: 1, exhausted: true }]);
  assert.equal(kernel.zone("A", "rune-zone").length, 1);
});

test.todo(
  "jarvan-iv-martial-paragon: wire keyword-form Action grants into the timing-permission query — " +
    "layers/rules canAct reads continuous.timing grants/timings only, so object.keywords.Action " +
    "currently grants no timing (CR 806.1.b)"
);
test.todo(
  "jarvan-iv-martial-paragon: evaluate the “has [Deploy]” predicate (CR 830.3) in filters — " +
    "the static binder and trigger condition still cannot evaluate keyword and sameLocationAs filters"
);

/** Bind one static ability from this card through the production binder. */
function bindStaticAbility(kernel, ability, sourceId = "jarvan") {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  return { engine, bind: () => binder.bindStatic(ability, kernel.getObject(sourceId)) };
}

test("rad-091-167 Jarvan IV, Martial Paragon: the production filter preserves the “has [Deploy]” predicate", () => {
  // CR 830.3: whether a card has Deploy is a checkable characteristic. The
  // merged filter vocabulary has no field for it, so the grant cannot be bound
  // honestly: layers/filter.ts silently ignores an unknown key (which would
  // widen the grant to every gear) and the program binder rejects it outright.
  const grant = program.abilities[0];
  const ignored = [
    { ref: { id: "deploy-gear", zoneEntryId: 1 }, types: ["gear"], tags: [], zone: "board", controller: "A", owner: "A" },
    { ref: { id: "plain-gear", zoneEntryId: 2 }, types: ["gear"], tags: [], zone: "board", controller: "A", owner: "A" }
  ];
  assert.deepEqual(translateObjectFilter(grant.effect.filter), {
    type: "gear",
    controller: "self",
    zone: "board",
    keyword: "Deploy"
  });

  const kernel = world().unit("jarvan", { might: 4 }).unit("friendly-gear", { types: ["gear"], might: null }).build();
  const { bind } = bindStaticAbility(kernel, grant);
  const handle = bind();
  assert.equal(typeof handle.unbind, "function");
  handle.unbind();
});

test("rad-091-167 Jarvan IV, Martial Paragon boundary: the Action expansion's appliesTo cannot bind to an object", () => {
  // 806.1.c: the Action permission is the keyword's own expansion
  // (continuous.timing with grants ["showdown"]); the merged static binder only
  // accepts appliesTo "self", so a granted Action cannot reach a gear object.
  const expansion = action.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(expansion[0].effect.grants, ["showdown"]);
  assert.deepEqual(expansion[0].effect.appliesTo, ["card", "activated-ability"]);

  const kernel = world().unit("jarvan", { might: 4 }).unit("friendly-gear", { types: ["gear"], might: null }).build();
  const granted = {
    kind: "static",
    effect: { ...expansion[0].effect, appliesTo: "self" }
  };
  const { engine, bind } = bindStaticAbility(kernel, granted, "friendly-gear");
  bind();
  engine.layers.setObjects(kernel.objects);
  const gear = engine.layers.evaluate(kernel.ref("friendly-gear"));
  // The self-form binds, but the permission lands in the timing layer only;
  // the keyword-form Action the card grants would write object.keywords, which
  // the timing query never reads (hence the canAct gap in judgeReason).
  assert.deepEqual(actionTimings(engine.layers.registry, kernel.ref("friendly-gear"), gear, "A"), ["showdown"]);
});

test("rad-091-167 Jarvan IV, Martial Paragon boundary: the production filter retains the Deploy keyword predicate", () => {
  // 383.2 / 830.3: the gate counts friendly gear with [Deploy] here. The merged
  // trigger filter translation rejects the same predicate, so the condition
  // cannot be evaluated safely against the merged query path.
  const condition = program.abilities[1].trigger.condition;
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.filter.keyword, "Deploy");
  assert.deepEqual(translateObjectFilter(condition.left.filter), {
    type: "gear",
    controller: "self",
    zone: "board",
    sameLocationAs: "self",
    keyword: "Deploy"
  });
  // The trigger filter itself still compiles (384.4.c style source binding),
  // which is why the conquer trigger shape is kept as the executable half.
  assert.deepEqual(
    translateTriggerFilter(program.abilities[1].trigger.filter, "jarvan", "conquer"),
    { event: "conquer", object: { objectId: "jarvan" } }
  );
});

// --- 2026-10-18 re-sweep: measured re-expansion and condition behaviour ---
test("rad-091-167 Jarvan IV re-sweep: the merged re-expansion turns a granted Action into a real timing licence, but is not the production engine", () => {
  // RIFT-710's KeywordGrantLayerEngine expands the granted Action keyword into
  // its continuous.timing declaration, and layers/rules then reports the
  // showdown licence. Production is not wired to that engine: ChainEngine still
  // constructs the plain LayerEngine (where the keyword only lands in
  // object.keywords), and programs/lifecycle.ts binds statics to it.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("gear", { zone: "board", controller: "A", types: ["gear"] })
    .unit("src", { zone: "board", controller: "A" })
    .build();
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context });
  layers.addContinuous({
    id: "grant-action",
    layer: "ability",
    source: kernel.ref("src"),
    filter: { objectId: "gear", zone: "board", zoneEntryId: 1 },
    effect: { kind: "continuous.grant-keyword", keyword: "Action" }
  }, { type: "permanent" });

  const snapshot = layers.evaluate(kernel.ref("gear"));
  assert.deepEqual(snapshot.keywords.map(keyword => keyword.id), ["Action"]);
  assert.deepEqual(actionTimings(layers.registry, kernel.ref("gear"), snapshot, "A"), ["showdown"]);
  // The same ability-layer registration on the production LayerEngine leaves
  // only the keyword: applyAbility writes object.keywords, never the
  // grants/timings the rule query reads. The entry is rebuilt from the card's
  // declared shape rather than reusing the re-expansion engine's registry,
  // because that engine pins its own generated expansions into the registry it
  // was handed.
  const plain = createLayerEngine(kernel.objects, [{
    effect: {
      id: "grant-action",
      layer: "ability",
      source: kernel.ref("src"),
      filter: { objectId: "gear", zone: "board", zoneEntryId: 1 },
      effect: { kind: "continuous.grant-keyword", keyword: "Action" }
    },
    duration: { type: "permanent" },
    timestamp: 1
  }]);
  assert.deepEqual(plain.evaluate(kernel.ref("gear")).keywords.map(keyword => keyword.id), ["Action"]);
  assert.deepEqual(actionTimings(plain.registry, kernel.ref("gear"), plain.evaluate(kernel.ref("gear")), "A"), []);
});

test("rad-091-167 Jarvan IV re-sweep: the authored conquer condition is not honestly evaluable on a real board", () => {
  // The gate must count only friendly gear with [Deploy] at the source's
  // battlefield. On a real board with one Deploy gear and two plain gear at two
  // battlefields the authored count evaluates to 0 (the keyword key is dropped
  // by the query matcher while sameLocationAs is not resolved by the reference
  // kernel query), so the trigger would be suppressed even though the printed
  // condition holds.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("jarvan", { zone: "board", controller: "A", types: ["unit"], location: { type: "battlefield", id: "bf1" } })
    .unit("deploy-gear", { zone: "board", controller: "A", types: ["gear"], keywords: [{ id: "Deploy" }], location: { type: "battlefield", id: "bf1" } })
    .unit("plain-gear", { zone: "board", controller: "A", types: ["gear"], location: { type: "battlefield", id: "bf1" } })
    .unit("far-gear", { zone: "board", controller: "A", types: ["gear"], keywords: [{ id: "Deploy" }], location: { type: "battlefield", id: "bf2" } })
    .unit("enemy-gear", { zone: "board", owner: "B", controller: "B", types: ["gear"], location: { type: "battlefield", id: "bf1" } })
    .build();
  const source = kernel.getObject("jarvan");
  const environment = {
    context: bindResolveContext(kernel, { source, controller: "A" }),
    host: source.ref,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  const condition = program.abilities[1].trigger.condition;
  assert.equal(evaluateExpression(condition.left, environment), 0);
  assert.equal(evaluateCondition(condition, environment), false);
});
