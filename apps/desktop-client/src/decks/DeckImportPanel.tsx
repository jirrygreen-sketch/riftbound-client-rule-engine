import { useState } from "react";
import { DECK_ZONES, type CatalogCard, type DeckZone } from "../net/CardCatalogClient";
import { emptyDeckByZone, type DeckByZone } from "../hooks/useCardCatalog";
import { MAX_DECK_NAME_LENGTH } from "./library";
import "./DeckImportPanel.css";

/**
 * 卡组导入 / 导出面板（玩家便利功能，纯本地解析）。
 *
 * 这里只做「文本 JSON」与本地六区域表示（`DeckByZone`）之间的相互转换：
 * - 不校验合法性、可用性、领域或跨区域复制上限，这些一律交给服务端。
 * - 不访问剪贴板，不触发文件下载；导出只是把当前卡组写进一个只读文本框。
 * - 成功的唯一依据是父组件传入的 `onImport` 返回 `true`，绝不乐观置为成功。
 */

export const DEFAULT_IMPORT_DECK_NAME = "导入卡组";
export const MAX_ZONE_ENTRY_QUANTITY = 60;

export const IMPORT_DISABLED_REASON = "请等待目录加载完成；房间已准备时需先取消准备，再导入卡组。";
export const IMPORT_REVIEW_NOTE = "导入后需提交服务端校验";
export const IMPORT_TEXTAREA_LABEL = "粘贴卡组文件内容";
export const IMPORT_ACTION_LABEL = "导入卡组";
export const EXPORT_ACTION_LABEL = "导出当前卡组";
export const EXPORT_TEXTAREA_LABEL = "当前卡组 JSON";
export const EXPORT_PLACEHOLDER = "点击「导出当前卡组」生成当前卡组的 JSON。";

export type DeckImportResult =
  | { readonly ok: true; readonly deck: DeckByZone; readonly name: string }
  | { readonly ok: false; readonly error: string };

export type DeckImportStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "success"; readonly name: string; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface DeckImportPanelProps {
  readonly deck: DeckByZone;
  readonly cards: readonly CatalogCard[];
  readonly disabled: boolean;
  readonly onImport: (deck: DeckByZone, name: string) => boolean;
}

const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * JSON.parse 永远不会产生访问器属性，但这里仍显式拒绝，避免任何调用方
 * 绕过 `parseDeckImport` 直接传入带 get/set 的对象时被静默接受。
 */
function hasAccessorProperty(value: Record<string, unknown>): boolean {
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && (typeof descriptor.get === "function" || typeof descriptor.set === "function")) {
      return true;
    }
  }
  return false;
}

function isDeckZone(value: string): value is DeckZone {
  return (DECK_ZONES as readonly string[]).includes(value);
}

function isValidQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_ZONE_ENTRY_QUANTITY
  );
}

function normalizeImportedName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_IMPORT_DECK_NAME;
  return trimmed.slice(0, MAX_DECK_NAME_LENGTH);
}

type CardResolution =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string };

/**
 * 只在已加载目录里查找：先按印刷 ID 精确匹配，再按规范 ID 匹配。
 * 规范 ID 只有在唯一对应一个印刷时才可接受，否则要求调用方给出具体印刷 ID，
 * 从而保留真实印刷身份、绝不杜撰别名。
 */
function resolveCardId(requested: string, cards: readonly CatalogCard[]): CardResolution {
  for (const card of cards) {
    if (card.id === requested) return { ok: true, id: card.id };
  }
  let canonicalMatch: CatalogCard | null = null;
  let canonicalCount = 0;
  for (const card of cards) {
    if (card.canonicalCardId === requested) {
      canonicalCount += 1;
      canonicalMatch = card;
    }
  }
  if (canonicalCount === 0) {
    return { ok: false, error: `目录中不存在该卡牌：${requested}` };
  }
  if (canonicalCount > 1 || canonicalMatch === null) {
    return { ok: false, error: `该规范 ID 对应多个印刷，请使用具体印刷 ID：${requested}` };
  }
  return { ok: true, id: canonicalMatch.id };
}

function insertEntry(
  zone: DeckZone,
  cardId: string,
  quantity: unknown,
  cards: readonly CatalogCard[],
  target: Map<string, number>
): string | null {
  if (isReservedKey(cardId)) {
    return `卡组区域 ${zone} 包含保留字段：${cardId}`;
  }
  if (!isValidQuantity(quantity)) {
    return `卡组区域 ${zone} 中卡牌「${cardId}」的数量无效（需为 1 到 ${MAX_ZONE_ENTRY_QUANTITY} 的整数）。`;
  }
  const resolved = resolveCardId(cardId, cards);
  if (!resolved.ok) {
    return `卡组区域 ${zone}：${resolved.error}`;
  }
  if (target.has(resolved.id)) {
    return `卡组区域 ${zone} 存在重复卡牌：${resolved.id}`;
  }
  target.set(resolved.id, quantity);
  return null;
}

function readArrayEntry(
  zone: DeckZone,
  rawEntry: unknown,
  cards: readonly CatalogCard[],
  target: Map<string, number>
): string | null {
  if (!isPlainRecord(rawEntry)) {
    return `卡组区域 ${zone} 的卡牌条目必须是对象。`;
  }
  if (hasAccessorProperty(rawEntry)) {
    return "卡组文件包含不允许的访问器属性。";
  }
  for (const key of Object.keys(rawEntry)) {
    if (key !== "cardId" && key !== "quantity") {
      return `卡组区域 ${zone} 的卡牌条目包含未知字段：${key}`;
    }
  }
  const cardId = rawEntry.cardId;
  const quantity = rawEntry.quantity;
  if (typeof cardId !== "string" || cardId.trim().length === 0) {
    return `卡组区域 ${zone} 的卡牌条目缺少有效的 cardId。`;
  }
  return insertEntry(zone, cardId, quantity, cards, target);
}

function readZone(
  zone: DeckZone,
  value: unknown,
  cards: readonly CatalogCard[],
  target: Map<string, number>
): string | null {
  if (Array.isArray(value)) {
    for (const rawEntry of value) {
      const failure = readArrayEntry(zone, rawEntry, cards, target);
      if (failure) return failure;
    }
    return null;
  }
  if (isPlainRecord(value)) {
    if (hasAccessorProperty(value)) {
      return "卡组文件包含不允许的访问器属性。";
    }
    for (const [cardId, quantity] of Object.entries(value)) {
      const failure = insertEntry(zone, cardId, quantity, cards, target);
      if (failure) return failure;
    }
    return null;
  }
  return `卡组区域 ${zone} 必须是「卡牌→数量」对象或卡牌条目数组。`;
}

function buildDeck(
  base: DeckByZone,
  zones: ReadonlyMap<DeckZone, ReadonlyMap<string, number>>
): DeckByZone {
  const toRecord = (zone: DeckZone): Record<string, number> => {
    const map = zones.get(zone);
    if (!map || map.size === 0) return { ...base[zone] };
    const out: Record<string, number> = {};
    for (const [cardId, quantity] of map) out[cardId] = quantity;
    return out;
  };
  return {
    mainDeck: toRecord("mainDeck"),
    runes: toRecord("runes"),
    legend: toRecord("legend"),
    champion: toRecord("champion"),
    battlefields: toRecord("battlefields"),
    sideboard: toRecord("sideboard")
  };
}

/**
 * 纯解析器：把粘贴的卡组文本严格转换成本地六区域表示。
 *
 * 同时接受两种区域结构：标准 `{cardId: quantity}` 记录，以及实际 wire 的
 * `[{cardId, quantity}]` 数组；两者都归一到同一份本地表示。缺失区域视为空。
 * 未知区域、条目多余字段、未知卡牌 ID、同区域重复、保留字段 / 访问器属性、
 * 以及非法数量（0、分数、非安全整数、超过 60）都会失败。
 *
 * 该函数不校验合法性、可用性、领域或跨区域复制上限——那些只由服务端裁决。
 */
export function parseDeckImport(text: string, cards: readonly CatalogCard[]): DeckImportResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "请粘贴卡组文件内容。" };
  }
  if (!Array.isArray(cards)) {
    return { ok: false, error: "卡牌目录不可用。" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "卡组文件不是有效的 JSON 文本。" };
  }
  if (!isPlainRecord(parsed)) {
    return { ok: false, error: "卡组文件的顶层必须是一个 JSON 对象。" };
  }
  if (hasAccessorProperty(parsed)) {
    return { ok: false, error: "卡组文件包含不允许的访问器属性。" };
  }
  for (const key of Object.keys(parsed)) {
    if (isReservedKey(key)) {
      return { ok: false, error: `卡组文件包含保留字段：${key}` };
    }
  }

  const rawName = parsed.name;
  let name = DEFAULT_IMPORT_DECK_NAME;
  if (rawName !== undefined && rawName !== null) {
    if (typeof rawName !== "string") {
      return { ok: false, error: "卡组名称必须是字符串。" };
    }
    name = normalizeImportedName(rawName);
  }

  const rawDeck = parsed.deck;
  if (rawDeck !== undefined && rawDeck !== null && !isPlainRecord(rawDeck)) {
    return { ok: false, error: "卡组字段 deck 必须是一个对象。" };
  }

  const zones = new Map<DeckZone, Map<string, number>>();
  for (const zone of DECK_ZONES) zones.set(zone, new Map<string, number>());

  if (rawDeck !== undefined && rawDeck !== null) {
    const deckRecord = rawDeck as Record<string, unknown>;
    if (hasAccessorProperty(deckRecord)) {
      return { ok: false, error: "卡组文件包含不允许的访问器属性。" };
    }
    for (const [zoneKey, zoneValue] of Object.entries(deckRecord)) {
      if (isReservedKey(zoneKey)) {
        return { ok: false, error: `卡组区域包含保留字段：${zoneKey}` };
      }
      if (!isDeckZone(zoneKey)) {
        return { ok: false, error: `未知的卡组区域：${zoneKey}` };
      }
      const target = zones.get(zoneKey);
      if (!target) {
        return { ok: false, error: `未知的卡组区域：${zoneKey}` };
      }
      const failure = readZone(zoneKey, zoneValue, cards, target);
      if (failure) return { ok: false, error: failure };
    }
  }

  const deck = buildDeck(emptyDeckByZone(), zones);
  return { ok: true, deck, name };
}

function sortedZoneEntries(entries: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cardId of Object.keys(entries).sort()) {
    const quantity = entries[cardId];
    if (typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity >= 1) {
      out[cardId] = quantity;
    }
  }
  return out;
}

/** 把当前卡组导出成标准 schema 文本（六个区域全部输出，数量为数字）。 */
export function exportDeckToJson(name: string, deck: DeckByZone): string {
  const safeName = normalizeImportedName(typeof name === "string" ? name : "");
  const zones: Record<string, Record<string, number>> = {};
  for (const zone of DECK_ZONES) {
    zones[zone] = sortedZoneEntries(deck[zone]);
  }
  return JSON.stringify({ name: safeName, deck: zones }, null, 2);
}

/**
 * 执行一次导入：只有 `onImport` 返回 `true` 时才报告成功，否则一律视为失败，
 * 面板不会据此乐观更新任何权威状态。
 */
export function runDeckImport(
  text: string,
  cards: readonly CatalogCard[],
  onImport: (deck: DeckByZone, name: string) => boolean
): DeckImportStatus {
  const result = parseDeckImport(text, cards);
  if (!result.ok) {
    return { kind: "error", message: `导入失败：${result.error}` };
  }
  const accepted = onImport(result.deck, result.name);
  if (!accepted) {
    return { kind: "error", message: "导入失败：当前状态未接受该卡组，请稍后重试。" };
  }
  return {
    kind: "success",
    name: result.name,
    message: `已导入卡组「${result.name}」。${IMPORT_REVIEW_NOTE}。`
  };
}

export function DeckImportPanel(props: DeckImportPanelProps) {
  const { deck, cards, disabled, onImport } = props;
  const [text, setText] = useState("");
  const [name, setName] = useState(DEFAULT_IMPORT_DECK_NAME);
  const [status, setStatus] = useState<DeckImportStatus>({ kind: "idle" });
  const [exportText, setExportText] = useState("");

  const handleImport = () => {
    if (disabled) return;
    const next = runDeckImport(text, cards, onImport);
    if (next.kind === "success") setName(next.name);
    setStatus(next);
  };

  const handleExport = () => {
    setExportText(exportDeckToJson(name, deck));
  };

  return (
    <section className="dim-panel" aria-label="卡组导入导出">
      <h3 className="dim-title">{IMPORT_ACTION_LABEL}</h3>
      <p className="dim-hint">粘贴本应用导出的卡组 JSON，或符合标准 schema 的卡组文件内容。</p>

      <label className="dim-label" htmlFor="dim-import-text">
        {IMPORT_TEXTAREA_LABEL}
      </label>
      <textarea
        id="dim-import-text"
        className="dim-textarea"
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={'{"name":"我的卡组","deck":{"mainDeck":{"<cardId>":3}}}'}
        spellCheck={false}
        rows={8}
        disabled={disabled}
      />

      <div className="dim-actions">
        <button
          type="button"
          className="dim-button dim-button--primary"
          onClick={handleImport}
          disabled={disabled}
        >
          {IMPORT_ACTION_LABEL}
        </button>
        <button type="button" className="dim-button dim-button--export" onClick={handleExport}>
          {EXPORT_ACTION_LABEL}
        </button>
      </div>

      <p className="dim-note">{IMPORT_REVIEW_NOTE}</p>

      {disabled ? (
        <p className="dim-status dim-status--disabled">{IMPORT_DISABLED_REASON}</p>
      ) : null}
      {status.kind === "error" ? (
        <p className="dim-status dim-status--error">{status.message}</p>
      ) : null}
      {status.kind === "success" ? (
        <p className="dim-status dim-status--success">{status.message}</p>
      ) : null}

      <label className="dim-label" htmlFor="dim-export-text">
        {EXPORT_TEXTAREA_LABEL}
      </label>
      <textarea
        id="dim-export-text"
        className="dim-textarea dim-textarea--export"
        value={exportText}
        readOnly
        placeholder={EXPORT_PLACEHOLDER}
        spellCheck={false}
        rows={8}
        aria-readonly="true"
      />
    </section>
  );
}
