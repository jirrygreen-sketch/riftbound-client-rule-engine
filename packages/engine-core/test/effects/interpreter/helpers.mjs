import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { runInstruction } from "../../../dist/effects/testing/index.js";

export const constant = value => ({ kind: "constant", value });
export const linked = (instructionId, key = "value") => ({ kind: "linked-value", instructionId, key });
export const property = (object, name) => ({ kind: "object-property", object, property: name });
export const compare = (left, operator, right) => ({ kind: "compare", left, operator, right });
export const instruction = (id, op, args = {}, extra = {}) => ({ id, op, args, ...extra });
export const gain = (id, amount = 1, extra = {}) => instruction(id, "test.gain", { amount: constant(amount) }, extra);
export const sequence = (id, body, extra = {}) => instruction(id, "sequence", { body: constant(body) }, extra);
export const repeat = (id, count, body) => instruction(id, "repeat", { count: constant(count), body: constant(body) });
export const optional = (id, body, args = {}) => instruction(id, "choice.optional", { body: constant(body), ...args });
export const value = (id, expression, extra = {}) => instruction(id, "condition.value", { value: expression, ...extra });
export const resultFor = (outcome, id) => outcome.results.find(result => result.id === id).result;

function actionResult(outcome) {
  if (outcome.status !== "done") {
    return { status: "negated", reason: outcome.status === "replaced" ? "replaced" : "impossible", events: [...outcome.events] };
  }
  return { status: "executed", events: [...outcome.events], linkedValues: { value: outcome.result ?? null } };
}

function definition(op, execute, parse = value => value) {
  return { op, argsSchema: { parse }, execute };
}

export const registry = new Map([
  definition("test.gain", (context, args) => actionResult(context.perform({
    type: "gain-energy", player: args.player ?? context.controller, amount: args.amount
  })), args => {
    if (typeof args.amount !== "number" || !Number.isFinite(args.amount)) throw new Error("Invalid amount");
    return args;
  }),
  definition("test.draw", (context, args) => actionResult(context.perform({ type: "draw", player: context.controller, amount: args.amount }))),
  definition("test.kill", (context, args) => actionResult(context.perform({ type: "kill", object: args.object ?? context.targets("unit")[0] }))),
  definition("test.damage", (context, args) => {
    const events = [];
    let damage = 0;
    for (const target of context.targets("unit")) {
      const outcome = context.perform({ type: "damage", target, amount: args.amount, combat: false });
      events.push(...outcome.events);
      if (outcome.status === "done") damage += outcome.result;
    }
    return { status: "executed", events, linkedValues: { damage } };
  }),
  definition("test.order", (context, args) => actionResult(context.perform({ type: "order-top", player: context.controller, objects: args.objects }))),
  definition("test.link", (context, args) => {
    const outcome = context.perform({ type: "gain-energy", player: context.controller, amount: args.amount });
    if (outcome.status === "done") context.link("X", outcome.result);
    return actionResult(outcome);
  }),
  definition("test.choose-gain", (context) => {
    const amount = context.choose({ id: "amount", type: "number", min: 1, max: 4, chooser: context.controller, visibility: "public" });
    return actionResult(context.perform({ type: "gain-energy", player: context.controller, amount }));
  }),
  definition("test.register", (context) => {
    context.addContinuous({ id: "lasting", layer: "arithmetic", filter: {}, effect: { kind: "might", value: constant(1) } }, { type: "end-of-turn" });
    context.registerDelayedTrigger({ at: "turn-end", filter: {} }, [gain("later")]);
    return actionResult(context.perform({ type: "gain-energy", player: context.controller, amount: 1 }));
  })
].map(entry => [entry.op, entry]));

export function transaction(body, world, answers = {}, selectedRegistry = registry) {
  let outcome;
  const definition = {
    op: "test.ability-transaction",
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = runAbilityBody(body, context, selectedRegistry);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  const run = runInstruction(definition, {}, { world, answers });
  return { ...run, outcome };
}
