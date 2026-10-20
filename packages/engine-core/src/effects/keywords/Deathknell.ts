import type { Ability, Instruction, TriggeredAbility } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef, KeywordParameterMap } from "../keyword-contract.js";

/**
 * Deathknell —— v1.5 规则 808（触发式能力关键词，仅存在于 Permanent 上）。
 *
 * 规则依据（Core Rules v1.5，/root/swarm-rift/shared/rules/CR-v1.5.txt）：
 * - 808.1 / 808.1.a：Deathknell 是触发式能力关键词，存在于 Permanent 上。
 * - 808.1.c：功能上等同于 "When I die, [Effect]."
 * - 808.1.d / 429.1 / 429.1.a.1.b：其触发条件是承载永久物被消灭（Killed）并送入 Trash，
 *   对应封闭时点枚举中的 object-killed（429.1.a.1.b：拥有 Deathknell 等自身死亡触发的
 *   单位被消灭时，触发在其离场前收集）。若死亡被替代（如召回），触发从链上移除
 *   （808.1.d.1），这由 chain / events 对替代结果的处理负责，不属于本展开。
 * - 808.1.d.2 / 808.1.d.3：触发在该卡进入 Trash 之前即作为 Pending Item 入链，并记录最后
 *   已知信息；由 object-killed 时点与触发系统的最后已知信息机制承载（时点定义见
 *   packages/engine-core/src/events/timing-points.ts）。
 * - 808.2 / 808.2.a：同一永久物上的每个 Deathknell 实例**各自独立**触发（控制者决定入链
 *   顺序）——因此 stacking: "separate"，每个关键词实例展开为一个独立的触发能力，**不**像
 *   Assault/Shield/Disarm 那样数值相加合并（对照 807.2 的求和规则仅适用于带数值的被动
 *   关键词）。
 * - 808.3：Deathknell 及其持有状态是永久物的特征，可被其他游戏效果检查或引用。
 *
 * 关键词与效果正文的边界（契约 3.7）：Deathknell 展开为一个 object-killed 订阅，
 * 结算体以 `trigger.leave` 作为离场/LKI 边界。调用方若已把该实例的正文放入
 * `params.body`，正文会紧接在边界指令后进入同一个 Pending Item。
 * 已合并的卡牌 IR 通常还会把印刷正文写成紧随关键词的真实 object-killed 触发；
 * `bindPrintedDeathknellBodies` 只在这种正文与关键词实例一一配对时消费该显式触发，
 * 防止同一句卡文生成两个 Pending Item。歧义或多个 Deathknell 实例保持分开并
 * fail-closed，不按卡名或数组位置猜正文。
 */
const deathknell = {
  keyword: "Deathknell",
  valued: false,
  stacking: "separate",
  expand({ host, params }: { readonly value?: number; readonly host: CardContextRef; readonly params?: KeywordParameterMap }) {
    const instructionId = `deathknell:${host.canonicalCardId}:leave`;
    const boundary: Instruction = {
      id: instructionId,
      op: "trigger.leave",
      args: {
        cause: { kind: "constant", value: "kill" }
      }
    };
    const body = [boundary, ...gatePayload(readPayload(params?.body), instructionId)];
    const ability: TriggeredAbility = {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        // Cause and destination are settlement facts.  The production filter
        // adapter intentionally accepts only the self object anchor here; the
        // trigger.leave primitive verifies that the source really died into
        // Trash before publishing the LKI links.
        filter: { self: true }
      },
      optional: false,
      body
    };
    return [ability] as readonly Ability[];
  },
  ruleRefs: [
    "808",
    "808.1",
    "808.1.a",
    "808.1.b",
    "808.1.c",
    "808.1.d",
    "808.1.d.1",
    "808.1.d.2",
    "808.1.d.3",
    "808.2",
    "808.2.a",
    "808.3",
    "429.1",
    "429.1.a.1.b"
  ]
} satisfies KeywordDef;

function readPayload(value: unknown): readonly Instruction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Deathknell params.body must be an instruction array");
  for (const instruction of value) {
    if (typeof instruction !== "object" || instruction === null || Array.isArray(instruction)) {
      throw new TypeError("Deathknell params.body contains a non-instruction value");
    }
    const candidate = instruction as unknown as Record<string, unknown>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0 ||
        typeof candidate.op !== "string" || typeof candidate.args !== "object" ||
        candidate.args === null || Array.isArray(candidate.args)) {
      throw new TypeError("Deathknell params.body contains an invalid instruction");
    }
  }
  return structuredClone(value) as unknown as readonly Instruction[];
}

function explicitlyAnchorsSelf(filter: unknown): boolean {
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) return false;
  const pattern = filter as Record<string, unknown>;
  if (pattern.self === true || pattern.source === "self" || pattern.role === "self" || pattern.controller === "self") return true;
  return typeof pattern.filter === "object" && pattern.filter !== null &&
    !Array.isArray(pattern.filter) && explicitlyAnchorsSelf(pattern.filter);
}

function explicitSelfDeathBody(ability: Ability): ability is TriggeredAbility {
  return ability.kind === "triggered" && ability.trigger.at === "object-killed" &&
    ability.trigger.filter !== undefined && explicitlyAnchorsSelf(ability.trigger.filter) &&
    ability.body.length > 0;
}

function isSelfAnchor(filter: unknown, depth = 0): boolean {
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) return false;
  const pattern = filter as Record<string, unknown>;
  const primary = Object.keys(pattern).every(key =>
    ["self", "source", "role", "controller", "event", "type", "kind", "filter"].includes(key)) &&
    (pattern.event === "object-killed" || pattern.type === "object-killed" || pattern.kind === "object-killed" ||
      pattern.event === undefined && pattern.type === undefined && pattern.kind === undefined);
  if (!primary) return false;
  const markers = [
    pattern.self === true,
    pattern.source === "self",
    pattern.role === "self",
    pattern.controller === "self",
  ].filter(Boolean).length;
  // The keyword boundary uses `{ self: true }`, while card IR commonly uses
  // `{ event: ..., filter: { source: "self" } }`. Accept exactly one self
  // marker at either level and no unrelated predicates.
  if (markers > 1) return false;
  if (pattern.filter !== undefined) {
    if (depth > 0 || markers === 1) return false;
    return isSelfAnchor(pattern.filter, depth + 1);
  }
  return markers === 1;
}

function sameTriggerShape(boundary: TriggeredAbility, printed: TriggeredAbility): boolean {
  const sameFilter = JSON.stringify(boundary.trigger.filter) === JSON.stringify(printed.trigger.filter) ||
    isSelfAnchor(boundary.trigger.filter) && isSelfAnchor(printed.trigger.filter);
  // The keyword boundary never carries a condition of its own. A printed
  // past-tense condition ("If I was Mighty", CR 808.1.c.2) belongs to the one
  // Deathknell trigger and is checked when that trigger is collected; any other
  // condition mismatch keeps the abilities separate.
  const compatibleCondition = boundary.trigger.condition === undefined ||
    JSON.stringify(boundary.trigger.condition) === JSON.stringify(printed.trigger.condition);
  return boundary.optional === printed.optional && sameFilter && compatibleCondition &&
    boundary.trigger.once === printed.trigger.once;
}

function keywordBoundary(ability: Ability): TriggeredAbility | null {
  if (ability.kind !== "triggered" || ability.trigger.at !== "object-killed" ||
      ability.body[0]?.op !== "trigger.leave" ||
      !ability.body[0].id.startsWith("deathknell:")) return null;
  return ability;
}

function isDeathknellKeyword(ability: Ability): ability is Extract<Ability, { kind: "keyword" }> {
  return ability.kind === "keyword" && ability.keyword.toLowerCase().replace(/[\s_-]+/g, "-") === "deathknell";
}

/**
 * Card IR can carry the printed `[Deathknell] -> [Effect]` text as a keyword
 * declaration followed by an explicit self-death trigger with that Effect.
 * Program expansion appends the keyword trigger separately. Bind one strictly
 * matching explicit trigger to the keyword boundary and consume it, preventing
 * the same printed text from becoming two Pending items. Different filters,
 * conditions, optionality, or bodies remain independent.
 */
export function bindPrintedDeathknellBodies(
  abilities: readonly Ability[],
  declaredAbilities: readonly Ability[] = []
): readonly Ability[] {
  const boundaries = abilities
    .map((ability, index) => ({ keyword: keywordBoundary(ability), index }))
    .filter((entry): entry is { keyword: TriggeredAbility; index: number } => entry.keyword !== null);
  const declarations = declaredAbilities.flatMap((ability, index) =>
    isDeathknellKeyword(ability) ? [index] : []);
  if (boundaries.length === 0 || boundaries.length !== declarations.length) return abilities;

  const consumed = new Set<Ability>();
  const replacements = new Map<number, TriggeredAbility>();
  for (const [instance, declarationIndex] of declarations.entries()) {
    const boundary = boundaries[instance]!.keyword;
    const instanceEnd = declarations[instance + 1] ?? declaredAbilities.length;
    // Only the declared segment between this Deathknell keyword and the next
    // keyword can carry its printed Effect. Two possible self-death bodies are
    // ambiguous, so neither is assigned to this instance.
    const candidates = declaredAbilities
      .slice(declarationIndex + 1, instanceEnd)
      .filter((candidate): candidate is TriggeredAbility =>
        explicitSelfDeathBody(candidate) && sameTriggerShape(boundary, candidate));
    if (candidates.length !== 1) continue;
    const payload = candidates[0]!;
    const boundaryInstruction = boundary.body[0]!;
    replacements.set(boundaries[instance]!.index, {
      ...boundary,
      trigger: payload.trigger.condition === undefined
        ? boundary.trigger
        : { ...boundary.trigger, condition: payload.trigger.condition },
      body: [boundaryInstruction, ...gatePayload(payload.body, boundaryInstruction.id)]
    });
    consumed.add(payload);
  }
  if (replacements.size === 0) return abilities;
  return abilities.flatMap((ability, index) =>
    consumed.has(ability) ? [] : [replacements.get(index) ?? ability]);
}

function gatePayload(payload: readonly Instruction[], boundaryId: string): readonly Instruction[] {
  if (payload.length === 0) return payload;
  const leaveGate = {
    kind: "expression" as const,
    value: {
      kind: "linked-value" as const,
      instructionId: boundaryId,
      key: "left"
    }
  };
  return payload.map(instruction => ({
    ...instruction,
    condition: instruction.condition === undefined
      ? leaveGate
      : { kind: "all" as const, conditions: [leaveGate, instruction.condition] }
  }));
}

export default deathknell;

