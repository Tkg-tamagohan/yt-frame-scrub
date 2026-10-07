/**
 * fps 検出モジュールの単体テスト。
 * ケースは docs/requirements-definition.md「fps の検出」の 3 段優先順位と
 * 実装計画の設定スキーマ(manualFps, 既定 30 フォールバック)を根拠に作成する。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FPS,
  computeMeasuredFps,
  createFpsResolver,
  parseFpsFromResolutionText,
  selectFpsEstimate,
  type FpsMeasurableVideo,
} from "../src/content/fps";

/** テスト用の video スタブ。発火したいイベントを dispatch で送る。 */
class FakeVideo implements FpsMeasurableVideo {
  currentTime = 0;
  paused = true;
  totalVideoFrames = 0;

  private listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  getVideoPlaybackQuality(): { totalVideoFrames: number } {
    return { totalVideoFrames: this.totalVideoFrames };
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const event = { type } as Event;
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  /** 再生を開始する(playing 発火) */
  play(): void {
    this.paused = false;
    this.dispatch("playing");
  }

  /** 再生中にメディアが seconds 進み frames 表示された状態を再現する */
  advanceMedia(seconds: number, frames: number): void {
    this.currentTime += seconds;
    this.totalVideoFrames += frames;
    this.dispatch("timeupdate");
  }
}

describe("parseFpsFromResolutionText", () => {
  it("FPS-01: 整数 fps を含む解像度表記をパースする", () => {
    expect(parseFpsFromResolutionText("1920x1080@30")).toBe(30);
  });

  it("FPS-02: 小数 fps を含む解像度表記をパースする", () => {
    expect(parseFpsFromResolutionText("1920x1080@29.97")).toBe(29.97);
  });

  it("FPS-03: 空白や乗算記号の揺れを許容する", () => {
    expect(parseFpsFromResolutionText("1920 x 1080 @ 60")).toBe(60);
    expect(parseFpsFromResolutionText("1920×1080@59.94")).toBe(59.94);
  });

  it("FPS-04: 解像度を欠く @fps 表記も許容する", () => {
    expect(parseFpsFromResolutionText("@24")).toBe(24);
  });

  it("FPS-05: 現在値/最適値の併記では先頭の fps を採用する", () => {
    expect(parseFpsFromResolutionText("1920x1080@30 / 1920x1080@60")).toBe(30);
  });

  it("FPS-06: fps を含まない不正形式は null を返す", () => {
    expect(parseFpsFromResolutionText("1920x1080")).toBeNull();
    expect(parseFpsFromResolutionText("")).toBeNull();
    expect(parseFpsFromResolutionText("abc")).toBeNull();
    expect(parseFpsFromResolutionText(null)).toBeNull();
    expect(parseFpsFromResolutionText(undefined)).toBeNull();
  });

  it("FPS-07: fps が 0 の表記は無効として null を返す", () => {
    expect(parseFpsFromResolutionText("1920x1080@0")).toBeNull();
    expect(parseFpsFromResolutionText("1920x1080@0.0")).toBeNull();
  });
});

describe("computeMeasuredFps", () => {
  it("FPS-08: フレーム差と時刻差から実測 fps を算出する", () => {
    // 1.0 秒間に 30 フレーム → 30fps
    expect(
      computeMeasuredFps(
        { totalVideoFrames: 100, currentTime: 10.0 },
        { totalVideoFrames: 130, currentTime: 11.0 },
      ),
    ).toBeCloseTo(30, 5);
  });

  it("FPS-09: 非整数の実測値をそのまま返す(丸めない)", () => {
    // 約 59.94fps 相当の差分
    const fps = computeMeasuredFps(
      { totalVideoFrames: 0, currentTime: 0 },
      { totalVideoFrames: 60, currentTime: 1.001 },
    );
    expect(fps).not.toBeNull();
    expect(fps!).toBeCloseTo(59.94, 1);
  });

  it("FPS-10: 差分が取れない(0 以下)場合は null を返す", () => {
    expect(
      computeMeasuredFps(
        { totalVideoFrames: 10, currentTime: 5 },
        { totalVideoFrames: 10, currentTime: 6 },
      ),
    ).toBeNull();
    expect(
      computeMeasuredFps(
        { totalVideoFrames: 10, currentTime: 5 },
        { totalVideoFrames: 20, currentTime: 5 },
      ),
    ).toBeNull();
    expect(
      computeMeasuredFps(
        { totalVideoFrames: 20, currentTime: 5 },
        { totalVideoFrames: 10, currentTime: 6 },
      ),
    ).toBeNull();
  });
});

describe("selectFpsEstimate", () => {
  it("FPS-11: 統計情報の検出値が最優先される", () => {
    const r = selectFpsEstimate({
      statsFps: 24,
      measuredFps: 60,
      manualFps: 48,
    });
    expect(r).toEqual({ fps: 24, source: "stats" });
  });

  it("FPS-12: 統計情報が未検出なら実測値を採用する", () => {
    const r = selectFpsEstimate({ measuredFps: 59.94, manualFps: 24 });
    expect(r).toEqual({ fps: 59.94, source: "measured" });
  });

  it("FPS-13: 検出が得られなければ手動指定値を採用する", () => {
    const r = selectFpsEstimate({ manualFps: 60 });
    expect(r).toEqual({ fps: 60, source: "manual" });
  });

  it("FPS-14: 手動値が 0・未指定のとき既定 30 へフォールバックする", () => {
    expect(selectFpsEstimate({ manualFps: 0 })).toEqual({
      fps: DEFAULT_FPS,
      source: "default",
    });
    expect(selectFpsEstimate({})).toEqual({
      fps: DEFAULT_FPS,
      source: "default",
    });
    expect(selectFpsEstimate({ manualFps: null })).toEqual({
      fps: DEFAULT_FPS,
      source: "default",
    });
  });

  it("FPS-15: 各段の無効値はスキップして次段へ進む", () => {
    expect(
      selectFpsEstimate({ statsFps: 0, measuredFps: -1, manualFps: 25 }),
    ).toEqual({ fps: 25, source: "manual" });
    expect(
      selectFpsEstimate({
        statsFps: Number.NaN,
        measuredFps: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ fps: DEFAULT_FPS, source: "default" });
  });
});

describe("createFpsResolver", () => {
  it("FPS-16: 未検出かつ手動値なしでは既定 30 を返す", () => {
    const resolver = createFpsResolver(new FakeVideo());
    expect(resolver.getEstimate()).toEqual({
      fps: 30,
      source: "default",
    });
    resolver.dispose();
  });

  it("FPS-17: 再生区間の差分から実測値を確定する", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video);
    video.play();
    video.advanceMedia(0.5, 15); // 未確定(下限未満)
    expect(resolver.getEstimate().source).toBe("default");
    video.advanceMedia(0.5, 15); // 累計 1.0 秒・30 フレーム → 30fps で確定
    const estimate = resolver.getEstimate();
    expect(estimate.source).toBe("measured");
    expect(estimate.fps).toBeCloseTo(30, 5);
    resolver.dispose();
  });

  it("FPS-18: 一時停止のみでは実測せず次段へフォールバックする", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video, { manualFps: 24 });
    // 再生せず timeupdate 相当の進行も起きない状態では手動値が使われる
    expect(resolver.getEstimate()).toEqual({ fps: 24, source: "manual" });
    resolver.dispose();
  });

  it("FPS-19: 手動値と実測値の両方がある場合は実測値が優先される", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video, { manualFps: 60 });
    video.play();
    video.advanceMedia(1.0, 24); // 24fps を実測
    const estimate = resolver.getEstimate();
    expect(estimate.source).toBe("measured");
    expect(estimate.fps).toBeCloseTo(24, 5);
    resolver.dispose();
  });

  it("FPS-20: 統計情報の読み取りに成功すると最優先で採用する", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video, {
      manualFps: 60,
      readStatsResolutionText: () => "1920x1080@25",
    });
    expect(resolver.detectFromStatsText()).toEqual({
      fps: 25,
      source: "stats",
    });
    video.play();
    video.advanceMedia(1.0, 30); // 実測も確定するが stats が優先
    expect(resolver.getEstimate()).toEqual({ fps: 25, source: "stats" });
    resolver.dispose();
  });

  it("FPS-21: 統計情報の読み取りに失敗しても既存の推定を壊さない", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video, {
      manualFps: 24,
      readStatsResolutionText: () => null,
    });
    expect(resolver.detectFromStatsText()).toBeNull();
    expect(resolver.getEstimate()).toEqual({ fps: 24, source: "manual" });
    resolver.dispose();
  });

  it("FPS-22: シークで測定中のサンプルを破棄し時刻跳躍の混入を防ぐ", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video);
    video.play();
    video.advanceMedia(0.6, 18);
    // シークで currentTime が 60 秒跳ぶ。破棄されなければ 18/60.6 として過小評価される
    video.currentTime += 60;
    video.dispatch("seeking");
    video.dispatch("seeked");
    video.advanceMedia(1.0, 30); // シーク後の新しい窓で 30fps を実測
    const estimate = resolver.getEstimate();
    expect(estimate.source).toBe("measured");
    expect(estimate.fps).toBeCloseTo(30, 5);
    resolver.dispose();
  });

  it("FPS-23: setManualFps で手動値を後から更新できる", () => {
    const resolver = createFpsResolver(new FakeVideo());
    resolver.setManualFps(50);
    expect(resolver.getEstimate()).toEqual({ fps: 50, source: "manual" });
    resolver.dispose();
  });

  it("FPS-24: reset で確定値を消去し既定へ戻る", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video);
    video.play();
    video.advanceMedia(1.0, 30);
    expect(resolver.getEstimate().source).toBe("measured");
    resolver.reset();
    expect(resolver.getEstimate().source).toBe("default");
    resolver.dispose();
  });

  it("FPS-25: dispose 後はイベントに反応しない", () => {
    const video = new FakeVideo();
    const resolver = createFpsResolver(video);
    resolver.dispose();
    video.play();
    video.advanceMedia(1.0, 30);
    expect(resolver.getEstimate().source).toBe("default");
  });

  it("FPS-26: 生成時点で再生中なら直ちにサンプリングを開始する", () => {
    const video = new FakeVideo();
    video.paused = false; // 既に再生中の video を渡された状態
    const resolver = createFpsResolver(video);
    video.advanceMedia(1.0, 30);
    expect(resolver.getEstimate().source).toBe("measured");
    resolver.dispose();
  });
});
