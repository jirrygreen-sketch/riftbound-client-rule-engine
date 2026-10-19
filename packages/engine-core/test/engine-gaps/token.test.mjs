import assert from "node:assert/strict";
import test from "node:test";

import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { createProgramBinding } from "../../dist/programs/index.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { TOKEN_DEFINITIONS } from "../../dist/effects/tokens/definitions.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import herald from "../../../card-dsl/dist/cards/ogn/herald-of-the-arcane.js";
import machineEvangel from "../../../card-dsl/dist/cards/ogn/machine-evangel.js";
import recruitTheVanguard from "../../../card-dsl/dist/cards/ogs/recruit-the-vanguard.js";

const c = value => ({ kind: "constant", value });
const base = player => ({ type: "base", player });
const field = id => ({ type: "battlefield", id });
const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });

function runtime(programs, setup, { answers = {}, transaction = false, energy = 30 } = {}) {
  const builder = world().player("A", { energy }).player("B", { energy });
  setup(builder);
  const kernel = builder.build();
  const answerMap = new Map(Object.entries(answers));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answerMap.has(request.id)) return answerMap.get(request.id);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    throw new AwaitChoice(request);
  };
  const transactionBoundary = transaction ? run => {
    const state = kernel.snapshot();
    const links = kernel.clone();
    try {
      const result = run();
      if (result.status === "negated") {
        kernel.restore(state);
        kernel.copyLinkedFrom(links);
      }
      return result;
    } catch (error) {
      kernel.restore(state);
      kernel.copyLinkedFrom(links);
      throw error;
    }
  } : undefined;
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
      ...(transactionBoundary === undefined ? {} : { transaction: transactionBoundary })
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    describePlay: binding.describePlay, cleanup: () => false
  });
  return { kernel, engine, binding, answers: answerMap, asked };
}

function settle(engine) {
  let guard = 0;
  while (engine.items.length) {
    engine.advance();
    if (!engine.items.length) break;
    assert.ok(++guard < 50, "the chain settles through real priority passes");
    engine.pass(engine.priority);
  }
}

function body(program, kind = "play") {
  const ability = program.abilities.find(candidate => candidate.kind === kind);
  assert.ok(ability, `${program.canonicalCardId} has a ${kind} ability`);
  return ability.body;
}

test("CR 187.1-187.12 definitions retain real types, tags, Might, keywords and null printed costs", () => {
  assert.equal(TOKEN_DEFINITIONS.length, 12);
  assert.deepEqual(TOKEN_DEFINITIONS.map(definition => definition.id), [
    "recruit", "sprite", "sand-soldier", "mech", "gold", "reflection",
    "bird", "brush", "baron-pit", "tentacle", "shadow-clone", "bomb"
  ]);
  const byId = new Map(TOKEN_DEFINITIONS.map(definition => [definition.id, definition]));
  assert.deepEqual(byId.get("sprite").spec, {
    cardId: "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef",
    name: "Sprite", types: ["unit"], tags: ["Fae"], keywords: [{ id: "Temporary" }],
    might: 3, energy: null, power: null
  });
  assert.deepEqual(byId.get("gold").spec.types, ["gear"]);
  assert.equal(byId.get("gold").spec.might, null);
  assert.deepEqual(byId.get("gold").spec.keywords, [{ id: "Reaction" }]);
  assert.equal(byId.get("gold").defaultEntry, "ready");
  assert.deepEqual(byId.get("bird").spec.keywords, [{ id: "Deflect" }]);
  assert.deepEqual(byId.get("bomb").spec.keywords, [{ id: "Deploy" }, { id: "Deathknell" }]);
  assert.deepEqual(byId.get("baron-pit").spec.types, ["battlefield"]);
  for (const definition of TOKEN_DEFINITIONS) {
    assert.equal(definition.spec.energy, null, `${definition.id} keeps null Energy`);
    assert.equal(definition.spec.power, null, `${definition.id} keeps null Power`);
    assert.ok(definition.ruleRefs.length > 0);
    if (definition.spec.types.includes("unit")) {
      assert.equal(definition.defaultEntry, "exhausted", `${definition.id} uses the Unit entry rule`);
    } else if (definition.spec.types.includes("gear")) {
      assert.equal(definition.defaultEntry, "ready", `${definition.id} uses the Gear entry rule`);
    } else {
      assert.equal(definition.defaultEntry, null, `${definition.id} has no Unit/Gear entry rule`);
    }
    if (!definition.spec.types.includes("unit")) {
      assert.equal(definition.spec.might, null, `${definition.id} has no printed Might`);
    }
  }
});

test("Herald's original no-destination IR chooses a controlled empty Battlefield and plays there", () => {
  const f = runtime([herald], builder => {
    builder.object("legend", {
      cardId: herald.canonicalCardId, types: ["legend"], energy: null, power: null,
      zone: "board", location: base("A")
    });
    builder.object("battlefield", {
      types: ["battlefield"], cardId: null, energy: null, power: null,
      zone: "board", controller: "A", owner: "A", location: field("controlled")
    });
  }, { answers: { "herald.play-recruit/token-location%3Alegend%3Arecruit": field("controlled") }, energy: 2 });
  const draft = f.binding.describeActivate(f.kernel.getObject("legend"), "A", 0);
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("legend"), controller: "A", timingPoint: "chain-item-resolve",
    choose: request => {
      f.asked.push(request);
      return f.answers.get(request.id) ?? (() => { throw new AwaitChoice(request); })();
    },
    perform: action => f.kernel.perform(action)
  });
  const result = resolveChainBody(draft.body, context);
  assert.equal(result.status, "executed");
  assert.equal(f.kernel.linked("herald.play-recruit.token.blockedReason"), undefined);
  const token = f.kernel.objects.find(object => object.isToken);
  assert.equal(token.name, "Recruit");
  assert.deepEqual(token.location, field("controlled"));
  assert.equal(token.exhausted, true);
  assert.deepEqual(f.asked.find(request => request.type === "mode")?.options, [base("A"), field("controlled")]);
});

test("Machine Evangel's original IR resolves the controller Base and creates then plays three Recruits", () => {
  const f = runtime([machineEvangel], builder => {
    builder.unit("source", { cardId: machineEvangel.canonicalCardId, might: 3 });
  });
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("source"), controller: "A", timingPoint: "chain-item-resolve",
    perform: action => f.kernel.perform(action)
  });
  const instruction = body(machineEvangel, "triggered")[0];
  const actions = [];
  f.kernel.addReplacement(action => { actions.push(structuredClone(action)); return null; });
  const result = resolveChainBody([instruction], context).results[0].result;
  assert.equal(result.status, "executed");
  const tokens = f.kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 3);
  assert.ok(tokens.every(token => token.name === "Recruit" && token.might === 1));
  assert.ok(tokens.every(token => token.location?.type === "base" && token.location.player === "A"));
  assert.ok(tokens.every(token => token.exhausted === true));
  assert.equal(instruction.args.location.value.player, "controller");
  assert.deepEqual(actions.map(action => action.type), [
    "create-token", "play", "create-token", "play", "create-token", "play"
  ]);
  assert.ok(actions.filter(action => action.type === "create-token").every(action => action.to === "chain"));
});

test("Recruit the Vanguard's original query locations enumerate Base and controlled Battlefields", () => {
  const baseId = "recruit-the-vanguard.play-tokens/recruit-the-vanguard.location%3A0";
  const ownedId = "recruit-the-vanguard.play-tokens/recruit-the-vanguard.location%3A1";
  const baseAgainId = "recruit-the-vanguard.play-tokens/recruit-the-vanguard.location%3A2";
  const ownedAgainId = "recruit-the-vanguard.play-tokens/recruit-the-vanguard.location%3A3";
  const f = runtime([recruitTheVanguard], builder => {
    builder.object("source", { types: ["legend"], location: base("A") });
    builder.object("battlefield", {
      types: ["battlefield"], cardId: null, zone: "board", controller: "A", owner: "A", location: field("owned")
    });
    builder.object("foreign", {
      types: ["battlefield"], cardId: null, zone: "board", controller: "B", owner: "B", location: field("foreign")
    });
  }, { answers: {
    [baseId]: base("A"), [ownedId]: field("owned"),
    [baseAgainId]: base("A"), [ownedAgainId]: field("owned")
  } });
  const instruction = body(recruitTheVanguard)[0];
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("source"), controller: "A", timingPoint: "chain-item-resolve",
    choose: request => {
      f.asked.push(request);
      return f.answers.get(request.id) ?? (() => { throw new AwaitChoice(request); })();
    },
    perform: action => f.kernel.perform(action)
  });
  const result = resolveChainBody([instruction], context).results[0].result;
  assert.equal(result.status, "executed");
  assert.deepEqual(f.asked[0].options, [base("A"), field("owned")]);
  assert.deepEqual(f.asked.map(request => request.id), [baseId, ownedId, baseAgainId, ownedAgainId]);
  assert.deepEqual(
    f.kernel.objects.filter(object => object.isToken && object.zone === "board").map(object => object.location),
    [base("A"), field("owned"), base("A"), field("owned")]
  );
  assert.equal(f.kernel.pendingItems.length, 0);
});

test("a unit entry override is carried on the real create action with null printed costs", () => {
  const token = instructionDefinitionsById.get("effect.token");
  const actions = [];
  const kernel = world().player("A").unit("source").build();
  kernel.addReplacement(action => { actions.push(structuredClone(action)); return null; });
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A", timingPoint: "main-start",
    perform: action => kernel.perform(action)
  });
  const instruction = {
    id: "entry.recruit", op: "effect.token",
    args: { token: c("recruit"), location: c(base("A")), entersReady: c(true) }
  };
  const result = resolveChainBody([instruction], context).results[0].result;
  assert.equal(result.status, "executed");
  assert.equal(actions[0].token.exhausted, false);
  assert.equal(actions[0].token.energy, null);
  assert.equal(actions[0].token.power, null);
  assert.equal(kernel.getObject("token-1").exhausted, false);
});

test("an invalid destination and a blocked intrinsic definition fail without creating anything", () => {
  const token = instructionDefinitionsById.get("effect.token");
  const kernel = world().unit("source").build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A", timingPoint: "main-start",
    perform: action => kernel.perform(action)
  });
  const invalid = resolveChainBody([{
    id: "invalid.recruit", op: "effect.token", args: { token: c("recruit"), location: c(base("B")) }
  }], context).results[0].result;
  assert.equal(invalid.status, "negated");
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  const blocked = resolveChainBody([{
    id: "blocked.gold", op: "effect.token",
    args: { token: c("gold"), location: c(base("A")), entersExhausted: c(true) }
  }], context).results[0].result;
  assert.equal(blocked.status, "negated");
  assert.equal(kernel.linked("blocked.gold.token.blockedReason"), undefined);
  assert.equal(kernel.linked("blocked.gold.token").blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});

test("an outer transaction rolls back every committed token when a later Play is prevented", () => {
  const answer = (id, location) => [id, location];
  const ids = Array.from({ length: 4 }, (_, index) =>
    `recruit-the-vanguard.play-tokens/recruit-the-vanguard.location%3A${index}`
  );
  const f = runtime([recruitTheVanguard], builder => {
    builder.object("source", { types: ["legend"], location: base("A") });
  }, { answers: Object.fromEntries(ids.map(id => answer(id, base("A")))) });
  f.kernel.addReplacement((action, context) => action.type === "play" && context.history({ action: "play" }) === 1 ? "prevented" : null);
  const before = f.kernel.snapshot();
  const beforeEvents = structuredClone(f.kernel.events);
  const transaction = run => {
    const state = f.kernel.snapshot();
    const links = f.kernel.clone();
    try {
      const result = run();
      if (result.status === "negated") {
        f.kernel.restore(state);
        f.kernel.copyLinkedFrom(links);
      }
      return result;
    } catch (error) {
      f.kernel.restore(state);
      f.kernel.copyLinkedFrom(links);
      throw error;
    }
  };
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("source"), controller: "A", timingPoint: "chain-item-resolve",
    choose: request => f.answers.get(request.id),
    perform: action => f.kernel.perform(action), transaction
  });
  const instruction = body(recruitTheVanguard)[0];
  const result = instructionDefinitionsById.get("effect.token").execute(context, instruction.args);
  assert.equal(result.status, "negated");
  assert.ok(result.events.length > 0, "the primitive returns its local action receipts");
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.events, beforeEvents, "the outer ResolveContext transaction restores authoritative events");
});

test("a later Play failure preserves earlier raw-IR tokens without a transaction", () => {
  const answers = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    `recruit-the-vanguard.play-tokens/recruit-the-vanguard.location%3A${index}`, base("A")
  ]));
  const f = runtime([recruitTheVanguard], builder => {
    builder.object("source", { types: ["legend"], location: base("A") });
  }, { answers });
  f.kernel.addReplacement((action, context) => action.type === "play" && context.history({ action: "play" }) === 1 ? "prevented" : null);
  const context = bindResolveContext(f.kernel, {
    source: f.kernel.getObject("source"), controller: "A", timingPoint: "chain-item-resolve",
    choose: request => f.answers.get(request.id), perform: action => f.kernel.perform(action)
  });
  const instruction = body(recruitTheVanguard)[0];
  const result = resolveChainBody([instruction], context).results[0].result;
  assert.equal(result.status, "negated");
  assert.equal(f.kernel.objects.filter(object => object.isToken && object.zone === "board").length, 1);
  assert.equal(f.kernel.pendingItems.length, 1);
});

test("a host that drops entry readiness fails closed after the actual Play action", () => {
  const kernel = world().player("A").unit("source").build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A", timingPoint: "main-start",
    perform: action => {
      if (action.type !== "create-token") return kernel.perform(action);
      const { exhausted: _exhausted, ...token } = action.token;
      return kernel.perform({ ...action, token });
    }
  });
  const result = resolveChainBody([{
    id: "lost-entry", op: "effect.token",
    args: { token: c("recruit"), mode: c("play"), location: c(base("A")), entersExhausted: c(true) }
  }], context).results[0].result;
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  assert.equal(kernel.getObject("token-1").exhausted, false);
  assert.equal(kernel.getObject("token-1").zone, "board");
  assert.equal(kernel.pendingItems.length, 0);
  assert.equal(kernel.linked("lost-entry.token.blockedReason"), undefined);
  assert.equal(kernel.linked("lost-entry.token").blockedReason, "token-entry-state-not-carried-by-play");
});

test("a host that drops entry readiness fails closed after the actual create action", () => {
  const kernel = world().player("A").unit("source").build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A", timingPoint: "main-start",
    perform: action => {
      if (action.type !== "create-token") return kernel.perform(action);
      const { exhausted: _exhausted, ...token } = action.token;
      return kernel.perform({ ...action, token });
    }
  });
  const result = resolveChainBody([{
    id: "lost-create-entry", op: "effect.token",
    args: { token: c("recruit"), location: c(base("A")), entersExhausted: c(true) }
  }], context).results[0].result;
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  assert.equal(kernel.getObject("token-1").exhausted, false);
  assert.equal(kernel.getObject("token-1").zone, "board");
  assert.equal(kernel.linked("lost-create-entry.token").blockedReason, "token-entry-state-not-carried-by-create");
});

for (const mode of ["create", "play"]) {
  test(`a ${mode} action that reports done without an ObjectRef fails closed`, () => {
    const kernel = world().player("A").unit("source").build();
    const context = bindResolveContext(kernel, {
      source: kernel.getObject("source"), controller: "A", timingPoint: "main-start",
      perform: action => action.type === "create-token" ? { status: "done", events: [] } : kernel.perform(action)
    });
    const result = resolveChainBody([{
      id: `missing-ref-${mode}`, op: "effect.token",
      args: { token: c("recruit"), mode: c(mode), location: c(base("A")) }
    }], context).results[0].result;
    assert.equal(result.status, "negated");
    assert.equal(result.reason, "impossible");
    assert.equal(kernel.linked(`missing-ref-${mode}.token`).blockedReason, "token-creation-missing-object-ref");
  });
}
