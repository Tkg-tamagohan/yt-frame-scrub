/**
 * overlay.ts の DOM 非依存な整形関数の単体テスト。
 * 期待値は要件定義書 FR-4(タイムコード `HH:MM:SS.mmm`、フレーム番号は推定値、
 * 推定 fps を表示)を根拠とし、文書に明記のない振る舞い(負値・非有限値・
 * ミリ秒未満の丸め)は関数コメントに記した仕様として採番する。
 * ID 規約は OV-番号。
 */

import { describe, expect, it } from "vitest";

import {
  formatFrameNumber,
  formatFps,
  formatTimecode,
} from "../src/content/overlay";

describe("formatTimecode", () => {
  it("OV-01: 0 秒は 00:00:00.000", () => {
    expect(formatTimecode(0)).toBe("00:00:00.000");
  });

  it("OV-02: 1 分 23.456 秒は 00:01:23.456", () => {
    expect(formatTimecode(83.456)).toBe("00:01:23.456");
  });

  it("OV-03: 60 分超は時間の桁を増やす(3661.5 秒 → 01:01:01.500)", () => {
    expect(formatTimecode(3661.5)).toBe("01:01:01.500");
  });

  it("OV-04: ミリ秒未満の丸めが秒へ繰り上がる(1.9996 → 00:00:02.000)", () => {
    expect(formatTimecode(1.9996)).toBe("00:00:02.000");
  });

  it("OV-05: ミリ秒丸めが分へ繰り上がる(59.9999 → 00:01:00.000)", () => {
    expect(formatTimecode(59.9999)).toBe("00:01:00.000");
  });

  it("OV-06: 負値は符号付きで整形する(-1.5 → -00:00:01.500)", () => {
    expect(formatTimecode(-1.5)).toBe("-00:00:01.500");
  });

  it("OV-07: ミリ秒未満は四捨五入する(12.3456789 → 00:00:12.346)", () => {
    expect(formatTimecode(12.3456789)).toBe("00:00:12.346");
  });

  it("OV-08: NaN はプレースホルダ --:--:--.---", () => {
    expect(formatTimecode(Number.NaN)).toBe("--:--:--.---");
  });

  it("OV-09: Infinity はプレースホルダ --:--:--.---", () => {
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("--:--:--.---");
    expect(formatTimecode(Number.NEGATIVE_INFINITY)).toBe("--:--:--.---");
  });

  it("OV-10: 時間は 2 桁にパディングし上限で丸めない(7200 → 02:00:00.000)", () => {
    expect(formatTimecode(7200)).toBe("02:00:00.000");
  });

  it("OV-11: 秒・ミリ秒は 2 桁/3 桁へパディングする(5.5 → 00:00:05.500)", () => {
    expect(formatTimecode(5.5)).toBe("00:00:05.500");
  });
});

describe("formatFrameNumber", () => {
  it("OV-12: 整数は F 1234 形式", () => {
    expect(formatFrameNumber(1234)).toBe("F 1234");
  });

  it("OV-13: 小数は四捨五入する(12.5 → F 13)", () => {
    expect(formatFrameNumber(12.5)).toBe("F 13");
    expect(formatFrameNumber(12.4)).toBe("F 12");
  });

  it("OV-14: 推定値は ~ を付ける(F ~1234)", () => {
    expect(formatFrameNumber(1234, true)).toBe("F ~1234");
  });

  it("OV-15: 負値は符号付きで表示する(-3 → F -3)", () => {
    expect(formatFrameNumber(-3)).toBe("F -3");
  });

  it("OV-16: 非有限値は F ?", () => {
    expect(formatFrameNumber(Number.NaN)).toBe("F ?");
    expect(formatFrameNumber(Number.POSITIVE_INFINITY)).toBe("F ?");
  });
});

describe("formatFps", () => {
  it("OV-17: 整数 fps は 30 fps", () => {
    expect(formatFps(30)).toBe("30 fps");
    expect(formatFps(60)).toBe("60 fps");
  });

  it("OV-18: 非整数 fps は小数 2 位まで表示する(29.97 → 29.97 fps)", () => {
    expect(formatFps(29.97)).toBe("29.97 fps");
  });

  it("OV-19: 小数 3 位以降は丸める(23.976 → 23.98 fps)", () => {
    expect(formatFps(23.976)).toBe("23.98 fps");
  });

  it("OV-20: 0 以下と非有限値は検出失敗として ? fps", () => {
    expect(formatFps(0)).toBe("? fps");
    expect(formatFps(-1)).toBe("? fps");
    expect(formatFps(Number.NaN)).toBe("? fps");
  });
});
