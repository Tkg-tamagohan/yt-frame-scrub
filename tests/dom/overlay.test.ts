// @vitest-environment jsdom
/**
 * overlay の DOM 統合テスト。
 * 根拠: docs/requirements-definition.md
 *   - FR-4 / 仕様決定 E: コマ送り操作中のみオーバーレイを表示し、
 *     操作停止から数秒でフェードアウトする
 *   - FR-4 / FR-7: Shadow DOM で YouTube 側のスタイルと干渉しないよう
 *     プレイヤーコンテナ内へマウントする（再マウント可能）
 * tests/overlay-format.test.ts（OV-01〜20）は表示整形の純粋関数を対象とし、
 * こちらは DOM への挿入・表示更新・フェードのタイマー挙動を対象にする。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrameOverlay } from "../../src/content/overlay";

/** オーバーレイのマウント先となるプレイヤーコンテナを作る。 */
function createContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

/** マウント済みオーバーレイの Shadow DOM 内ボックスを返す。 */
function overlayBox(container: HTMLElement): HTMLElement {
  const host = container.querySelector<HTMLElement>(
    "[data-yt-frame-scrub-overlay]",
  );
  const box = host?.shadowRoot?.querySelector<HTMLElement>(".overlay");
  if (box === null || box === undefined) {
    throw new Error("オーバーレイがマウントされていない");
  }
  return box;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("オーバーレイのマウント", () => {
  it("OV-21: attach でコンテナ内に Shadow DOM 付きのホストが挿入される", () => {
    const container = createContainer();
    const overlay = createFrameOverlay();
    expect(overlay.isAttached()).toBe(false);

    overlay.attach(container);

    expect(overlay.isAttached()).toBe(true);
    const host = container.querySelector<HTMLElement>(
      "[data-yt-frame-scrub-overlay]",
    );
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.querySelector(".overlay")).not.toBeNull();
  });

  it("OV-22: position が static のコンテナに relative を当て、detach で元へ戻す", () => {
    const container = createContainer();
    const overlay = createFrameOverlay();
    overlay.attach(container);
    // 絶対配置の基準確保のため static → relative
    expect(container.style.position).toBe("relative");

    overlay.detach();

    expect(overlay.isAttached()).toBe(false);
    expect(container.querySelector("[data-yt-frame-scrub-overlay]")).toBeNull();
    expect(container.style.position).toBe("");
  });

  it("OV-23: update で Shadow DOM 内のフレーム番号・タイムコード・fps が更新される", () => {
    const container = createContainer();
    const overlay = createFrameOverlay();
    overlay.attach(container);

    overlay.update({
      frame: 123,
      timeSeconds: 61.5,
      fps: 30,
      estimated: true,
    });

    const box = overlayBox(container);
    expect(box.children[0].textContent).toBe("F ~123");
    expect(box.children[1].textContent).toBe("00:01:01.500");
    expect(box.children[2].textContent).toBe("30 fps");
  });
});

describe("オーバーレイの表示とフェードアウト", () => {
  it("OV-24: notifyActivity で表示され、fadeoutMs 経過で非表示に戻る", () => {
    vi.useFakeTimers();
    const container = createContainer();
    const overlay = createFrameOverlay({ fadeoutMs: 1000 });
    overlay.attach(container);
    const box = overlayBox(container);
    // attach 時点では非表示（常時表示しない仕様決定 E）
    expect(box.style.opacity).toBe("0");

    overlay.notifyActivity();
    expect(box.style.opacity).toBe("1");

    vi.advanceTimersByTime(999);
    expect(box.style.opacity).toBe("1");
    vi.advanceTimersByTime(1);
    expect(box.style.opacity).toBe("0");
  });

  it("OV-25: 連続した notifyActivity はフェードアウト予約を仕切り直す", () => {
    vi.useFakeTimers();
    const container = createContainer();
    const overlay = createFrameOverlay({ fadeoutMs: 1000 });
    overlay.attach(container);
    const box = overlayBox(container);

    overlay.notifyActivity();
    vi.advanceTimersByTime(900);
    // 操作中の通知で予約が仕切り直され、最初の予約時刻では消えない
    overlay.notifyActivity();
    vi.advanceTimersByTime(900);
    expect(box.style.opacity).toBe("1");
    vi.advanceTimersByTime(100);
    expect(box.style.opacity).toBe("0");
  });

  it("OV-26: setEnabled(false) で即座に非表示となり通知でも表示されない", () => {
    const container = createContainer();
    const overlay = createFrameOverlay();
    overlay.attach(container);
    const box = overlayBox(container);

    overlay.notifyActivity();
    expect(box.style.opacity).toBe("1");

    overlay.setEnabled(false);
    expect(box.style.opacity).toBe("0");
    // overlayEnabled が false の間は操作通知でも表示しない（FR-6 の設定反映）
    overlay.notifyActivity();
    expect(box.style.opacity).toBe("0");

    overlay.setEnabled(true);
    overlay.notifyActivity();
    expect(box.style.opacity).toBe("1");
  });
});

describe("オーバーレイの再マウント", () => {
  it("OV-27: 別コンテナへの attach は移動となり、旧コンテナの位置指定と表示値を持ち越さない", () => {
    const first = createContainer();
    const second = createContainer();
    const overlay = createFrameOverlay();

    overlay.attach(first);
    overlay.update({
      frame: 123,
      timeSeconds: 61.5,
      fps: 30,
      estimated: true,
    });
    overlay.notifyActivity();

    overlay.attach(second);

    // ホスト要素ごと新しいコンテナへ移る
    const host = second.querySelector("[data-yt-frame-scrub-overlay]");
    expect(host).not.toBeNull();
    expect(first.querySelector("[data-yt-frame-scrub-overlay]")).toBeNull();
    expect(overlay.isAttached()).toBe(true);
    // 旧コンテナへ当てた position: relative は復元される
    expect(first.style.position).toBe("");
    expect(second.style.position).toBe("relative");
    // 表示値と表示状態はリセットされる（旧動画の値を持ち越さない）
    const box = overlayBox(second);
    expect(box.children[0].textContent).toBe("F ?");
    expect(box.children[1].textContent).toBe("--:--:--.---");
    expect(box.children[2].textContent).toBe("? fps");
    expect(box.style.opacity).toBe("0");
  });
});
