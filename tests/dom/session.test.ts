// @vitest-environment jsdom
/**
 * session の DOM 統合テスト（wheel イベント → 総合ゲート → 捕捉/素通し）。
 * 根拠: docs/requirements-definition.md
 *   - FR-1: 一時停止中のホイールを捕捉し preventDefault でページスクロールへ流さない
 *   - FR-5 / 仕様決定 B: 再生中は捕捉せずブラウザ標準の挙動を通す
 *   - 対象範囲: 広告再生中・ライブ系のリアルタイム再生では機能を無効化する
 *   - FR-6: 設定変更がリロードなしで反映される
 * gating.test.ts（GT-40〜43）は判定関数を DOM 状態から組み立てる層、
 * こちらは attachPlayer がコンテナへ配線した wheel リスナーへの
 * 実イベント送出を通した統合を対象にする。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { attachPlayer, type PlayerSession } from "../../src/content/session";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";

const sessions: PlayerSession[] = [];

/** プレイヤーコンテナ＋動画の DOM と配線済みセッションを作る。 */
function setup(): {
  container: HTMLElement;
  video: HTMLVideoElement;
  session: PlayerSession;
  onStep: ReturnType<typeof vi.fn>;
} {
  const container = document.createElement("div");
  const video = document.createElement("video");
  container.appendChild(video);
  document.body.appendChild(container);
  const onStep = vi.fn();
  const session = attachPlayer(
    { page: "watch", container, video },
    { ...DEFAULT_SETTINGS },
    { onStep },
  );
  sessions.push(session);
  return { container, video, session, onStep };
}

/** コンテナへ wheel イベントを送出し、送出したイベントを返す。 */
function dispatchWheel(container: HTMLElement, deltaY = -120): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaY,
    deltaMode: 0,
    bubbles: true,
    cancelable: true,
  });
  container.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
  document.body.innerHTML = "";
});

describe("wheel 捕捉（一時停止中・通常動画）", () => {
  it("SE-01: 一時停止中の wheel は捕捉され、preventDefault・stopPropagation・onStep が発火する", () => {
    const { container, onStep } = setup();
    // Shorts のフィード遷移等、祖先のハンドラへ届かないことを確認する観測点
    const ancestorSpy = vi.fn();
    document.addEventListener("wheel", ancestorSpy);

    const event = dispatchWheel(container, -120);

    // 捕捉したイベントはページスクロールへ流さない（FR-1）
    expect(event.defaultPrevented).toBe(true);
    expect(ancestorSpy).not.toHaveBeenCalled();
    // 1 ノッチ(deltaY 120px / 閾値 100px)分のコマ送りが発火する
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(
      expect.objectContaining({ frame: 1, delta: 1, fps: 30 }),
    );

    document.removeEventListener("wheel", ancestorSpy);
  });
});

describe("wheel 素通し（ゲート不成立）", () => {
  it("SE-02: 広告再生中は捕捉せず素通しする", () => {
    const { container, onStep } = setup();
    container.classList.add("ad-showing");

    const event = dispatchWheel(container);

    expect(event.defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("SE-03: 再生中は捕捉せず素通しする（FR-5）", () => {
    const { container, video, onStep } = setup();
    Object.defineProperty(video, "paused", {
      value: false,
      configurable: true,
    });

    const event = dispatchWheel(container);

    expect(event.defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("SE-04: duration が Infinity のライブ系再生は捕捉せず素通しする", () => {
    const { container, video, onStep } = setup();
    Object.defineProperty(video, "duration", {
      value: Number.POSITIVE_INFINITY,
      configurable: true,
    });

    const event = dispatchWheel(container);

    expect(event.defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });
});

describe("設定変更の反映", () => {
  it("SE-05: updateSettings で enabled を切ると捕捉しなくなり、戻すと捕捉が復帰する（FR-6）", () => {
    const { container, session, onStep } = setup();

    session.updateSettings({ ...DEFAULT_SETTINGS, enabled: false });
    let event = dispatchWheel(container);
    expect(event.defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();

    session.updateSettings({ ...DEFAULT_SETTINGS, enabled: true });
    event = dispatchWheel(container);
    expect(event.defaultPrevented).toBe(true);
    expect(onStep).toHaveBeenCalledTimes(1);
  });
});
