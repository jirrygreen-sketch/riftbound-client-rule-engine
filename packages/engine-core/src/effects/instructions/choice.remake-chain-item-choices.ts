/**
 * Re-open the relevant Finalize choices of a finalized Chain item (CR v1.5
 * 750-755). The primitive validates the closed choice classes and delegates to
 * the chain owner through a versioned optional capability. It cannot mutate a
 * ChainItem directly: that plan is private to ChainEngine, and the frozen
 * ResolveContext exposes no finalized-item plan or setter. Missing capability,
 * missing targets, or an incomplete remade plan fail closed.
 */
import type { Expr, InstructionDef, InstructionResult, ObjectRef, ResolveContext, Value } from "../contract.js";

export const CHAIN_CHOICE_REMAKE_CAPABILITY = Symbol.for("riftbound.chain-choice-remake.v1");
export type ChainChoiceClass = "location" | "mode" | "destination" | "target";

export interface ChainChoiceRemakeRequest {
  readonly item: ObjectRef;
  readonly choices: readonly ChainChoiceClass[];
  readonly remakeAll: true;
  readonly chooser: string;
}

export interface ChainChoiceRemakeResult {
  readonly status: "executed" | "ignored" | "negated";
  readonly item?: ObjectRef;
  readonly choices?: readonly ChainChoiceClass[];
  readonly targets?: readonly ObjectRef[];
  readonly modes?: readonly string[];
  readonly locations?: readonly Value[];
  readonly reason?: string;
}

export interface ChainChoiceRemakeCapability {
  readonly version: typeof CHAIN_CHOICE_REMAKE_CAPABILITY;
  remake(request: ChainChoiceRemakeRequest): ChainChoiceRemakeResult;
}

export interface RemakeChainItemChoicesArgs {
  readonly item: Expr;
  readonly choices: Expr;
  readonly remakeAll?: Expr;
  readonly chooser?: Expr;
  readonly linkKey?: Expr;
}

const CHOICE_CLASSES: readonly ChainChoiceClass[] = ["location", "mode", "destination", "target"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) && Number(value.zoneEntryId) >= 0;
}
function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function parseArgs(value: unknown): RemakeChainItemChoicesArgs {
  if (!isRecord(value) || !Object.hasOwn(value, "item") || !Object.hasOwn(value, "choices")) {
    throw new TypeError("choice.remake-chain-item-choices requires item and choices");
  }
  const allowed = ["item", "choices", "remakeAll", "chooser", "linkKey"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) throw new TypeError("Invalid choice.remake-chain-item-choices argument: " + key);
  }
  return { ...value } as unknown as RemakeChainItemChoicesArgs;
}

function refs(value: unknown): ObjectRef[] {
  if (isRef(value)) return [{ ...value }];
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(refs);
}

function capability(ctx: ResolveContext): ChainChoiceRemakeCapability | null {
  const candidate = (ctx as ResolveContext & { readonly [CHAIN_CHOICE_REMAKE_CAPABILITY]?: unknown })[CHAIN_CHOICE_REMAKE_CAPABILITY];
  if (!isRecord(candidate) || candidate.version !== CHAIN_CHOICE_REMAKE_CAPABILITY || typeof candidate.remake !== "function") return null;
  return candidate as unknown as ChainChoiceRemakeCapability;
}

function execute(ctx: ResolveContext, args: RemakeChainItemChoicesArgs): InstructionResult {
  const itemValue = ctx.evaluate(args.item);
  const item = refs(itemValue)[0];
  if (item === undefined || ctx.object(item)?.zone !== "chain") return { status: "ignored", reason: "mistargeted" };
  const requested = ctx.evaluate(args.choices);
  if (!Array.isArray(requested) || requested.length === 0 || requested.some(choice => !CHOICE_CLASSES.includes(choice as ChainChoiceClass)) ||
      new Set(requested).size !== requested.length) throw new TypeError("choice.remake-chain-item-choices choices must be a unique nonempty subset of location, mode, destination, target");
  const choices = requested as ChainChoiceClass[];
  const remakeAll = args.remakeAll === undefined ? true : ctx.evaluate(args.remakeAll);
  if (remakeAll !== true) throw new TypeError("choice.remake-chain-item-choices requires remakeAll true");
  const chooserValue = args.chooser === undefined ? ctx.controller : ctx.evaluate(args.chooser);
  if (!isId(chooserValue)) throw new TypeError("choice.remake-chain-item-choices chooser must be a nonempty PlayerId");
  const linkKey = args.linkKey === undefined ? "remadeChoices" : ctx.evaluate(args.linkKey);
  if (!isId(linkKey)) throw new TypeError("choice.remake-chain-item-choices linkKey must be a nonempty string");
  const adapter = capability(ctx);
  if (adapter === null) {
    const blocked: Value = { amount: 0, item: { ...item }, choices, blockedReason: "chain-choice-remake-capability-unavailable" };
    ctx.link(linkKey, blocked);
    return { status: "negated", reason: "impossible", events: [] };
  }
  const result = adapter.remake({ item, choices, remakeAll: true, chooser: chooserValue });
  if (result.status === "ignored") return { status: "ignored", reason: "mistargeted" };
  if (result.status === "negated") {
    const blocked: Value = { amount: 0, item: { ...item }, choices, blockedReason: result.reason ?? "chain-choice-remake-negated" };
    ctx.link(linkKey, blocked);
    return { status: "negated", reason: "impossible", events: [] };
  }
  const receipt: Value = {
    amount: 1,
    item: { ...(result.item ?? item) },
    choices: [...(result.choices ?? choices)],
    targets: (result.targets ?? []).map(ref => ({ ...ref })),
    modes: [...(result.modes ?? [])],
    locations: [...(result.locations ?? [])],
  };
  ctx.link(linkKey, receipt);
  return { status: "executed", events: [], linkedValues: { [linkKey]: receipt } };
}

export default {
  op: "choice.remake-chain-item-choices",
  argsSchema: { parse: parseArgs },
  execute,
} satisfies InstructionDef<RemakeChainItemChoicesArgs>;
