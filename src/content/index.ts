/**
 * コンテンツスクリプトのエントリポイント。
 *
 * watch ページと Shorts ページのプレイヤーへコマ送り機能を配線する。
 * 役割分担:
 *   - wheel-accumulator.ts … deltaY の累積とコマ数換算（FR-2, FR-3）
 *   - stepper.ts … フレーム番号の管理と currentTime シーク（FR-1）
 *   - fps.ts … fps の 3 段検出（統計情報 → 実測 → 手動値）
 *   - overlay.ts … Shadow DOM オーバーレイ表示（FR-4）
 *   - players.ts … watch / Shorts のプレイヤー検出（FR-7、仕様決定 D）
 *   - gating.ts … 広告・ライブ・設定による無効化判定
 *   - session.ts … 1 プレイヤーへの配線一式と解除
 *   - 本ファイル … ナビゲーション追従とセッション管理（FR-7）
 *
 * YouTube は SPA で、ページ遷移や表示モード切り替えで動画要素が
 * 作り直される。yt-navigate-finish とプレイヤー関連の DOM 変化を
 * イベント駆動で監視し、対象が変わるたびに古い配線を破棄して
 * 張り直す。ポーリングループは持たない（非機能要件）。
 */

import {
  loadSettings,
  onSettingsChanged,
  type Settings,
  type SettingsChanges,
} from "../shared/settings";
import type { StepInfo } from "./stepper";
import { findActivePlayer } from "./players";
import { attachPlayer, type PlayerSession } from "./session";

const LOG_PREFIX = "[yt-frame-scrub]";

/**
 * コマ送り発生を外部へ通知するカスタムイベント名。
 * detail は StepInfo（frame, timeSec, fps, delta）。
 */
export const STEP_EVENT_NAME = "yt-frame-scrub:step";

/** SettingsChanges を Settings へ型安全にマージする。 */
function applyChanges(base: Settings, changes: SettingsChanges): Settings {
  return {
    enabled: changes.enabled?.newValue ?? base.enabled,
    invertDirection:
      changes.invertDirection?.newValue ?? base.invertDirection,
    captureModifier:
      changes.captureModifier?.newValue ?? base.captureModifier,
    stepThreshold: changes.stepThreshold?.newValue ?? base.stepThreshold,
    shiftStepSize: changes.shiftStepSize?.newValue ?? base.shiftStepSize,
    overlayEnabled: changes.overlayEnabled?.newValue ?? base.overlayEnabled,
    manualFps: changes.manualFps?.newValue ?? base.manualFps,
  };
}

/**
 * プレイヤー関連と判断できる DOM 変化か。
 * childList は video / プレイヤーコンテナ / Shorts レンダラーの追加・除去、
 * attributes は `is-active` の付け替え（ショート送り）のみを見る。
 * これ以外の変化（再生バーの更新など高頻度のもの）では再評価しない。
 */
const PLAYER_RELATED_SELECTOR = [
  "video",
  "#movie_player",
  "ytd-reel-video-renderer",
  "ytd-player",
  ".html5-video-player",
].join(",");

function nodeTouchesPlayer(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }
  return (
    node.matches(PLAYER_RELATED_SELECTOR) ||
    node.querySelector(PLAYER_RELATED_SELECTOR) !== null
  );
}

function isPlayerRelatedMutation(mutation: MutationRecord): boolean {
  if (mutation.type === "attributes") {
    // is-active の付け替えが意味を持つのは Shorts のレンダラーだけ
    return mutation.target instanceof Element
      ? mutation.target.matches("ytd-reel-video-renderer")
      : false;
  }
  for (const node of mutation.addedNodes) {
    if (nodeTouchesPlayer(node)) {
      return true;
    }
  }
  for (const node of mutation.removedNodes) {
    if (nodeTouchesPlayer(node)) {
      return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  let settings = await loadSettings();
  let session: PlayerSession | null = null;
  let refreshQueued = false;

  /**
   * 現在の対象プレイヤーを再評価し、変わっていれば配線を張り直す。
   * 同一の動画要素＋コンテナなら何もしない（冪等）。
   */
  const refresh = (): void => {
    refreshQueued = false;
    const target = findActivePlayer();
    if (
      session !== null &&
      target !== null &&
      session.video === target.video &&
      session.container === target.container
    ) {
      return;
    }
    session?.dispose();
    session = null;
    if (target !== null) {
      session = attachPlayer(target, settings, {
        onStep: (info: StepInfo) => {
          document.dispatchEvent(
            new CustomEvent<StepInfo>(STEP_EVENT_NAME, { detail: info }),
          );
        },
      });
      console.log(`${LOG_PREFIX} attached: ${target.page} player`);
    }
  };

  /**
   * 変化の嵐（遷移直後など連続する Mutation）を 1 回の再評価へ畳む。
   * イベント駆動のまま、microtask で重複実行を防ぐ。
   */
  const requestRefresh = (): void => {
    if (refreshQueued) {
      return;
    }
    refreshQueued = true;
    queueMicrotask(refresh);
  };

  // SPA ナビゲーション（watch ⇔ Shorts 往復・別動画・ショート送り）で
  // 再評価する。動画要素が使い回される遷移でもコンテンツは新しいため、
  // 先に確定済み fps をリセットしてから再評価に回す。
  document.addEventListener("yt-navigate-finish", () => {
    session?.notifyNavigated();
    requestRefresh();
  });

  // 遷移直後の遅延構築、動画要素の作り直し、ショートの is-active
  // 付け替えを拾う。プレイヤー関連の変化に絞って再評価する。
  const domObserver = new MutationObserver((mutations) => {
    if (mutations.some(isPlayerRelatedMutation)) {
      requestRefresh();
    }
  });
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["is-active"],
  });

  // chrome.storage.sync の変更をリロードなしで反映する
  onSettingsChanged((changes) => {
    settings = applyChanges(settings, changes);
    session?.updateSettings(settings);
  });

  refresh();
}

void main();
