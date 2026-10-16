import type { ObjectRef } from "@riftbound/card-dsl";
import type {
  GameEvent,
  InstructionDef,
  ObjectSnapshot,
  ResolveContext,
  Schema
} from "../contract.js";

/**
 * effect.detach — 脱离装备（Detach, CR-v1.5 规则 436）。
 *
 * 语义（CR-v1.5 引用）：
 * - 436.1 / 436.1.b：Detach 是解除两张通过 Attach 关联的卡牌；被脱离的牌不再是
 *   Attached 状态，宿主可能因此不再是 Top-Most Card。
 * - 436.1.a / 436.1.a.1：Detach 只影响当前正 Attached 到其他卡的牌；对未附着的牌
 *   执行 Detach 什么也不做。本原语把它视为一个不可能的 `detach` 游戏动作，
 *   按契约 3.6 原语规则 2 返回 `negated`（reason: "impossible"），而不是
 *   `executed`——“if you do” 之类的链接指令不应在没有任何东西被脱离时成立。
 * - 436.2 / 436.2.a：Detach 是 Limited Action，只能由游戏效果指示——本原语就是
 *   那个入口；动作记录进 history 由内核负责。
 * - 436.3：Detach 本身不选择目标；指定要脱离哪张牌的效果（如 sfd-107-221
 *   Strike Down 的 "detach an Equipment from it"）是非目标选择，IR 必须用
 *   `pick` 而不是 `target`，本原语经 `ctx.picks()` 读取，不触发
 *   “成为目标”类触发。
 * - 436.4：脱离后的牌位置与脱离时宿主所在位置一致（Gear 因此出现在战场会在下个
 *   清理被 Recall，436.4.a）。位置维护由内核/引擎在 `detach` 动作里完成，本原语
 *   不直接改状态。
 * - 与相近原语的边界（RIFT-9 调研：独立于杀死装备）：宿主离场（kill / 回手等）
 *   导致的连带脱离是规则 719.5 的区域变动后果，由引擎/内核处理，**不经过**本
 *   原语，也不产生本指令的事件。附着对象因变成单位而立即脱离
 *   （435.1.h.2 / 718.6.a）同样是状态检查的后果，不属于本原语。本原语只实现
 *   “效果指示脱离一张牌”这一种路径；杀死装备用 effect.kill，重附着用
 *   effect.attach（435.1.f 的换绑由 attach 内核动作处理）。
 *
 * 参数（args）：
 * - `pick`（string，可选）：PickSpec id。存在时经 `ctx.picks(pick)` 取回 0..n
 *   个引用，每个都执行一次 `detach`。IR 生成端必须保证 pick 的候选在源单位有
 *   附着牌时非空——436.3 把 "detach an Equipment from it" 建模为非目标选择，
 *   所以候选为空（宿主不再有附着牌）不会使本指令 ignored，只会得到 detached=0
 *   的 executed。
 * - `eachAttachedTo`（string，可选）：TargetSpec id。经 `ctx.targets()` 取宿主，
 *   并用 `ctx.object()` 逐一重验：宿主引用已失效或已不在场上（例如已被击杀、
 *   回手）时，按契约 3.6 原语规则 2“目标全部失效 → ignored”返回
 *   `ignored`（reason: "mistargeted"），CR-v1.5 359.3.e.12 的示例即此种情形。
 *   宿主合法时，脱离当前附着在它上面的所有牌（经 `ctx.query` 枚举后按快照的
 *   `attachedTo` 精确匹配）。
 * - `pick` 与 `eachAttachedTo` 必须恰好提供一个；都没有 → `ignored`
 *   （reason: "mistargeted"）。
 *
 * 结果：所有 `perform` 都 done → `executed`，并把 `detached`（实际脱离的牌数，
 * 可能为 0）与 `detachedObjects`（被脱离牌的 ObjectRef 数组，供 "if you do" 等
 * 链接指令引用）写入 `ctx.link`。任一动作 replaced / prevented / impossible →
 * `negated`（replaced / skipped / impossible 原样映射）；按 436.1.a.1，被指示
 * 脱离但当前未附着的牌在本原语里直接判为不可能的 detach（negated/impossible），
 * 不依赖内核对该情形的返回。确定性：不读时间、不用随机。
 */
export interface DetachArgs {
  readonly pick?: string;
  readonly eachAttachedTo?: string;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { zoneEntryId?: unknown }).zoneEntryId === "number"
  );
}

const argsSchema: Schema<DetachArgs> = {
  parse(value: unknown): DetachArgs {
    if (typeof value !== "object" || value === null) {
      throw new Error("effect.detach args must be an object");
    }
    const candidate = value as Record<string, unknown>;
    const pick = candidate.pick;
    const eachAttachedTo = candidate.eachAttachedTo;
    if (pick !== undefined && typeof pick !== "string") {
      throw new Error("effect.detach pick must be a PickSpec id string");
    }
    if (eachAttachedTo !== undefined && typeof eachAttachedTo !== "string") {
      throw new Error("effect.detach eachAttachedTo must be a TargetSpec id string");
    }
    if ((pick === undefined) === (eachAttachedTo === undefined)) {
      throw new Error("effect.detach requires exactly one of pick / eachAttachedTo");
    }
    return { pick, eachAttachedTo };
  }
};

const reasonFor = (status: "replaced" | "prevented" | "impossible") =>
  status === "replaced" ? "replaced" : status === "prevented" ? "skipped" : "impossible";

const refEquals = (left: ObjectRef, right: ObjectRef): boolean =>
  left.id === right.id && left.zoneEntryId === right.zoneEntryId;

export default {
  op: "effect.detach",
  argsSchema,
  execute(ctx: ResolveContext, args: DetachArgs) {
    let candidates: ObjectRef[];
    if (args.eachAttachedTo !== undefined) {
      const hosts = ctx.targets(args.eachAttachedTo);
      if (hosts.length === 0) {
        // 目标全部失效（契约 3.6 原语规则 2）：宿主在结算时不再合法，整条指令
        // 连同其后链接指令一起 ignored（CR-v1.5 359.3.e.12 示例：宿主失去装备后
        // Strike Down 的后续指令被忽略）。
        return { status: "ignored", reason: "mistargeted" };
      }
      const validHosts: ObjectRef[] = [];
      for (const host of hosts) {
        const hostSnapshot = ctx.object(host);
        if (hostSnapshot !== null && hostSnapshot.zone === "board") {
          validHosts.push(host);
        }
      }
      if (validHosts.length === 0) {
        return { status: "ignored", reason: "mistargeted" };
      }
      const attached: ObjectRef[] = [];
      const snapshots = ctx.query({});
      for (const host of validHosts) {
        for (const card of snapshots) {
          if (card.attachedTo === null || !refEquals(card.attachedTo, host)) continue;
          attached.push(card.ref);
        }
      }
      candidates = attached;
    } else {
      // pick 是 v1.5 的非目标选择（契约 3.4 “pick 与 choose”）：不触发目标触发。
      candidates = ctx.picks(args.pick!).filter(isObjectRef);
    }

    const events: GameEvent[] = [];
    const detached: ObjectRef[] = [];
    for (const ref of candidates) {
      const snapshot: ObjectSnapshot | null = ctx.object(ref);
      if (snapshot === null) {
        // 引用已失效（对象已离区）：它不再 Attached，无法被本指令脱离。
        if (args.eachAttachedTo !== undefined) {
          return { status: "ignored", reason: "mistargeted" };
        }
        return { status: "negated", reason: "impossible", events };
      }
      if (snapshot.attachedTo === null) {
        // CR-v1.5 436.1.a.1：Detach 只影响当前 Attached 的牌；对未附着的牌执行
        // Detach 什么也不做，这里视为不可能的 detach 游戏动作（契约 3.6 原语
        // 规则 2 → negated/impossible）。
        return { status: "negated", reason: "impossible", events };
      }
      const outcome = ctx.perform({ type: "detach", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        // 替代/防止/不可能按契约映射为 replaced / skipped / impossible。
        return { status: "negated", reason: reasonFor(outcome.status), events };
      }
      detached.push(ref);
    }

    ctx.link("detached", detached.length);
    ctx.link("detachedObjects", detached.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })));
    return {
      status: "executed",
      events,
      linkedValues: {
        detached: detached.length,
        detachedObjects: detached.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }))
      }
    };
  }
} satisfies InstructionDef<DetachArgs>;
