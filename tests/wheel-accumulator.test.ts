/**
 * wheel-accumulator の単体テスト。
 * 根拠: docs/requirements-definition.md FR-2・FR-3・FR-5、仕様決定 A・C、
 * docs/implementation-plan.md Phase 3。
 * 文書に数値の定めのない減衰・レート上限は注入した設定値で挙動形を検証する。
 */

import { describe, expect, test } from "vitest";

import {
  WheelAccumulator,
  isCaptureAllowed,
  normalizeDeltaPx,
  type WheelAccumulatorConfig,
  type WheelInput,
} from "../src/content/wheel-accumulator";

/** 仕様どおりの既定値: 閾値 100px、Shift 10 コマ、修飾キーなし、反転なし。 */
function makeAcc(
  overrides: Partial<WheelAccumulatorConfig> = {},
): WheelAccumulator {
  return new WheelAccumulator({
    stepThresholdPx: 100,
    shiftStepSize: 10,
    invertDirection: false,
    captureModifier: "none",
    decayDelayMs: 100,
    decayHalfLifeMs: 100,
    maxStepsPerSecond: 30,
    ...overrides,
  });
}

function wheel(deltaY: number, over: Partial<WheelInput> = {}): WheelInput {
  return {
    deltaY,
    deltaMode: 0,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...over,
  };
}

describe("wheel-accumulator", () => {
  test("WA-01: 上スクロール 1 ノッチ（deltaY=-100）で +1 コマ", () => {
    const acc = makeAcc();
    const r = acc.feed(wheel(-100), 0);
    expect(r.captured).toBe(true);
    expect(r.frames).toBe(1);
  });

  test("WA-02: 下スクロール 1 ノッチ（deltaY=+100）で -1 コマ", () => {
    const acc = makeAcc();
    const r = acc.feed(wheel(100), 0);
    expect(r.captured).toBe(true);
    expect(r.frames).toBe(-1);
  });

  test("WA-03: 閾値未満の入力は蓄積し、超えた時点で 1 コマを消費する", () => {
    const acc = makeAcc();
    expect(acc.feed(wheel(-60), 0).frames).toBe(0);
    expect(acc.feed(wheel(-60), 10).frames).toBe(1);
    expect(acc.pendingPx).toBe(20);
  });

  test("WA-04: 閾値を超えた余剰分は蓄積に残る", () => {
    const acc = makeAcc();
    // -250px → 2 コマ消費、50px 残留
    expect(acc.feed(wheel(-250), 0).frames).toBe(2);
    expect(acc.pendingPx).toBe(50);
    // 残留 50 + 追加分 60 = 110 → 1 コマ消費、10px 残留
    expect(acc.feed(wheel(-60), 10).frames).toBe(1);
    expect(acc.pendingPx).toBeCloseTo(10);
  });

  test("WA-05: deltaMode=1（行）は px へ正規化される（1 行 40px 換算）", () => {
    const acc = makeAcc();
    const input = (d: number) => wheel(d, { deltaMode: 1 });
    expect(acc.feed(input(-1), 0).frames).toBe(0); // 40px
    expect(acc.feed(input(-1), 10).frames).toBe(0); // 80px
    expect(acc.feed(input(-1), 20).frames).toBe(1); // 120px → 1 コマ
  });

  test("WA-06: deltaMode=2（ページ）は 800px 換算で複数コマを消費する", () => {
    const acc = makeAcc();
    const r = acc.feed(wheel(-1, { deltaMode: 2 }), 0);
    expect(r.frames).toBe(8);
  });

  test("WA-07: 逆方向の入力で残っていた蓄積は捨てられる", () => {
    const acc = makeAcc();
    acc.feed(wheel(-60), 0); // +60px 残留
    // 逆方向 100px。残留を相殺せず新たに -100px として消化 → -1 コマ
    expect(acc.feed(wheel(100), 10).frames).toBe(-1);
  });

  test("WA-08: 入力停止から遅延を超えると累積が減衰し、閾値へ届かない", () => {
    const acc = makeAcc({ decayDelayMs: 100, decayHalfLifeMs: 100 });
    acc.feed(wheel(-60), 0); // +60px 残留
    // 300ms 後: 遅延 100ms 引いた 200ms 経過 → 半減期 100ms で ×0.25 → 15px
    // 追加 50px を足しても 65px < 閾値 100 → コマは出ない
    expect(acc.feed(wheel(-50), 300).frames).toBe(0);
    expect(acc.pendingPx).toBeCloseTo(65);
  });

  test("WA-09: 減衰なしなら同じ入力列は閾値を超える（対照）", () => {
    const acc = makeAcc({ decayHalfLifeMs: 0 });
    acc.feed(wheel(-60), 0);
    expect(acc.feed(wheel(-50), 300).frames).toBe(1);
  });

  test("WA-10: 1 秒あたりのコマ数上限を超えた分は捨てられる", () => {
    const acc = makeAcc({ maxStepsPerSecond: 5 });
    let total = 0;
    for (let i = 0; i < 10; i++) {
      total += acc.feed(wheel(-100), 0).frames;
    }
    expect(total).toBe(5);
  });

  test("WA-11: トークンは時間経過で補充される", () => {
    const acc = makeAcc({ maxStepsPerSecond: 10 });
    let total = 0;
    for (let i = 0; i < 20; i++) {
      total += acc.feed(wheel(-100), 0).frames;
    }
    expect(total).toBe(10);
    // 0.5 秒後: 5 コマ分補充
    total += acc.feed(wheel(-100), 500).frames;
    total += acc.feed(wheel(-100), 500).frames;
    total += acc.feed(wheel(-100), 500).frames;
    total += acc.feed(wheel(-100), 500).frames;
    total += acc.feed(wheel(-100), 500).frames;
    total += acc.feed(wheel(-100), 500).frames;
    expect(total).toBe(15);
  });

  test("WA-12: 上限で捨てられたコマは後続入力で掘り返されない（慣性誤爆防止）", () => {
    const acc = makeAcc({ maxStepsPerSecond: 5 });
    let total = 0;
    for (let i = 0; i < 10; i++) {
      total += acc.feed(wheel(-100), 0).frames;
    }
    expect(total).toBe(5);
    // 十分に時間が経ちトークンは満タン。次の 1 ノッチは 1 コマのみ出る
    expect(acc.feed(wheel(-100), 2000).frames).toBe(1);
  });

  test("WA-13: Shift 併用で 1 ノッチ shiftStepSize コマになる（FR-3）", () => {
    const acc = makeAcc({ shiftStepSize: 10 });
    expect(acc.feed(wheel(-100, { shiftKey: true }), 0).frames).toBe(10);
  });

  test("WA-14: Shift 併用でも蓄積→閾値消化の経路は同じ", () => {
    const acc = makeAcc({ shiftStepSize: 10 });
    expect(acc.feed(wheel(-50, { shiftKey: true }), 0).frames).toBe(0);
    expect(acc.feed(wheel(-60, { shiftKey: true }), 10).frames).toBe(10);
  });

  test("WA-15: captureModifier=shift 時、Shift は捕捉条件となり複数コマ機能は無効", () => {
    const acc = makeAcc({ captureModifier: "shift", shiftStepSize: 10 });
    // Shift 未押下 → 捕捉しない
    expect(acc.feed(wheel(-100), 0).captured).toBe(false);
    // Shift 押下 → 捕捉するが 1 ノッチ 1 コマ（×10 にならない）
    const r = acc.feed(wheel(-100, { shiftKey: true }), 10);
    expect(r.captured).toBe(true);
    expect(r.frames).toBe(1);
  });

  test("WA-16: captureModifier=alt 時、Alt 未押下の入力は捕捉も蓄積もしない", () => {
    const acc = makeAcc({ captureModifier: "alt" });
    expect(acc.feed(wheel(-60), 0).captured).toBe(false);
    expect(acc.pendingPx).toBe(0);
    // Alt 押下の 60px だけが蓄積される（未押下の 60px は無視済み）
    expect(acc.feed(wheel(-60, { altKey: true }), 10).frames).toBe(0);
    expect(acc.feed(wheel(-60, { altKey: true }), 20).frames).toBe(1);
  });

  test("WA-17: captureModifier=alt でも Shift 併用の複数コマは有効", () => {
    const acc = makeAcc({ captureModifier: "alt", shiftStepSize: 10 });
    const r = acc.feed(wheel(-100, { altKey: true, shiftKey: true }), 0);
    expect(r.frames).toBe(10);
  });

  test("WA-18: captureModifier=ctrl 時は Ctrl 押下中のみ捕捉", () => {
    const acc = makeAcc({ captureModifier: "ctrl" });
    expect(acc.feed(wheel(-100), 0).captured).toBe(false);
    expect(acc.feed(wheel(-100, { ctrlKey: true }), 10).frames).toBe(1);
  });

  test("WA-19: invertDirection でスクロール方向とコマ送り方向が反転する", () => {
    const acc = makeAcc({ invertDirection: true });
    expect(acc.feed(wheel(-100), 0).frames).toBe(-1);
    expect(acc.feed(wheel(100), 10).frames).toBe(1);
  });

  test("WA-20: deltaY=0 や微小入力は捕捉するがコマを出さない", () => {
    const acc = makeAcc();
    expect(acc.feed(wheel(0), 0)).toEqual({ captured: true, frames: 0 });
    expect(acc.feed(wheel(-1), 10).frames).toBe(0);
  });

  test("WA-21: updateConfig で閾値などの設定を差し替えられる", () => {
    const acc = makeAcc();
    acc.updateConfig({
      stepThresholdPx: 200,
      shiftStepSize: 10,
      invertDirection: false,
      captureModifier: "none",
      decayDelayMs: 100,
      decayHalfLifeMs: 100,
      maxStepsPerSecond: 30,
    });
    expect(acc.feed(wheel(-100), 0).frames).toBe(0);
    expect(acc.feed(wheel(-100), 10).frames).toBe(1);
  });
});

describe("isCaptureAllowed / normalizeDeltaPx（補助関数の仕様確認）", () => {
  test("WA-22: 修飾キーゲートの対応表（仕様決定 C）", () => {
    const none = { altKey: false, ctrlKey: false, shiftKey: false };
    expect(isCaptureAllowed("none", none)).toBe(true);
    expect(isCaptureAllowed("alt", none)).toBe(false);
    expect(isCaptureAllowed("alt", { ...none, altKey: true })).toBe(true);
    expect(isCaptureAllowed("ctrl", { ...none, ctrlKey: true })).toBe(true);
    expect(isCaptureAllowed("shift", { ...none, shiftKey: true })).toBe(
      true,
    );
  });

  test("WA-23: px 正規化の符号規則（上=正）と deltaMode の換算", () => {
    expect(normalizeDeltaPx(-100, 0)).toBe(100);
    expect(normalizeDeltaPx(100, 0)).toBe(-100);
    expect(normalizeDeltaPx(-1, 1)).toBe(40);
    expect(normalizeDeltaPx(-1, 2)).toBe(800);
  });
});
