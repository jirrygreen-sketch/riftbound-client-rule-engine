import type {
  Expr,
  GameEvent,
  InstructionDef,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Value
} from "../contract.js";

/**
 * effect.order — 排序 / 放回牌库（P0 契约 3.6 原语规则 1–3；RIFT-9 调研第 4 节
 * "effect.order: 排序 / 放回牌库"，依赖 effect.zone / choice.order）。
 *
 * 语义：把一组指定的对象以给定顺序放回其 owner 牌库的顶部或底部。
 *
 * args（值一律为 card-dsl 的 Expr，经 ctx.evaluate() 求值）：
 * - player（可选）：动作归属玩家（选择者 / 牌库主人）。表达式须求值为
 *   PlayerId；缺省为 ctx.controller。若 cards/cardsPick 提供了显式选择，选中
 *   对象必须属于该玩家，否则本条 ignored。
 * - destination（必填）："top" 或 "bottom"。
 * - count（可选，默认 1，须 ≥ 0）：从玩家牌库顶部取出多少张进行放回（经
 *   ctx.zoneSlice(player, "deck", "top", count) 按真实区域内顺序取顶）。
 *   仅在未提供 cards / cardsPick 时使用；少于 count 张则取走全部
 *   （compare 437.4 "as many as possible"）。count 为 0 时不产生任何动作，
 *   返回 executed 且链接 ordered 为 0。
 * - cards（可选）：TargetSpec id，经 ctx.targets(cards) 取回要放回的对象
 *   （选目标）；与 cardsPick 互斥。
 * - cardsPick（可选）：PickSpec id，经 ctx.picks(cardsPick) 取回要放回的对象
 *   （非目标选择，v1.5 pick 不触发“成为目标”，契约 3.4）。
 * - chooseOrder（可选，布尔，默认 true）：多张牌时是否经
 *   ctx.choose({ type: "order" }) 让选择者决定顺序（choice.order）。
 *   437.1.a“putting the rest back on top of their Main Deck in any order” —
 *   Predict / Vision（817.1.b）等“in any order”的放回由玩家排序；false 时
 *   按取回顺序确定性地放回（由规则或卡牌决定顺序的场景）。
 *
 * v1.5 条目：437.1.a（多张放回顶部时 in any order）、417.1 / 417.5.a（放回
 * 底部的归属与排序模型；本原语不复用 recycle 动作，因为 Recycle 保持其随机
 * 序语义）。
 *
 * 边界：本原语只覆盖“放回顶部 / 底部并定序”。Recycle（417）由
 * effect.recycle 经 perform({ type: "recycle" }) 处理；任意区域间移动由
 * effect.zone 的 move-zone 处理；洗牌用 perform({ type: "shuffle" })。
 * 顶 / 底顺序确定性的差异全部收敛在本原语。
 *
 * 结果（契约 3.6 原语规则 2）：任一 perform 为 replaced / prevented /
 * impossible → negated；cards 集合解析后为空（目标 / picks 全部失效或不匹配
 * 牌库）→ ignored（reason "mistargeted"）。全部 done → executed，并
 * ctx.link("ordered", 实际张数) 供 "if you do" 链接。
 */
export interface EffectOrderArgs {
  readonly player?: Expr;
  readonly destination: Expr;
  readonly count?: Expr;
  readonly cards?: Expr;
  readonly cardsPick?: Expr;
  readonly chooseOrder?: Expr;
}

interface NormalizedArgs {
  readonly player: PlayerId;
  readonly destination: "top" | "bottom";
  readonly count: number;
  readonly cards?: string;
  readonly cardsPick?: string;
  readonly chooseOrder: boolean;
}

function invalid(message: string): never {
  throw new Error("effect.order args: " + message);
}

function expectExpr(value: unknown, field: string, optional: boolean): Expr | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    return invalid(field + " is required");
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return invalid(field + " must be an Expr object");
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  if (typeof kind !== "string" || kind.length === 0) {
    return invalid(field + " must be an Expr with a string kind");
  }
  return value as Expr;
}

function parseArgs(value: unknown): EffectOrderArgs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("args must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    destination: expectExpr(record.destination, "destination", false)!,
    player: expectExpr(record.player, "player", true),
    count: expectExpr(record.count, "count", true),
    cards: expectExpr(record.cards, "cards", true),
    cardsPick: expectExpr(record.cardsPick, "cardsPick", true),
    chooseOrder: expectExpr(record.chooseOrder, "chooseOrder", true)
  };
}

function asString(value: Value, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(field + " must evaluate to a non-empty string");
  }
  return value;
}

function normalize(ctx: ResolveContext, args: EffectOrderArgs): NormalizedArgs {
  const player = args.player === undefined
    ? ctx.controller
    : asString(ctx.evaluate(args.player), "player");
  const destinationValue = asString(ctx.evaluate(args.destination), "destination");
  if (destinationValue !== "top" && destinationValue !== "bottom") {
    invalid('destination must be "top" or "bottom", got ' + destinationValue);
  }
  const destination = destinationValue as "top" | "bottom";
  let count = 1;
  if (args.count !== undefined) {
    const evaluated = ctx.evaluate(args.count);
    if (typeof evaluated !== "number" || !Number.isSafeInteger(evaluated) || evaluated < 0) {
      invalid("count must evaluate to a non-negative integer, got " + String(evaluated));
    }
    count = evaluated;
  }
  const cards = args.cards === undefined ? undefined : asString(ctx.evaluate(args.cards), "cards");
  const cardsPick = args.cardsPick === undefined ? undefined : asString(ctx.evaluate(args.cardsPick), "cardsPick");
  if (cards !== undefined && cardsPick !== undefined) {
    invalid("cards and cardsPick are mutually exclusive");
  }
  let chooseOrder = true;
  if (args.chooseOrder !== undefined) {
    const evaluated = ctx.evaluate(args.chooseOrder);
    if (typeof evaluated !== "boolean") {
      invalid("chooseOrder must evaluate to a boolean");
    }
    chooseOrder = evaluated;
  }
  return { player, destination, count, cards, cardsPick, chooseOrder };
}

function cloneRef(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

interface CandidateSet {
  readonly refs: readonly ObjectRef[];
  readonly fromSelection: boolean;
}

function resolveCandidates(ctx: ResolveContext, args: NormalizedArgs): CandidateSet {
  if (args.cards !== undefined || args.cardsPick !== undefined) {
    const raw = args.cards !== undefined ? ctx.targets(args.cards) : ctx.picks(args.cardsPick!);
    const refs = raw
      .filter((entry): entry is ObjectRef =>
        typeof entry === "object" && entry !== null && "id" in entry && "zoneEntryId" in entry)
      .map(cloneRef);
    return { refs, fromSelection: true };
  }
  if (args.count === 0) return { refs: [], fromSelection: false };
  // 按牌库真实顶部顺序取 count 张（zoneSlice；query 不保证顺序）。
  const candidates = ctx.zoneSlice(args.player, "deck", "top", args.count)
    .map(snapshot => cloneRef(snapshot.ref));
  return { refs: candidates, fromSelection: false };
}

export default {
  op: "effect.order",
  argsSchema: { parse: parseArgs },
  execute(ctx, rawArgs) {
    const args = normalize(ctx, rawArgs);
    const { refs, fromSelection } = resolveCandidates(ctx, args);

    if (refs.length === 0) {
      if (fromSelection) {
        // 目标 / picks 全部失效或不匹配牌库：契约 3.6 原语规则 2 → ignored。
        return { status: "ignored", reason: "mistargeted" };
      }
      // count 为 0 或牌库为空：无事可做，按成功结算并链接 0（compare 437.4）。
      ctx.link("ordered", 0);
      return { status: "executed", events: [], linkedValues: { ordered: 0 } };
    }
    // 校验：引用必须仍然有效、属于归属玩家、且当前在对应牌库（先离区者按失效
    // 处理——离区后旧 zoneEntryId 失效，ctx.object 返回 null）。
    const live: ObjectRef[] = [];
    for (const ref of refs) {
      const snapshot = ctx.object(ref);
      if (snapshot === null) continue;
      if (snapshot.owner !== args.player || snapshot.zone !== "deck") continue;
      if (!live.some(candidate => sameRef(candidate, ref))) live.push(cloneRef(ref));
    }
    if (live.length === 0) {
      return { status: "ignored", reason: "mistargeted" };
    }

    // 顶部 / 底部：多张且 chooseOrder 时由选择者定序（choice.order；437.1.a）。
    let ordered = live;
    if (live.length > 1 && args.chooseOrder) {
      const request = {
        id: "effect.order:" + args.destination + ":" + args.player,
        type: "order" as const,
        options: live.map(cloneRef),
        chooser: args.player,
        visibility: "chooser-only" as const,
        prompt:
          "Put back " + String(live.length) + " card(s) on the " + args.destination +
          " of your Main Deck in any order"
      };
      const answer = ctx.choose<ObjectRef[]>(request);
      if (!Array.isArray(answer) || answer.length !== live.length ||
          answer.some(ref => typeof ref !== "object" || ref === null ||
            !live.some(candidate => sameRef(candidate, ref))) ||
          new Set(answer.map(ref => JSON.stringify([ref.id, ref.zoneEntryId]))).size !== live.length) {
        invalid("order answer must be an exact permutation of the available references");
      }
      ordered = answer.map(cloneRef);
    }

    if (args.destination === "top") {
      const outcome = ctx.perform({
        type: "order-top",
        player: args.player,
        objects: ordered,
        zone: "deck"
      });
      if (outcome.status !== "done") {
        return {
          status: "negated",
          reason: outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible",
          events: [...outcome.events]
        };
      }
      ctx.link("ordered", ordered.length);
      return {
        status: "executed",
        events: [...outcome.events],
        linkedValues: { ordered: ordered.length }
      };
    }

    // Move each card to deck-bottom in the requested order. A negated action
    // preserves earlier moves and does not prevent later ones (CR 055 /
    // 359.3.e.11); exceptions are rolled back by the enclosing transaction.
    const events: GameEvent[] = [];
    let moved = 0;
    let failure: "replaced" | "skipped" | "impossible" | undefined;
    for (const ref of ordered) {
      const outcome = ctx.perform({ type: "move-zone", object: ref, to: "deck-bottom" });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        failure ??= outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible";
      } else moved++;
    }
    ctx.link("ordered", moved);
    return failure === undefined
      ? { status: "executed", events, linkedValues: { ordered: moved } }
      : { status: "negated", reason: failure, events };
  }
} satisfies InstructionDef<EffectOrderArgs>;
