/**
 * 1 つのプレイヤーコンテナ＋動画要素への配線一式（FR-1〜FR-7）。
 *
 * ホイール蓄積・コマ送り・fps 検出・オーバーレイを対象要素へ配線し、
 * 解除（dispose）でイベント登録・監視・タイマーをすべて元に戻す。
 * index.ts のナビゲーション追従から attach / dispose の対で使い、
 * 重複登録や取り残しリークが起きないようにする。
 */

import type { Settings } from "../shared/settings";
import {
  WheelAccumulator,
  configFromSettings,
} from "./wheel-accumulator";
import { FrameStepper, type StepInfo } from "./stepper";
import { createFpsResolver } from "./fps";
import { createFrameOverlay } from "./overlay";
import { isAdPlayback, isLivePlayback, isSteppingEnabled } from "./gating";
import type { PlayerTarget } from "./players";

/** 「統計情報」(Stats for nerds) パネルのセレクタ。実在形式は実装時検証対象。 */
const STATS_PANEL_SELECTOR = ".html5-video-info-panel";

export interface PlayerSession {
  readonly video: HTMLVideoElement;
  readonly container: HTMLElement;
  /** 設定変更をリロードなしで反映する。 */
  updateSettings(next: Settings): void;
  /**
   * SPA 遷移の通知。動画要素が使い回される遷移でもコンテンツは
   * 新しいため、確定済みの fps 推定を捨てて検出をやり直す。
   */
  notifyNavigated(): void;
  /** 登録したイベント・監視・タイマーをすべて解除する。 */
  dispose(): void;
}

export interface SessionHooks {
  /** コマ送り発生時の外部通知（STEP_EVENT 送出用の差し込み口）。 */
  onStep?: (info: StepInfo) => void;
}

/**
 * ノードが「統計情報」パネル自身かその内部・祖先に関わるか。
 * characterData 変更の target は Text ノードになりうるため
 * parentElement 経由でも判定する。
 */
function nodeInStatsPanel(node: Node): boolean {
  if (node instanceof Element) {
    return (
      node.matches(STATS_PANEL_SELECTOR) ||
      node.closest(STATS_PANEL_SELECTOR) !== null ||
      node.querySelector(STATS_PANEL_SELECTOR) !== null
    );
  }
  return (
    node.parentElement !== null &&
    node.parentElement.closest(STATS_PANEL_SELECTOR) !== null
  );
}

function mutationTouchesStatsPanel(mutation: MutationRecord): boolean {
  if (nodeInStatsPanel(mutation.target)) {
    return true;
  }
  for (const node of mutation.addedNodes) {
    if (nodeInStatsPanel(node)) {
      return true;
    }
  }
  return false;
}

/**
 * 対象プレイヤーへコマ送り機能一式を配線する。
 * 返却するセッションの dispose で本関数が行った変更をすべて解除する。
 */
export function attachPlayer(
  target: PlayerTarget,
  initial: Settings,
  hooks: SessionHooks = {},
): PlayerSession {
  const { container, video } = target;
  let settings = initial;

  const accumulator = new WheelAccumulator(configFromSettings(settings));

  // fps は 3 段検出（統計情報 → 実測 → 手動値）のリゾルバ経由で取得する。
  // manualFps > 0 は検出失敗時の第 3 段であり、既定 30 より優先される
  // （要件定義書「fps の検出」の優先順位どおり）。
  const fpsResolver = createFpsResolver(video, {
    manualFps: settings.manualFps,
    readStatsResolutionText: () =>
      container.querySelector(STATS_PANEL_SELECTOR)?.textContent ?? null,
  });

  const overlay = createFrameOverlay();
  overlay.setEnabled(settings.overlayEnabled);
  // 全画面・シアター・ミニプレイヤーではコンテナ要素自体が移動・
  // リサイズされるため、中にマウントすれば位置は自動追従する。
  overlay.attach(container);

  /** イベント時点の DOM 状態から総合ゲートを評価する。 */
  const steppingEnabled = (): boolean =>
    isSteppingEnabled({
      enabled: settings.enabled,
      paused: video.paused,
      adPlaying: isAdPlayback(container.classList),
      liveLike: isLivePlayback({ duration: video.duration }),
    });

  const stepper = new FrameStepper({
    video,
    getFps: () => fpsResolver.getEstimate().fps,
    // 間引きで待機したシークの適用直前にもゲートを掛け、
    // 再生再開・広告開始との順序競合で位置を戻さないようにする。
    shouldSeek: steppingEnabled,
    onStep: (info: StepInfo) => {
      hooks.onStep?.(info);
      overlay.update({
        frame: info.frame,
        timeSeconds: info.timeSec,
        fps: info.fps,
        estimated: true,
      });
      overlay.notifyActivity();
    },
  });

  const onSeeked = (): void => {
    stepper.notifySeeked();
    overlay.update({
      frame: stepper.getState().targetFrame,
      timeSeconds: video.currentTime,
      fps: fpsResolver.getEstimate().fps,
      estimated: true,
    });
  };
  const onPaused = (): void => stepper.notifyPaused();
  const onPlay = (): void => stepper.notifyPlay();
  video.addEventListener("seeked", onSeeked);
  video.addEventListener("pause", onPaused);
  video.addEventListener("play", onPlay);

  const onWheel = (event: WheelEvent): void => {
    // 機能無効・再生中・広告・ライブ中は捕捉せずブラウザ標準へ素通し
    // （FR-5・対象範囲の無効化条件）。
    if (!steppingEnabled()) {
      return;
    }
    const result = accumulator.feed(
      {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      },
      event.timeStamp,
    );
    // 修飾キーゲート不成立など未捕捉のイベントは素通しする
    if (!result.captured) {
      return;
    }
    event.preventDefault();
    // Shorts ではスクロールがフィード遷移にも使われるため、捕捉した
    // イベントは祖先や他リスナーへ届かせない（仕様決定 B の裏返し）。
    event.stopPropagation();
    if (result.frames !== 0) {
      stepper.stepBy(result.frames);
    }
  };
  // capture 相でコンテナへ登録し、Shorts のフィード遷移ハンドラより
  // 先にイベントを評価する。ゲート不成立のときは何もせず素通しする。
  container.addEventListener("wheel", onWheel, {
    capture: true,
    passive: false,
  });

  // 「統計情報」パネルの出現・更新にだけ反応して fps 検出を試行する。
  // パネルはユーザー操作でのみ現れるため、パネル関連の変化に絞って
  // detectFromStatsText を呼ぶ。
  const statsObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesStatsPanel)) {
      fpsResolver.detectFromStatsText();
    }
  });
  statsObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "style"],
  });

  return {
    video,
    container,

    updateSettings(next: Settings): void {
      settings = next;
      accumulator.updateConfig(configFromSettings(next));
      overlay.setEnabled(next.overlayEnabled);
      fpsResolver.setManualFps(next.manualFps);
    },

    notifyNavigated(): void {
      fpsResolver.reset();
    },

    dispose(): void {
      container.removeEventListener("wheel", onWheel, { capture: true });
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("pause", onPaused);
      video.removeEventListener("play", onPlay);
      statsObserver.disconnect();
      stepper.dispose();
      fpsResolver.dispose();
      overlay.detach();
    },
  };
}
