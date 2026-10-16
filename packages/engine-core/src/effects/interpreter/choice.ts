import type { ChoiceRequest, ObjectRef, ResolveContext, Value } from "../contract.js";
import { equalValues, integer, record, string } from "./values.js";
import { objectRef } from "./history.js";

export function choiceMetadata(args: Readonly<Record<string, Value>>, context: ResolveContext) {
  const chooser = args.chooser === undefined ? context.controller : string(args.chooser, "Chooser");
  const visibility = args.visibility ?? "public";
  if (visibility !== "public" && visibility !== "chooser-only"
    && !(Array.isArray(visibility) && visibility.every(player => typeof player === "string"))) {
    throw new Error("Invalid choice visibility");
  }
  return {
    chooser,
    visibility: visibility as ChoiceRequest<unknown>["visibility"],
    ...(args.prompt === undefined ? {} : { prompt: string(args.prompt, "Choice prompt") })
  };
}

export function optionalChoice(args: Readonly<Record<string, Value>>, context: ResolveContext): boolean {
  const answer = context.choose<boolean>({ id: "optional", type: "optional", ...choiceMetadata(args, context) });
  if (typeof answer !== "boolean") throw new Error("Optional choice answer must be boolean");
  return answer;
}

export function modeChoices(ids: readonly string[], args: Readonly<Record<string, Value>>, context: ResolveContext): string[] {
  const count = integer(args.count ?? 1, "Mode count");
  const different = args.different ?? true;
  if (typeof different !== "boolean") throw new Error("different must be boolean");
  if (new Set(ids).size !== ids.length) throw new Error("Mode ids must be unique");
  if ((different && count > ids.length) || (count > 0 && ids.length === 0)) throw new Error("Not enough modes");
  const selected: string[] = [];
  for (let index = 0; index < count; index++) {
    const options = ids.filter(id => !different || !selected.includes(id));
    const answer = context.choose<string>({ id: `mode:${index}`, type: "mode", options, ...choiceMetadata(args, context) });
    if (!options.includes(answer)) throw new Error("Invalid mode choice answer");
    selected.push(answer);
  }
  return selected;
}

export function orderedObjects(value: unknown, args: Readonly<Record<string, Value>>, context: ResolveContext): ObjectRef[] {
  if (!Array.isArray(value)) throw new Error("Order options must be an array");
  const options = value.map(objectRef);
  const keys = options.map(ref => JSON.stringify(ref));
  if (new Set(keys).size !== keys.length) throw new Error("Order options must be unique");
  const answer: unknown = context.choose<ObjectRef[]>({ id: "order", type: "order", options, ...choiceMetadata(args, context) });
  if (!Array.isArray(answer) || answer.length !== options.length) throw new Error("Order answer must be a permutation");
  const remaining = [...options];
  const ordered = answer.map(value => {
    const ref = objectRef(value);
    const index = remaining.findIndex(option => equalValues({ ...option }, { ...ref }));
    if (index === -1) throw new Error("Order answer must be a permutation");
    remaining.splice(index, 1);
    return ref;
  });
  return ordered;
}

export function modeBodies(value: unknown): { readonly id: string; readonly body: unknown }[] {
  if (!Array.isArray(value)) throw new Error("Modes must be an array");
  return value.map(value => {
    const mode = record(value, "Mode");
    return { id: string(mode.id, "Mode id"), body: mode.body };
  });
}
