import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/arise.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";

const CARD_ID = "card.hash-390865ebc7ca61e906a68cd399d7f1300d7ddcba26677e93cbba334e99b8dee9";
const SOURCE_TEXT =
  "Play a 2 :rb_might: Sand Soldier unit token for each Equipment you control. " +
  "Then ready two of them.";

const [play] = program.abilities;
const [playTokens, readyTwo] = play.body;
// The token destination is chosen by the play procedure's Finalize (355.2), so
// the card file deliberately carries no locations list; the goldens supply the
// destination that player chose, exactly as they supply locked targets.
const chosenBase = { type: "base", player: "A" };

/** Mirrors chain/engine.ts's query normalization of "self"/"opponent". */
function chainKernel(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              // The production matcher (layers/filter.ts) understands the
              // "opponent" selector; the reference kernel compares literally, so
              // the key is dropped here and applied as a filter below.
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

/**
 * The card's own arguments plus the two values the production play procedure
 * supplies: the token's Finalize-chosen destination (355.2) and the option
 * request id that goes with it. `amount` is an Expr — the card's count
 * expression stays untouched wherever the test does not need a fixed number.
 */
const tokenArgs = (amount) => ({
  ...playTokens.args,
  amount,
  locations: { kind: "constant", value: [chosenBase] },
  choiceId: { kind: "constant", value: "arise.location" }
});
const equipmentCount = playTokens.args.amount;

test("sfd-198-221 Arise!: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-198-221 Arise!: judgeReason names the destination gap and its dependencies", () => {
  // README section 2: the reason must name the missing form, the rule basis and
  // the dependent work instead of restating "unsupported".
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /effect\.token/);
  // It must not claim a workaround it does not have.
  assert.doesNotMatch(program.judgeReason, /近似实现：/);
});

test("sfd-198-221 Arise! structure: token count by Equipment, then a linked ready-two", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["arise.play-sand-soldiers", "effect.token"],
    ["arise.ready-two", "effect.ready"]
  ]);

  // CR 187.3: the frozen "sand-soldier" token definition (2 Might, Shurima).
  assert.deepEqual(playTokens.args.token, { kind: "constant", value: "sand-soldier" });
  // 440.2.c / 185.2.a / RIFT-62: a played token is created on the Chain first.
  assert.deepEqual(playTokens.args.mode, { kind: "constant", value: "play" });
  // "for each Equipment you control": a resolve-time count over the
  // controller's Equipment-tagged gear (150/150.1/150.5), not a target.
  assert.deepEqual(playTokens.args.amount, {
    kind: "count",
    subject: "gear",
    filter: { type: "gear", tags: ["Equipment"], controller: "self" }
  });
  assert.equal(playTokens.targets, undefined);
  assert.equal(playTokens.picks, undefined);
  assert.equal(playTokens.linkedTo, undefined);
  assert.deepEqual(playTokens.args.linkKey, { kind: "constant", value: "sandSoldiers" });
  // The destination is a Finalize-time play choice (355.2/355.2.a); naming one
  // in the data would invent the player's choice, so the file carries none.
  assert.equal(playTokens.args.locations, undefined);
  assert.equal(playTokens.args.location, undefined);

  // "Then ready two of them": "them" is the created tokens (359.3.e.14), so the
  // instruction reads the token receipt; two is an upper bound (359.3.e.11).
  assert.equal(readyTwo.linkedTo, "arise.play-sand-soldiers");
  assert.deepEqual(readyTwo.args.objects, {
    kind: "linked-value",
    instructionId: "arise.play-sand-soldiers",
    key: "sandSoldiers"
  });
  assert.deepEqual(readyTwo.args.amount, { kind: "constant", value: 2 });
  assert.equal(readyTwo.targets, undefined);
  assert.equal(readyTwo.picks, undefined);

  // Both declared ops really are the merged registry entries.
  assert.equal(instructionDefinitionsById.get("effect.token"), token);
  assert.equal(instructionDefinitionsById.get("effect.ready"), ready);
});

test("sfd-198-221 Arise! golden: one Sand Soldier per Equipment you control, two of them readied", () => {
  const kernel = world()
    .unit("equipment-1", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .unit("equipment-2", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .unit("enemy-equipment", { owner: "B", controller: "B", types: ["gear"], tags: ["Equipment"] })
    .build();

  const outcome = resolveChainBody(
    [
      { ...playTokens, args: tokenArgs(equipmentCount) },
      readyTwo
    ],
    chainKernel(kernel)
  );

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["arise.play-sand-soldiers", "executed"],
      ["arise.ready-two", "executed"]
    ]
  );

  const tokens = kernel.query({}).filter((object) => object.isToken);
  // "for each Equipment you control" counts only the controller's two, never
  // the opponent's.
  assert.equal(tokens.length, 2);
  for (const created of tokens) {
    // CR 187.3: "Sand Soldier" is a 2 Might Shurima unit token; 185.3.a keeps
    // its energy/power absent (null), never 0.
    assert.equal(created.name, "Sand Soldier");
    assert.equal(created.might, 2);
    assert.deepEqual(created.tags, ["Shurima"]);
    assert.deepEqual(created.types, ["unit"]);
    assert.equal(created.energy, null);
    assert.equal(created.power, null);
    assert.deepEqual(created.location, chosenBase);
  }
  // 440.2.c / 185.2.a: every token is created on the Chain and then played, so
  // both enter ready-to-be-readied and the receipt reports the post-play refs.
  assert.deepEqual(outcome.events.map((event) => event.action), [
    "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(
    outcome.linkedValues["arise.play-sand-soldiers.sandSoldiers"].objects,
    tokens.map((created) => created.ref)
  );
});

test("sfd-198-221 Arise! golden: ready two of them readies two of the produced tokens", () => {
  const kernel = world()
    .unit("equipment-1", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .unit("equipment-2", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .unit("equipment-3", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .build();
  const created = resolveChainBody(
    [{ ...playTokens, args: tokenArgs(equipmentCount) }],
    chainKernel(kernel)
  );
  assert.equal(created.status, "executed");
  const produced = kernel.query({}).filter((object) => object.isToken);
  assert.equal(produced.length, 3);
  // Units enter the Board exhausted (143.4 / 359.2.c). The reference kernel's
  // create/play path does not model that entry state, so the test performs the
  // real exhaust action on the three produced tokens before the ready half —
  // exactly the state the printed card would find them in.
  for (const createdToken of produced) kernel.perform({ type: "exhaust", object: createdToken.ref });
  assert.deepEqual(
    produced.map((createdToken) => kernel.getObject(createdToken.ref.id).exhausted),
    [true, true, true]
  );

  // "Then ready two of them": the instruction in the card file reads the token
  // instruction's receipt (linkedTo), and effect.ready consumes the object list
  // in it. amount 2 caps the ready at two of the three tokens (359.3.e.11).
  // The linked "them" edge is only visible inside the same execution, so the
  // card body runs the way it really resolves: the ready instruction reads the
  // receipt of the token instruction it is linked to.
  const readied = runInstruction(
    ready,
    {
      objects: created.linkedValues["arise.play-sand-soldiers.sandSoldiers"],
      amount: readyTwo.args.amount
    },
    { world: kernel }
  );
  assert.equal(readied.result.status, "executed");
  assert.deepEqual(readied.linked.readied, {
    count: 2,
    objects: produced.slice(0, 2).map((createdToken) => createdToken.ref)
  });
  assert.deepEqual(readied.events.map((event) => event.action), ["ready", "ready"]);
  assert.deepEqual(
    produced.map((createdToken) => kernel.getObject(createdToken.ref.id).exhausted),
    [false, false, true]
  );
  // Nothing is left on the Chain: every token was created there and then played
  // as a Limited Action (440.2.c / 185.2.a / 420.3).
  assert.deepEqual(kernel.pendingItems, []);
});

test("sfd-198-221 Arise! golden: no Equipment means no tokens and nothing to ready", () => {
  const kernel = world().unit("a-unit", { owner: "A", controller: "A" }).build();
  const outcome = resolveChainBody(
    [{ ...playTokens, args: tokenArgs(equipmentCount) }, readyTwo],
    chainKernel(kernel)
  );

  // The token half has an amount of 0, so it performs no action and still
  // resolves (359.3.e.11): the receipt reports zero tokens. The linked ready
  // then has no reference to work on, and an empty reference list makes
  // effect.ready ignore the instruction (contract 3.3: an instruction with no
  // usable object is ignored rather than turned into a no-op success).
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["arise.play-sand-soldiers", "executed"],
      ["arise.ready-two", "ignored"]
    ]
  );
  assert.equal(kernel.query({}).filter((object) => object.isToken).length, 0);
  assert.deepEqual(outcome.linkedValues["arise.play-sand-soldiers.sandSoldiers"].amount, 0);
  assert.deepEqual(outcome.linkedValues["arise.play-sand-soldiers.sandSoldiers"].objects, []);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.pendingItems, []);
});

test("sfd-198-221 Arise! golden: a prevented play keeps the tokens that already entered", () => {
  const kernel = world()
    .unit("equipment-1", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .unit("equipment-2", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"] })
    .build();
  // The second play is prevented: contract 3.6 rule 2 negates the instruction
  // while the receipt still reports the tokens that already entered play and
  // the one that was created on the Chain for the failed play.
  kernel.addReplacement((action, context) =>
    action.type === "play" && context.query({ zone: "board" }).filter((object) => object.isToken).length === 1
      ? "prevented"
      : null
  );

  const run = runInstruction(
    token,
    // `equipmentCount` is the card's count expression; the running player's two
    // Equipment resolve to a concrete amount of two for this scenario, which the
    // hook below relies on to prevent the second play.
    { ...tokenArgs({ kind: "constant", value: 2 }) },
    { world: kernel }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  // token.amount counts completed plays; createdAmount counts the Chain
  // creations, and the created-but-unplayed token is not reported as an object
  // that entered play (the primitive's own receipt contract).
  assert.equal(run.linked["sandSoldiers.amount"], 1);
  assert.equal(run.linked["sandSoldiers.createdAmount"], 2);
  assert.deepEqual(run.linked["sandSoldiers.objects"], [{ id: "token-1", zoneEntryId: 2 }]);
  assert.deepEqual(run.linked["sandSoldiers.createdObjects"], [
    { id: "token-1", zoneEntryId: 1 },
    { id: "token-2", zoneEntryId: 1 }
  ]);
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play", "create-token", "play"]);
  assert.equal(kernel.query({ zone: "board" }).filter((object) => object.isToken).length, 1);
  assert.equal(kernel.query({ zone: "chain" }).filter((object) => object.isToken).length, 1);
});

test.todo(
  "Arise!: bind each created Sand Soldier to its legal play-location choice and token program in production Finalize (355.2/440.2.c); location querying already works"
);

test.todo(
  "Arise!: verify the whole spell and token plays through production Finalize after token location/program binding, retaining printed 6 Energy and 1 Calm Power (356.1.c)"
);


test("Arise!: the merged location query supplies only its controller's base or controlled battlefields", () => {
  const kernel = world().player("A").player("B").build();
  const mine = { type: "battlefield", id: "mine" };
  const locations = [
    { ref: mine, controller: "A" },
    { ref: { type: "battlefield", id: "theirs" }, controller: "B" },
    { ref: { type: "battlefield", id: "open" }, controller: null, occupied: false }
  ];
  assert.deepEqual(queryLocationCandidates(kernel, { controller: "controller" }, { players: ["A", "B"], locations }),
    [mine, { type: "base", player: "A" }]);
});

test("Arise!: its unchanged printed cost is read by the merged planner and actually paid", () => {
  const base = world().player("A", { energy: 6, power: ["Calm"] })
    .hand("arise", { types: ["spell"], energy: 6, power: ["Calm"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("arise") });
  assert.equal(play.cost, undefined);
  const plan = buildCostPlan(kernel, { id: "arise.play", cost: { kind: "printed" } });
  assert.equal(plan.total.energy, 6);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Calm"] }]);
  const run = runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.payment.paid, true);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(run.linked.payment.actions[0].action.plan.power, ["Calm"]);
  assert.equal(kernel.getObject("arise").energy, 6);
  assert.deepEqual(kernel.getObject("arise").power, ["Calm"]);
});
