/**
 * gating / players の単体テスト。
 * 根拠: docs/requirements-definition.md
 *   - FR-5: 再生中は捕捉せずブラウザ標準の挙動を通す（仕様決定 B）
 *   - 対象範囲: 広告再生中、ライブ配信・プレミア公開のリアルタイム再生では無効化
 *   - FR-6: 機能の有効/無効トグル
 *   - FR-7 / 仕様決定 D: 対象は watch ページと Shorts ページ
 * DOM 非依存の純粋関数のみを対象にする。
 */

import { describe, expect, it } from "vitest";

import {
  isAdPlayback,
  isLivePlayback,
  isSteppingEnabled,
} from "../src/content/gating";
import { pageKindOf } from "../src/content/players";

/** テスト用の最小 classList スタブ。 */
function classListOf(...names: string[]): { contains(n: string): boolean } {
  const set = new Set(names);
  return { contains: (n) => set.has(n) };
}

describe("pageKindOf", () => {
  it("GT-01: watch ページを対象と判定する", () => {
    expect(pageKindOf("/watch")).toBe("watch");
  });

  it("GT-02: Shorts ページを対象と判定する", () => {
    expect(pageKindOf("/shorts/abc123")).toBe("shorts");
    expect(pageKindOf("/shorts")).toBe("shorts");
  });

  it("GT-03: 対象外ページは null を返す", () => {
    expect(pageKindOf("/")).toBeNull();
    expect(pageKindOf("/results")).toBeNull();
    expect(pageKindOf("/feed/subscriptions")).toBeNull();
  });
});

describe("isAdPlayback", () => {
  it("GT-10: ad-showing クラスは広告再生中と判定する", () => {
    expect(isAdPlayback(classListOf("ad-showing"))).toBe(true);
    expect(isAdPlayback(classListOf("ytp-autohide", "ad-showing"))).toBe(true);
  });

  it("GT-11: ad-interrupting クラスは広告再生中と判定する", () => {
    expect(isAdPlayback(classListOf("ad-interrupting"))).toBe(true);
  });

  it("GT-12: 広告クラスがなければ広告再生中ではない", () => {
    expect(isAdPlayback(classListOf())).toBe(false);
    expect(isAdPlayback(classListOf("ytp-autohide"))).toBe(false);
  });
});

describe("isLivePlayback", () => {
  it("GT-20: duration が Infinity ならライブ系再生と判定する", () => {
    expect(
      isLivePlayback({ duration: Number.POSITIVE_INFINITY }),
    ).toBe(true);
  });

  it("GT-21: 有限の duration はライブ系ではない", () => {
    expect(isLivePlayback({ duration: 120 })).toBe(false);
    // duration 未確定(NaN)も誤って無効化しない（保守的判定）
    expect(isLivePlayback({ duration: NaN })).toBe(false);
  });
});

describe("isSteppingEnabled", () => {
  const base = {
    enabled: true,
    paused: true,
    adPlaying: false,
    liveLike: false,
  };

  it("GT-30: 有効・一時停止・広告なし・非ライブで捕捉する", () => {
    expect(isSteppingEnabled(base)).toBe(true);
  });

  it("GT-31: 機能無効なら捕捉しない（FR-6）", () => {
    expect(isSteppingEnabled({ ...base, enabled: false })).toBe(false);
  });

  it("GT-32: 再生中は捕捉しない（FR-5）", () => {
    expect(isSteppingEnabled({ ...base, paused: false })).toBe(false);
  });

  it("GT-33: 広告再生中は捕捉しない（対象範囲の無効化条件）", () => {
    expect(isSteppingEnabled({ ...base, adPlaying: true })).toBe(false);
  });

  it("GT-34: ライブ・プレミアのリアルタイム再生は捕捉しない", () => {
    expect(isSteppingEnabled({ ...base, liveLike: true })).toBe(false);
  });
});
