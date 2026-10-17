import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/stormclaw-ursine.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: channel } = await import(new URL("effects/instructions/effect.channel.js", engineCore));
const { keywordRegistryById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));
const { bindResolveContext } = await import(new URL("events/action-adapter.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { translateTriggerFilter } = await import(new URL("programs/filters.js", engineCore));
const { assertTriggerSpec } = await import(new URL("events/trigger-spec.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-c18b4d77a6fdbfcd9607beb0b7cb54e7133f47d1442f38f5e6dc0c7c5b88a769";
const [tankKeyword, playedTrigger] = program.abilities;
const channelInstruction = playedTrigger.body[0];

test("Stormclaw Ursine program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /keywords\//);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "When you play me, channel 1 rune exhausted."
  );
});

test("structure: Tank keyword plus the played trigger that channels 1 exhausted rune", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(tankKeyword, { kind: "keyword", keyword: "tank" });

  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playedTrigger.optional, false);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(channelInstruction.id, "stormclaw.channel");
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  // No target/pick/choice: the channeling player is the ability controller
  // (effect.channel defaults to ctx.controller).
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.picks, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
});

test("golden: 'channel 1 rune exhausted' resolves through effect.channel (CR 431.1/431.2)", () => {
  const kernel = world().rune(["r1", "r2"], { owner: "A" }).build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  const action = run.events.find(event => event.action === "channel-rune");
  assert.ok(action, "expected the channel-rune game action");
  // CR 431.2: the printed stipulation (one rune, exhausted) is exactly what the
  // card passes to the closed channel-rune action; the rune leaves the rune
  // deck and lands in the rune zone.
  assert.equal(action.action, "channel-rune");
  assert.deepEqual(kernel.objectsInZone("A", "rune-zone").map(ref => ref.id), ["r1"]);
});

test("golden: an empty rune deck channels as many as possible without negating (CR 431.3)", () => {
  const kernel = world().build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test("Tank expands to the continuous.combat damage-assignment declaration (CR 815.1.b)", () => {
  // 815.1.b ("I must be assigned lethal damage before any other unit with the
  // same controller as me that does not have [Tank] during the Combat Damage
  // step") now has the merged Tank KeywordDef (RIFT-264), but its expansion is a
  // continuous.combat declaration the combat kernels never read (see
  // combat/base-combat-allocation.ts).
  const tank = keywordRegistryById.get("Tank");
  assert.ok(tank, "effects/keywords/Tank.ts must be merged for the [Tank] declaration");
  assert.equal(tank.valued, false);
  assert.equal(tank.stacking, "single");
  const expansion = tank.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.combat");
  assert.equal(expansion[0].effect.mode, "damage-assignment");
  assert.equal(expansion[0].effect.priority, "first");
  assert.equal(expansion[0].effect.excludesKeyword, "Tank");
});

test("golden: the merged Tank expansion is a static ability carrying no instruction body", () => {
  // The merged expansion is validated as EffectIR v2 data (contract 3.7). It is
  // a static declaration: registering it produces no layer activity (the
  // layers engine has no continuous.combat branch), so the golden asserts the
  // data shape rather than a fabricated combat behaviour.
  const tank = keywordRegistryById.get("Tank");
  const expansion = tank.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion, [
    {
      kind: "static",
      effect: {
        kind: "continuous.combat",
        appliesTo: "self",
        mode: "damage-assignment",
        priority: "first",
        damage: "lethal",
        controllerScope: "same-controller",
        excludesKeyword: "Tank"
      }
    }
  ]);
});

test.todo(
  "Stormclaw Ursine: [Tank] (CR 815.1.b combat-damage assignment order) has the merged KeywordDef " +
    "(RIFT-264) but nothing consumes the continuous.combat declaration — " +
    "combat/base-combat-allocation.ts explicitly binds no Tank requirement"
);
test("Stormclaw Ursine: the merged program filter binder resolves the played source", () => {
  const filter = translateTriggerFilter(playedTrigger.trigger.filter, "ursine", playedTrigger.trigger.at);
  assert.deepEqual(filter, { event: "card-played", object: { objectId: "ursine" } });
  assert.doesNotThrow(() => assertTriggerSpec({ at: playedTrigger.trigger.at, filter }));
});

for (const controller of ["A", "B"]) {
  test(`Stormclaw Ursine: the authored body submits exhausted channeling for controller ${controller}`, () => {
    const initial = world().unit("ursine", { owner: controller })
      .rune(["own-top", "own-bottom"], { owner: controller })
      .rune("opponent-rune", { owner: controller === "A" ? "B" : "A" }).build();
    const kernel = initial.clone({ controller, sourceSnapshot: initial.getObject("ursine") });
    const submitted = [];
    const context = bindResolveContext(kernel, {
      perform: action => { submitted.push(action); return kernel.perform(action); }
    });
    const outcome = resolveChainBody(playedTrigger.body, context);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(submitted, [{ type: "channel-rune", player: controller, amount: 1, exhausted: true }]);
    assert.equal(outcome.linkedValues["stormclaw.channel.channeled"], 1);
    assert.deepEqual(outcome.events.map(event => event.action), ["channel-rune"]);
    assert.equal(kernel.getObject("own-top").zone, "rune-zone");
    assert.equal(kernel.getObject("own-bottom").zone, "rune-deck");
    assert.equal(kernel.getObject("opponent-rune").zone, "rune-deck");
    assert.equal(kernel.player(controller).runeDeckSize, 1);
  });
}

test("Stormclaw Ursine: channeled rune must actually enter exhausted (CR 431.2)", {
  todo: "effects/testing/test-kernel.ts channel-rune currently ignores action.exhausted; engine fix outside this card scope"
}, () => {
  const kernel = world().rune("top-rune").build();
  const outcome = resolveChainBody(playedTrigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("top-rune").zone, "rune-zone");
  assert.equal(kernel.getObject("top-rune").exhausted, true);
});
