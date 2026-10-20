// Shared production-path fixture for card goldens (README section 4, layer 3).
//
// The original registry programs are bound with createProgramBinding and a
// real ChainEngine whose describePlay comes from that binding, so a play goes
// through the same speed, target-lock, cost-payment, pass and Resolve path a
// match uses. Choices are answered from `answers` (by request id prefix) or,
// for select-objects requests with exactly as many options as required, by
// taking those options; anything else throws so an unexpected prompt fails.
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { world } from "../../../engine-core/dist/effects/testing/index.js";

export { world };

export function productionPlay({ programs, build, turnPlayer = "A", answers = {} }) {
  const kernel = build(world()).build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    for (const [prefix, answer] of Object.entries(answers)) {
      if (!request.id.startsWith(prefix)) continue;
      return typeof answer === "function" ? answer(kernel, request) : answer.map(id => kernel.ref(id));
    }
    if (request.type === "select-objects" && request.options.length === request.min) return request.options;
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: turnPlayer === "A" ? ["A", "B"] : ["B", "A"],
    turnPlayer,
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const describe = (id, player = "A") => {
    const source = kernel.getObject(id);
    return binding.describePlay({ type: "play", object: source.ref, player }, source);
  };
  const settle = () => {
    for (let guard = 0; engine.items.length; guard++) {
      if (guard > 20) throw new Error("Chain did not settle");
      engine.pass(engine.priority);
    }
  };
  const play = (id, player = "A") => {
    const draft = describe(id, player);
    engine.execute(draft);
    settle();
    return draft;
  };
  const might = id => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref(id)).might;
  };
  const targetRequests = () => requests.filter(request => request.type === "select-objects");
  return { kernel, engine, binding, requests, targetRequests, describe, play, settle, might };
}
