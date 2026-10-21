import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import { AppShell } from "../navigation/AppShell";
import { HomePage } from "../navigation/HomePage";
import { exitDesktopClient } from "../navigation/native-exit";
import { RoomLobby } from "../components/RoomLobby";
import { RoomChatPanel } from "../chat/RoomChatPanel";
import { ProfilePage } from "../profile/ProfilePage";
import { DeckImportPanel } from "../decks/DeckImportPanel";
import { SettingsPage } from "../settings/SettingsPage";
import { MatchControls } from "../settings/MatchControls";
import { ReplayPage } from "../replays/ReplayPage";
import { writeReplayLibrary, removeReplayRecording } from "../replays/replay-library";
import { ActionBar } from "../components/ActionBar";
import { ChainPanel } from "../components/ChainPanel";
import { ConnectionPanel } from "../components/ConnectionPanel";
import { DeckBuilder } from "../components/DeckBuilder";
import { LogPanel } from "../components/LogPanel";
import { PlayerBoard } from "../components/PlayerBoard";
import { PromptPanel } from "../components/PromptPanel";
import { RoomDeckPicker } from "../components/RoomDeckPicker";
import { deckTotalCount } from "../decks/library";
import { writeCatalogServerUrl } from "../decks/ui-preferences";
import { PlayableMatchBoard } from "../full-product/PlayableMatchBoard";
import { DuelMatchBoard } from "../full-product/DuelMatchBoard";
import { V2MatchBoard } from "../full-product/v2/V2MatchBoard";
import { toPlayableConnectionStatus } from "../full-product/transport";
import { normalizeCardServerUrl } from "../net/CardCatalogClient";
import { DECK_ZONE_LABELS, DECK_ZONE_ORDER } from "./deck-policy";
import type { AppState } from "./useAppState";
import type { AppActions } from "./useAppActions";

export function AppView({
  status,
  handshakeReady,
  commandPending,
  chatMessages,
  chatPending,
  chatError,
  sendChat,
  disconnect,
  projection,
  duelProjection,
  lastError,
  roomId,
  roomView,
  session,
  storedSession,
  activeServerUrl,
  connect,
  createRoom,
  joinRoom,
  pass,
  playCard,
  submitDuelCommand,
  submitDuelCommandPacket,
  concede,
  respondPrompt,
  syncEvents,
  clearError,
  preferenceStorage,
  profile,
  setProfile,
  displaySettings,
  settingsError,
  replayLibrary,
  setReplayLibrary,
  replaySelection,
  setReplaySelection,
  selectReplayFrame,
  replayNotice,
  setReplayNotice,
  exitError,
  setExitError,
  saveProfile,
  changeDisplaySettings,
  saveCurrentReplay,
  selectedCardId,
  setSelectedCardId,
  actionSelection,
  setActionSelection,
  pendingOptionId,
  setPendingOptionId,
  activeTab,
  setActiveTab,
  catalogServerUrl,
  setCatalogServerUrl,
  v2ServerUrl,
  setV2ServerUrl,
  activeDeckZone,
  setActiveDeckZone,
  setRetryToken,
  catalog,
  catalogStatus,
  catalogError,
  deck,
  setZoneFromEntries,
  validation,
  validationStatus,
  validationError,
  validateDeck,
  retryCatalog,
  library,
  selectedLibraryDeckId,
  draftName,
  setDraftName,
  libraryNotice,
  viewerPlayerId,
  roomSelf,
  self,
  opponent,
  selectedCard,
  fullProductEnabled,
  mergedGameEvents,
  actionState,
  builderCards,
  builderDeck,
  validationIssues,
  cardLimits,
  resolveCardInfo,
  replayFrame,
  duelCatalog,
  resolveDuelCardTitle,
  resolveDuelCardImage,
  resolveDuelCardDomains,
  playableMatchView,
  concedeAllowance,
  selectedCardLabel,
  deckCardCount,
  currentDeckTotal,
  currentDeckZones,
  currentDeckName,
  gate,
  v2UiEnabled,
  setV2UiEnabled,
  v2Match,
  handleSelectDeck,
  handleSaveAsNamed,
  importDeck,
  handleUpdateSelected,
  handleDeleteSelected,
  submitCurrentDeck,
  toggleReady,
  submitPlayableSelection
}: AppState & AppActions) {
  const v2Connected = v2Match.connectionStatus === "connected";
  const inMatch = duelProjection !== null || roomView?.status === "playing" || v2Match.room?.status === "playing";
  const chat = <RoomChatPanel key={roomId ?? "no-room"} messages={chatMessages ?? []}
    viewerPlayerId={session?.playerId ?? null} connected={status === "connected" && handshakeReady && roomId !== null}
    pending={chatPending ?? false} onSend={sendChat} error={chatError ?? null} />;
  const controls = <div className="match-local-controls">
    <button className="button" type="button" onClick={() => setV2UiEnabled(!v2UiEnabled)}>
      {v2UiEnabled ? "切换回旧对局界面" : "使用协议 v2 对局界面"}
    </button>
    <MatchControls settings={displaySettings} onChange={changeDisplaySettings}
      onGoHome={() => setActiveTab("home")} onGoRoom={() => setActiveTab("room")}
      onConcede={duelProjection === null && projection !== null ? concede : undefined}
      canConcede={concedeAllowance.enabled} />
    <button className="button" type="button" onClick={saveCurrentReplay} disabled={!duelProjection}>保存回放</button>
    {settingsError ? <span role="alert">{settingsError}</span> : null}
    {replayNotice ? <span role="status">{replayNotice}</span> : null}
  </div>;
  const exit = (): void => {
    disconnect();
    setActiveTab("home");
    void exitDesktopClient().catch(() => setExitError("客户端未能关闭，请使用窗口关闭按钮退出。"));
  };

  return (
    <AppShell page={activeTab} onNavigate={setActiveTab} onExit={exit}
      playerName={profile.name}
      connected={v2UiEnabled ? v2Connected : status === "connected" && handshakeReady}
      inMatch={inMatch}>
    <div className="app-content" data-card-scale={displaySettings.cardScale}
      data-reduced-motion={displaySettings.reducedMotion} data-show-card-names={displaySettings.showCardNames}>
      {exitError ? <p role="alert">{exitError}</p> : null}
      {activeTab === "home" ? (
        <HomePage onNavigate={setActiveTab} onExit={exit} playerName={profile.name}
          connected={v2UiEnabled ? v2Connected : status === "connected" && handshakeReady} inMatch={inMatch}
          roomId={roomId ?? v2Match.room?.roomId ?? null} deckCount={library.decks.length} />
      ) : activeTab === "profile" ? (
        <ProfilePage profile={profile} onSave={saveProfile} inRoom={roomId !== null} />
      ) : activeTab === "settings" ? (
        <SettingsPage settings={displaySettings} onChange={changeDisplaySettings} saveError={settingsError} />
      ) : activeTab === "replays" ? (
        <ReplayPage library={replayLibrary} selectedId={replaySelection?.id ?? null}
          selectedFrameIndex={replaySelection?.index ?? 0}
          onSelectFrame={selectReplayFrame}
          onDelete={id => {
            const next = removeReplayRecording(replayLibrary, id);
            if (writeReplayLibrary(preferenceStorage, next)) {
              setReplayLibrary(next);
              if (replaySelection?.id === id) setReplaySelection(null);
            } else setReplayNotice("回放删除未能保存。");
          }}
          viewer={replayFrame ? <DuelMatchBoard projection={replayFrame}
            connectionStatus="connected" commandPending={false} readOnly
            onCommand={() => {}} resolveCardTitle={resolveDuelCardTitle} resolveCardImage={resolveDuelCardImage}
            resolveCardDomains={resolveDuelCardDomains} /> : null} />
      ) : activeTab === "deck-builder" ? (
        <main className="deck-shell" aria-label="卡组编辑">
          <section className="deck-summary" aria-label="卡组状态">
            <div>
              <h2>我的卡组</h2>
              <p>{`卡组总计 ${deckCardCount} 张 · 当前区域：${DECK_ZONE_LABELS[activeDeckZone]}`}</p>
            </div>
            <form
              className="catalog-controls"
              onSubmit={event => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem("catalog-server");
                if (input instanceof HTMLInputElement) {
                  const normalized = normalizeCardServerUrl(input.value);
                  if (normalized) {
                    setCatalogServerUrl(normalized);
                    // Only the user-set catalog address is stored; it is never
                    // derived from the separate WS room address.
                    writeCatalogServerUrl(preferenceStorage, normalized);
                  }
                }
                setRetryToken(token => token + 1);
                retryCatalog();
              }}
            >
              <label className="field">
                <span>仓库服务地址</span>
                <input
                  name="catalog-server"
                  defaultValue={catalogServerUrl}
                  spellCheck={false}
                  autoComplete="url"
                />
              </label>
              <button className="button primary" type="submit">
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </form>
            <button
              className="button primary"
              type="button"
              onClick={() => {
                void validateDeck();
              }}
              disabled={catalogStatus !== "ready" || validationStatus === "pending"}
            >
              <ShieldCheck size={16} aria-hidden />
              校验卡组
            </button>
          </section>

          <section className="deck-library" aria-label="卡组库">
            <div className="deck-library-head">
              <h3>卡组库</h3>
              <p>把当前草稿保存为命名卡组，之后可在房间页选用。</p>
            </div>
            <div className="deck-library-save">
              <label className="field">
                <span>卡组名称</span>
                <input
                  value={draftName}
                  maxLength={40}
                  spellCheck={false}
                  onChange={event => setDraftName(event.target.value)}
                />
              </label>
              <button className="button primary" type="button" onClick={handleSaveAsNamed}>
                <Save size={16} aria-hidden />
                保存为命名卡组
              </button>
              <button
                className="button"
                type="button"
                onClick={handleUpdateSelected}
                disabled={selectedLibraryDeckId === null}
              >
                <Upload size={16} aria-hidden />
                更新所选卡组
              </button>
              <button
                className="button"
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedLibraryDeckId === null}
              >
                <Trash2 size={16} aria-hidden />
                删除所选
              </button>
            </div>
            {library.decks.length === 0 ? (
              <p className="hint">还没有保存的卡组。填写名称后点“保存为命名卡组”。</p>
            ) : (
              <ul className="deck-library-list">
                {library.decks.map(entry => (
                  <li
                    key={entry.id}
                    className={entry.id === selectedLibraryDeckId ? "active" : ""}
                  >
                    <span className="deck-library-name">{entry.name}</span>
                    <span className="deck-library-meta">{`${deckTotalCount(entry.deck)} 张`}</span>
                    <button
                      className="button"
                      type="button"
                      onClick={() => handleSelectDeck(entry.id)}
                      disabled={!gate.canSelectDeck}
                      title={gate.selectBlockedReason ?? "载入到当前草稿"}
                    >
                      载入
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {libraryNotice ? <p className="hint" role="status">{libraryNotice}</p> : null}
          </section>

          <DeckImportPanel deck={deck} cards={catalog?.cards ?? []}
            disabled={!gate.canSelectDeck || roomSelf?.ready === true || catalogStatus !== "ready"}
            onImport={importDeck} />

          {catalogStatus === "loading" ? (
            <section className="catalog-state">
              <RefreshCw size={20} aria-hidden />
              <p>正在加载官方仓库...</p>
            </section>
          ) : catalogStatus === "error" ? (
            <section className="catalog-state error">
              <AlertTriangle size={20} aria-hidden />
              <p>{catalogError}</p>
              <button className="button primary" type="button" onClick={retryCatalog}>
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </section>
          ) : (
            <>
              <nav className="deck-zone-tabs" aria-label="卡组区域">
                {DECK_ZONE_ORDER.map(zone => (
                  <button
                    key={zone}
                    type="button"
                    className={activeDeckZone === zone ? "active" : ""}
                    aria-pressed={activeDeckZone === zone}
                    onClick={() => setActiveDeckZone(zone)}
                  >
                    {DECK_ZONE_LABELS[zone]}
                  </button>
                ))}
              </nav>
              <DeckBuilder
                cards={builderCards}
                deck={builderDeck}
                cardLimits={cardLimits}
                onChange={nextDeck => setZoneFromEntries(activeDeckZone, nextDeck)}
              />
            </>
          )}

          {validationStatus === "error" || validation ? (
            <section className={`validation-panel ${validation?.valid === false ? "invalid" : ""}`} role="status">
              {validationStatus === "error" || validation?.valid === false ? (
                <AlertTriangle size={18} aria-hidden />
              ) : (
                <CheckCircle2 size={18} aria-hidden />
              )}
              <div>
                {validationError ? (
                  <p>{validationError}</p>
                ) : validation?.valid ? (
                  <p>服务端校验通过。</p>
                ) : validation ? (
                  <ul>
                    {validationIssues.map(issue => (
                      <li key={issue.key}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      ) : activeTab === "room" ? (
        <main className="room-shell room-page" aria-label="房间连接">
          <div className="match-local-controls" aria-label="房间协议选择">
            <button className="button" type="button" onClick={() => setV2UiEnabled(!v2UiEnabled)}>
              {v2UiEnabled ? "切换回旧房间界面" : "使用协议 v2 独立房间"}
            </button>
          </div>
          {v2UiEnabled ? (
            <V2MatchBoard
              state={v2Match.state}
              room={v2Match.room}
              session={v2Match.session}
              playerName={profile.name}
              pendingCommandIds={v2Match.pendingCommandIds}
              transportError={v2Match.error}
              catalogServerUrl={v2ServerUrl ?? catalogServerUrl}
              serverUrl={v2Match.reconnectUrl || v2ServerUrl || catalogServerUrl}
              onServerUrlChange={setV2ServerUrl}
              onConnect={v2Match.connect}
              onCreateRoom={() => v2Match.createRoom(profile.name)}
              onJoinRoom={roomIdValue => v2Match.joinRoom(roomIdValue, profile.name)}
              onSubmitDeck={v2Match.submitDeck}
              onSetReady={v2Match.setReady}
              onCommand={v2Match.sendCommand}
            />
          ) : roomView ? (
            <RoomLobby room={roomView} viewerPlayerId={viewerPlayerId} deckPicker={
<RoomDeckPicker
            namedDecks={library.decks}
            selectedDeckId={selectedLibraryDeckId}
            currentDeckName={currentDeckName}
            currentDeckTotal={currentDeckTotal}
            currentZones={currentDeckZones}
            deckState={gate.deckState}
            gate={gate}
            draftName={draftName}
            onDraftNameChange={setDraftName}
            onSelectDeck={handleSelectDeck}
            onSaveAsNamed={handleSaveAsNamed}
            onUpdateSelected={handleUpdateSelected}
            onDeleteSelected={handleDeleteSelected}
            onEditDeck={() => setActiveTab("deck-builder")}
            notice={libraryNotice}
          />
            } chat={chat} onSubmitDeck={submitCurrentDeck} onToggleReady={toggleReady}
              onSync={syncEvents} canSubmitDeck={gate.canSubmitDeck} canToggleReady={gate.canToggleReady}
              readyLabel={gate.readyLabel} submitBlockedReason={gate.submitBlockedReason}
              readyBlockedReason={gate.readyBlockedReason} onEnterGame={() => setActiveTab("game-table")} />
          ) : (
          <ConnectionPanel
            playerName={profile.name}
            onPlayerNameChange={name => setProfile(current => ({...current,name}))}
            status={status}
            handshakeReady={handshakeReady}
            roomId={roomId}
            storedSession={storedSession}
            activeServerUrl={activeServerUrl}
            lastError={lastError}
            onConnect={connect}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onClearError={clearError}
          />
          )}
        </main>
      ) : v2UiEnabled ? (
        <main className="table-shell">
          {controls}
          <V2MatchBoard
            state={v2Match.state}
            room={v2Match.room}
            session={v2Match.session}
            playerName={profile.name}
            pendingCommandIds={v2Match.pendingCommandIds}
            transportError={v2Match.error}
            catalogServerUrl={v2ServerUrl ?? catalogServerUrl}
            serverUrl={v2Match.reconnectUrl || v2ServerUrl || catalogServerUrl}
            onServerUrlChange={setV2ServerUrl}
            onConnect={v2Match.connect}
            onCreateRoom={() => v2Match.createRoom(profile.name)}
            onJoinRoom={roomIdValue => v2Match.joinRoom(roomIdValue, profile.name)}
            onSubmitDeck={v2Match.submitDeck}
            onSetReady={v2Match.setReady}
            onCommand={v2Match.sendCommand}
          />
          {roomId ? chat : null}
        </main>
      ) : duelProjection !== null ? (
        <main className="table-shell">
          {duelCatalog.status === "loading" ? (
            <section className="catalog-state" role="status" aria-label="对局卡牌目录">
              <p>正在从当前对局服务加载卡牌名称与图片…</p>
            </section>
          ) : duelCatalog.status === "error" ? (
            <section className="catalog-state error" role="alert" aria-label="对局卡牌目录">
              <p>{duelCatalog.error ?? "无法加载对局卡牌目录。"}</p>
              <button className="button" type="button" onClick={duelCatalog.retry}>
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </section>
          ) : null}
          {lastError ? (
            <section className="catalog-state error" role="alert" aria-label="对局操作提示">
              <p>{lastError}</p>
              <button className="button" type="button" aria-label="关闭对局提示" onClick={clearError}>
                关闭
              </button>
            </section>
          ) : null}
          <DuelMatchBoard
            projection={duelProjection}
            connectionStatus={toPlayableConnectionStatus(status, handshakeReady)}
            commandPending={commandPending}
            onCommand={submitDuelCommand}
            onActionPacket={submitDuelCommandPacket}
            resolveCardTitle={resolveDuelCardTitle}
            resolveCardImage={resolveDuelCardImage}
            resolveCardDomains={resolveDuelCardDomains}
            controls={controls}
            chat={chat}
          />
        </main>
      ) : fullProductEnabled && playableMatchView !== null ? (
        <main className="table-shell">
          <PlayableMatchBoard
            view={playableMatchView}
            selection={actionSelection}
            onSelectionChange={setActionSelection}
            onSubmit={() => submitPlayableSelection()}
          />
          <button
            className="button"
            type="button"
            onClick={concede}
            disabled={!concedeAllowance.enabled}
            title={concedeAllowance.reason}
          >
            认输
          </button>
        </main>
      ) : (
        <main className="table-shell">
          <PlayerBoard
            player={opponent}
            viewerPlayerId={viewerPlayerId}
            sideName="对手公开区域"
            selectedCardId={null}
            canSelect={false}
            isActive={projection?.activePlayerId === opponent?.playerId}
            resolveCardInfo={resolveCardInfo}
          />

          <ChainPanel projection={projection} />

          <PlayerBoard
            player={self}
            viewerPlayerId={viewerPlayerId}
            sideName="我的区域"
            selectedCardId={selectedCardId}
            onSelectCard={card => {
              setSelectedCardId(card.instanceId);
            }}
            onPlayCard={playCard}
            canSelect={actionState.canPass || actionState.canRespondPrompt}
            isActive={projection?.activePlayerId === viewerPlayerId}
            resolveCardInfo={resolveCardInfo}
          />
        </main>
      )}

      {activeTab === "game-table" && !v2UiEnabled && duelProjection === null && !fullProductEnabled ? (
        <footer className="bottom-rail">
          <ActionBar
            selectedCard={selectedCard}
            canAct={actionState.canPass}
            canPlay={actionState.canPlay}
            blockedReason={actionState.blockedReason}
            onPass={pass}
            onPlayCard={playCard}
            selectedCardLabel={selectedCardLabel}
          />
        </footer>
      ) : null}

      {activeTab === "game-table" && !v2UiEnabled && duelProjection === null ? (
        <aside className="side-rail">
          {controls}
          {roomId ? chat : null}
          {!fullProductEnabled ? <PromptPanel
            prompt={projection?.prompt ?? null}
            viewerPlayerId={viewerPlayerId}
            pendingOptionId={pendingOptionId}
            disabled={commandPending || !actionState.canRespondPrompt}
            onRespond={(promptId, optionId, stateVersion) => {
              setPendingOptionId(optionId);
              respondPrompt(promptId, optionId, stateVersion);
            }}
          /> : null}
          <LogPanel log={mergedGameEvents} />
        </aside>
      ) : null}
    </div>
    </AppShell>
  );
}
