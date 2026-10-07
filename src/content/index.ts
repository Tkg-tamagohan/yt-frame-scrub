/**
 * コンテンツスクリプトのエントリポイント（Phase 2+3）。
 *
 * watch ページで video 要素を検出し、一時停止中かつカーソルがプレイヤー
 * 領域上にあるときだけ wheel イベントを捕捉してコマ送りへ変換する
 * （FR-1、仕様決定 B・C）。再生中は一切捕捉せずブラウザ標準へ素通しする。
 *
 * 役割分担:
 *   - wheel-accumulator.ts … deltaY の累積とコマ数換算（FR-2, FR-3）
 *   - stepper.ts … フレーム番号の管理と currentTime シーク（FR-1）
 *   - 本ファイル … video 検出、イベント捕捉、設定連動の配線
 *
 * ナビゲーション追従（yt-navigate-finish）・Shorts・広告/ライブ無効化は
 * Phase 7 の範囲であり、ここでは watch ページの初回検出のみ行う。
 */

import {
  loadSettings,
  onSettingsChanged,
  type Settings,
  type SettingsChanges,
} from "../shared/settings";
import {
  WheelAccumulator,
  configFromSettings,
} from "./wheel-accumulator";
import { DEFAULT_FPS, FrameStepper, type StepInfo } from "./stepper";

const LOG_PREFIX = "[yt-frame-scrub]";

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
 * コマ送り発生を外部へ通知するカスタムイベント名。
 * 後続フェーズのオーバーレイなどがこのイベントを購読する差し込み口。
 * detail は StepInfo（frame, timeSec, fps, delta）。
 */
export const STEP_EVENT_NAME = "yt-frame-scrub:step";

/** watch ページのメインプレイヤーとその video 要素を探す。 */
function findPlayer(): { player: HTMLElement; video: HTMLVideoElement } | null {
  const video = document.querySelector<HTMLVideoElement>(
    "#movie_player video",
  );
  if (!video) {
    return null;
  }
  const player = document.getElementById("movie_player") ?? video;
  return { player, video };
}

async function main(): Promise<void> {
  // 対象は watch ページ。Shorts 等の他ページ対応は Phase 7。
  if (!location.pathname.startsWith("/watch")) {
    return;
  }
  const settings = await loadSettings();

  const found = findPlayer();
  if (found) {
    attach(found.player, found.video, settings);
    return;
  }

  // 動的に DOM が構築される場合に備え、イベント駆動で出現を待つ。
  // ポーリングは非機能要件で禁止されているため MutationObserver を使う。
  const observer = new MutationObserver(() => {
    const later = findPlayer();
    if (later) {
      observer.disconnect();
      attach(later.player, later.video, settings);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function attach(
  player: HTMLElement,
  video: HTMLVideoElement,
  initial: Settings,
): void {
  let settings = initial;
  const accumulator = new WheelAccumulator(configFromSettings(settings));
  const stepper = new FrameStepper({
    video,
    // fps は呼び出しのたびに設定を読む。Phase 4 の検出層はこの getter を
    // 差し替えて配線する。手動指定がなければ既定 30 にフォールバック。
    getFps: () =>
      settings.manualFps > 0 ? settings.manualFps : DEFAULT_FPS,
    onStep: (info: StepInfo) => {
      document.dispatchEvent(
        new CustomEvent<StepInfo>(STEP_EVENT_NAME, { detail: info }),
      );
    },
  });

  video.addEventListener("seeked", () => stepper.notifySeeked());
  video.addEventListener("pause", () => stepper.notifyPaused());

  player.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      // enabled=false で機能全体を無効化（FR-6）。再生中は捕捉しない（FR-5）。
      if (!settings.enabled || !video.paused) {
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
      if (result.frames !== 0) {
        stepper.stepBy(result.frames);
      }
    },
    { passive: false },
  );

  // chrome.storage.sync の変更をリロードなしで反映する
  onSettingsChanged((changes) => {
    settings = applyChanges(settings, changes);
    accumulator.updateConfig(configFromSettings(settings));
  });

  console.log(`${LOG_PREFIX} attached: wheel -> frame stepping`);
}

void main();
