// @vitest-environment jsdom
/**
 * gating の DOM 統合テスト。
 * 根拠: docs/requirements-definition.md
 *   - 対象範囲: 広告再生中・ライブ配信のリアルタイム再生では機能を無効化する
 *   - FR-5 / 仕様決定 B: 再生中は捕捉しない
 * tests/gating.test.ts（GT-10〜34）はスタブ入力による純粋ロジックの検証。
 * こちらは実 DOM の classList と video.duration / video.paused から
 * 判定を組み立てる形（session.ts の総合ゲートと同じ組み立て方）を対象にする。
 */

import { describe, expect, it } from "vitest";

import {
  isAdPlayback,
  isLivePlayback,
  isSteppingEnabled,
} from "../../src/content/gating";

describe("isAdPlayback（実 DOM の classList）", () => {
  it("GT-40: クラスの追加・除去が DOMTokenList 経由で即座に判定へ反映される", () => {
    const container = document.createElement("div");
    expect(isAdPlayback(container.classList)).toBe(false);

    container.classList.add("ad-showing");
    expect(isAdPlayback(container.classList)).toBe(true);

    container.classList.remove("ad-showing");
    expect(isAdPlayback(container.classList)).toBe(false);

    container.classList.add("ad-interrupting");
    expect(isAdPlayback(container.classList)).toBe(true);
  });
});

describe("isLivePlayback（実 DOM の video.duration）", () => {
  it("GT-41: duration が Infinity の動画をライブ系再生と判定し、NaN・有限値は判定しない", () => {
    const video = document.createElement("video");
    // jsdom の未ロード動画は duration=NaN（未確定）。誤って無効化しない
    expect(isLivePlayback({ duration: video.duration })).toBe(false);

    Object.defineProperty(video, "duration", {
      value: Number.POSITIVE_INFINITY,
      configurable: true,
    });
    expect(isLivePlayback({ duration: video.duration })).toBe(true);
  });
});

describe("isSteppingEnabled（DOM 状態からの組み立て）", () => {
  it("GT-42: コンテナの広告クラスと動画の paused / duration から総合ゲートを評価する", () => {
    const container = document.createElement("div");
    const video = document.createElement("video");
    // session.ts の steppingEnabled と同じ組み立て方でイベント時点の
    // DOM 状態から評価する
    const gate = (): boolean =>
      isSteppingEnabled({
        enabled: true,
        paused: video.paused,
        adPlaying: isAdPlayback(container.classList),
        liveLike: isLivePlayback({ duration: video.duration }),
      });

    // 一時停止中・広告なし・通常動画 → 捕捉する
    expect(gate()).toBe(true);

    // 広告開始で無効化、広告終了で復帰する
    container.classList.add("ad-showing");
    expect(gate()).toBe(false);
    container.classList.remove("ad-showing");
    expect(gate()).toBe(true);

    // ライブ系（duration=Infinity）で無効化
    Object.defineProperty(video, "duration", {
      value: Number.POSITIVE_INFINITY,
      configurable: true,
    });
    expect(gate()).toBe(false);
  });

  it("GT-43: 再生中は捕捉しない（FR-5）", () => {
    const container = document.createElement("div");
    const video = document.createElement("video");
    Object.defineProperty(video, "paused", {
      value: false,
      configurable: true,
    });

    const gate = (): boolean =>
      isSteppingEnabled({
        enabled: true,
        paused: video.paused,
        adPlaying: isAdPlayback(container.classList),
        liveLike: isLivePlayback({ duration: video.duration }),
      });

    expect(gate()).toBe(false);
  });
});
