/**
 * stepper の単体テスト。
 * 根拠: docs/requirements-definition.md FR-1 と「コマ送りの実現方式」。
 *   - フレーム番号は整数で管理し、(番号 + 0.5) / fps で時刻へ換算する
 *   - 目標番号の更新は即時、currentTime 代入は一定間隔にまとめて最新目標のみ適用
 * DOM 依存は video・タイマー・シークを注入して切り離す。
 */

import { describe, expect, test } from "vitest";

import {
  DEFAULT_FPS,
  FrameStepper,
  type StepInfo,
} from "../src/content/stepper";

interface Harness {
  stepper: FrameStepper;
  video: { currentTime: number; duration: number };
  seeks: number[];
  steps: StepInfo[];
  /** 予約済みの間引きシークを手動で発火する。 */
  flush: () => void;
  scheduledCount: () => number;
  /** 動的に fps を差し替える（設定ライブ変更の検証用）。 */
  setFps: (fps: number) => void;
  /** 動的にシーク許可を切り替える（再生中の検証用）。 */
  setSeekAllowed: (v: boolean) => void;
}

/** seek・タイマーを観測可能にした FrameStepper を組み立てる。 */
function makeStepper(options: {
  currentTime?: number;
  duration?: number;
  fps?: number;
  seekIntervalMs?: number;
}): Harness {
  const video = {
    currentTime: options.currentTime ?? 0,
    duration: options.duration ?? 60,
  };
  const seeks: number[] = [];
  const steps: StepInfo[] = [];
  const fpsBox = { v: options.fps ?? 30 };
  const seekAllowed = { v: true };
  let pending: (() => void) | null = null;
  let scheduled = 0;

  const stepper = new FrameStepper({
    video,
    getFps: () => fpsBox.v,
    seekIntervalMs: options.seekIntervalMs ?? 40,
    seek: (t) => {
      seeks.push(t);
    },
    schedule: (fn) => {
      pending = fn;
      scheduled += 1;
      return fn;
    },
    cancelSchedule: () => {
      pending = null;
    },
    shouldSeek: () => seekAllowed.v,
    onStep: (info) => steps.push(info),
  });

  return {
    stepper,
    video,
    seeks,
    steps,
    flush: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    scheduledCount: () => scheduled,
    setFps: (fps) => {
      fpsBox.v = fps;
    },
    setSeekAllowed: (v) => {
      seekAllowed.v = v;
    },
  };
}

describe("stepper", () => {
  test("ST-01: +1 コマで (1 + 0.5) / fps の時刻へシークする", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.flush();
    expect(h.seeks).toEqual([1.5 / 30]);
  });

  test("ST-02: フレーム番号は動画先頭からの整数で管理される", () => {
    const h = makeStepper({ fps: 30, currentTime: 10 });
    // currentTime=10s, fps=30 → 初期フレーム番号は 300
    h.stepper.stepBy(1); // → 301
    h.flush();
    expect(h.seeks[0]).toBeCloseTo(301.5 / 30);
  });

  test("ST-03: fps 60 の動画では (番号 + 0.5) / 60 に換算される", () => {
    const h = makeStepper({ fps: 60 });
    h.stepper.stepBy(5); // → フレーム 5
    h.flush();
    expect(h.seeks[0]).toBeCloseTo(5.5 / 60);
  });

  test("ST-04: 間引き間隔内の複数ステップは最新の目標だけがシークされる", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.stepper.stepBy(1);
    h.stepper.stepBy(1);
    expect(h.scheduledCount()).toBe(1); // タイマーは 1 本だけ
    h.flush();
    expect(h.seeks).toEqual([3.5 / 30]);
  });

  test("ST-05: ステップなしではシークを発行しない", () => {
    const h = makeStepper({ fps: 30 });
    h.flush();
    expect(h.seeks).toEqual([]);
  });

  test("ST-06: 外部シーク（大きく離れた着地）で目標が実位置へ追従する", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.flush(); // appliedFrame=1
    // ユーザーがシークバーで 20s（フレーム 600）へ移動した想定
    h.video.currentTime = 20;
    h.stepper.notifySeeked();
    h.stepper.stepBy(1); // 600 + 1
    h.flush();
    expect(h.seeks[1]).toBeCloseTo(601.5 / 30);
  });

  test("ST-07: 自前シークの着地（±1 フレーム）は先行する目標を上書きしない", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(3);
    h.flush(); // appliedFrame=3、シーク先 (3.5)/30
    h.stepper.stepBy(2); // 目標は 5 へ先行
    h.video.currentTime = 3.5 / 30; // 自前シークがフレーム 3 に着地
    h.stepper.notifySeeked();
    h.flush();
    // 目標が 3 へ巻き戻されず 5 がシークされる
    expect(h.seeks[1]).toBeCloseTo(5.5 / 30);
  });

  test("ST-08: 自前シークが別フレームに着地したときは実測へ補正する", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.flush(); // appliedFrame=1
    // ブラウザがフレーム 2 の範囲内に着地した想定（±1 以内=自前扱い）
    h.video.currentTime = 2.2 / 30;
    h.stepper.notifySeeked();
    expect(h.stepper.getState().targetFrame).toBe(2);
  });

  test("ST-18: 自前シークがフレーム中央に着地しても目標はずれない", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.flush(); // appliedFrame=1、シーク先 1.5/30
    // 要求どおりフレーム中央に着地した想定。currentTime*fps=1.5 は
    // 「フレーム 1 に含まれる」ので推定番号は 1（実機検証の回帰）
    h.video.currentTime = 1.5 / 30;
    h.stepper.notifySeeked();
    expect(h.stepper.getState().targetFrame).toBe(1);
    // 次の +1 はフレーム 2 を指す（番号のずれを残さない）
    h.stepper.stepBy(1);
    h.flush();
    expect(h.seeks[1]).toBeCloseTo(2.5 / 30);
  });

  test("ST-09: pause 通知で目標が実位置へ再同期する（再生後の一時停止）", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(5); // 目標 5
    h.flush();
    // 再生して 20s（フレーム 600）まで進み一時停止した想定
    h.video.currentTime = 20;
    h.stepper.notifyPaused();
    h.stepper.stepBy(1);
    h.flush();
    expect(h.seeks[1]).toBeCloseTo(601.5 / 30);
  });

  test("ST-10: フレーム番号は 0 未満にならない", () => {
    const h = makeStepper({ fps: 30, currentTime: 0 });
    h.stepper.stepBy(-5);
    h.flush();
    expect(h.stepper.getState().targetFrame).toBe(0);
    expect(h.seeks[0]).toBeCloseTo(0.5 / 30);
  });

  test("ST-11: フレーム番号は末尾フレームを超えない", () => {
    const h = makeStepper({ fps: 30, duration: 1 });
    // duration=1s, fps=30 → 末尾フレーム番号は 29
    h.stepper.stepBy(100);
    h.flush();
    expect(h.stepper.getState().targetFrame).toBe(29);
    expect(h.seeks[0]).toBeCloseTo(29.5 / 30);
  });

  test("ST-12: onStep へ目標フレーム・時刻・fps・delta が通知される", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(2);
    expect(h.steps).toEqual([
      { frame: 2, timeSec: 2.5 / 30, fps: 30, delta: 2 },
    ]);
  });

  test("ST-13: fps が 0 や非数のとき既定 30 へフォールバックする", () => {
    const h = makeStepper({ fps: 0 });
    h.stepper.stepBy(1);
    h.flush();
    expect(h.seeks[0]).toBeCloseTo(1.5 / DEFAULT_FPS);
    expect(h.stepper.getState().fps).toBe(DEFAULT_FPS);
  });

  test("ST-14: dispose で予約済みシークが取り消される", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.stepper.dispose();
    h.flush();
    expect(h.seeks).toEqual([]);
  });

  test("ST-15: コマ戻しは負のコマ数で目標フレームを戻す", () => {
    const h = makeStepper({ fps: 30, currentTime: 10 });
    // フレーム 300 から 1 コマ戻し → 299
    h.stepper.stepBy(-1);
    h.flush();
    expect(h.seeks[0]).toBeCloseTo(299.5 / 30);
  });

  test("ST-16: 間引き間隔をまたぐ連続操作は逐次シークされる", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.flush();
    h.stepper.stepBy(1);
    h.flush();
    expect(h.seeks).toEqual([1.5 / 30, 2.5 / 30]);
    expect(h.scheduledCount()).toBe(2);
  });

  test("ST-17: シーク未発行の状態で seeked が来ても実位置へ追従する", () => {
    const h = makeStepper({ fps: 30 });
    // まだ自前シークを発行していない（appliedFrame=null）
    h.video.currentTime = 5; // フレーム 150
    h.stepper.notifySeeked();
    expect(h.stepper.getState().targetFrame).toBe(150);
  });

  test("ST-19: fps のライブ変更で目標が新 fps 基準の実位置へ再同期する", () => {
    const h = makeStepper({ fps: 30, currentTime: 10 });
    h.stepper.stepBy(1);
    h.flush(); // appliedFrame=301、シーク先 301.5/30
    h.video.currentTime = 301.5 / 30;
    // manualFps を 30→60 に変更した想定。次のステップは旧番号 301 を
    // 60fps で換算して位置を巻き戻すのではなく、実位置 301.5/30=10.05s
    // のフレーム 603 から +1 されるべき
    h.setFps(60);
    h.stepper.stepBy(1);
    h.flush();
    expect(h.seeks[1]).toBeCloseTo(604.5 / 60);
  });

  test("ST-20: fps 変更後に保留中シークが発火しても旧基準の番号で飛ばない", () => {
    const h = makeStepper({ fps: 30, currentTime: 10 });
    h.stepper.stepBy(5); // 旧基準で目標 305、シーク未発行
    h.setFps(60);
    h.flush();
    // 発火時点で fps=60 → 目標は実位置 10s→フレーム 600 に再同期され、
    // シーク先は 600.5/60（旧番号 305 を 60fps 換算した ~5.09s ではない）
    expect(h.seeks[0]).toBeCloseTo(600.5 / 60);
  });

  test("ST-21: play 通知で保留中のシーク予約が破棄される（FR-5）", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.stepper.notifyPlay();
    h.flush();
    expect(h.seeks).toEqual([]);
  });

  test("ST-22: 発火時点で再生中（shouldSeek=false）なら保留シークを捨てる", () => {
    const h = makeStepper({ fps: 30 });
    h.stepper.stepBy(1);
    h.setSeekAllowed(false); // 間引き発火前に再生開始した想定
    h.flush();
    expect(h.seeks).toEqual([]);
  });

  test("ST-23: 末尾クランプは中央時刻が duration 未満の最大番号を許す", () => {
    // duration=1.02, fps=30: フレーム 30 の中央 30.5/30≈1.0167 < 1.02 で有効
    const h = makeStepper({ fps: 30, duration: 1.02 });
    h.stepper.stepBy(100);
    h.flush();
    expect(h.stepper.getState().targetFrame).toBe(30);
    expect(h.seeks[0]).toBeCloseTo(30.5 / 30);
  });
});
