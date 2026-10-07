// @vitest-environment jsdom
/**
 * players の DOM 統合テスト。
 * 根拠: docs/requirements-definition.md
 *   - FR-7 / 仕様決定 D: watch ページと Shorts ページを対象とし、
 *     ミニプレイヤーでも同一の動画要素を追従する
 * tests/gating.test.ts の pageKindOf（GT-01〜03）は純粋関数を対象とし、
 * こちらは document.querySelector / closest / getBoundingClientRect を
 * 介した DOM 上でのプレイヤー検出を対象にする。
 * jsdom の getBoundingClientRect は常にゼロ矩形を返すため、
 * ビューポート占有率が関わるケースはスタブで矩形を与える。
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  findActivePlayer,
  findMiniplayer,
  findShortsPlayer,
  findWatchPlayer,
} from "../../src/content/players";

/** ビューポート占有率の採点へ効く矩形を指定して getBoundingClientRect をスタブする。 */
function stubRect(
  element: Element,
  rect: { top: number; bottom: number; height: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findWatchPlayer", () => {
  it("PL-01: watch の DOM から html5-main-video と html5-video-player コンテナを検出する", () => {
    document.body.innerHTML = `
      <div id="movie_player">
        <div class="html5-video-player">
          <video class="html5-main-video"></video>
        </div>
      </div>`;

    const target = findWatchPlayer();

    expect(target).not.toBeNull();
    expect(target?.page).toBe("watch");
    expect(target?.video.className).toBe("html5-main-video");
    // コンテナは video.closest(".html5-video-player") で推定する
    expect(target?.container.classList.contains("html5-video-player")).toBe(
      true,
    );
    expect(target?.container.contains(target!.video)).toBe(true);
  });

  it("PL-02: watch プレイヤーが存在しないページでは null を返す", () => {
    document.body.innerHTML = `<div id="content"></div>`;
    expect(findWatchPlayer()).toBeNull();
  });
});

describe("findShortsPlayer", () => {
  it("PL-03: is-active 属性を持つレンダラーの動画を最優先で選ぶ", () => {
    document.body.innerHTML = `
      <ytd-reel-video-renderer><video class="html5-main-video"></video></ytd-reel-video-renderer>
      <ytd-reel-video-renderer is-active><video class="html5-main-video"></video></ytd-reel-video-renderer>`;
    const active = document.querySelectorAll("video")[1];

    const target = findShortsPlayer();

    expect(target?.page).toBe("shorts");
    expect(target?.video).toBe(active);
  });

  it("PL-04: is-active がなければビューポート占有率の高いレンダラーを選ぶ", () => {
    document.body.innerHTML = `
      <ytd-reel-video-renderer><video class="html5-main-video"></video></ytd-reel-video-renderer>
      <ytd-reel-video-renderer><video class="html5-main-video"></video></ytd-reel-video-renderer>`;
    const renderers = document.querySelectorAll("ytd-reel-video-renderer");
    // 先頭はほぼ画面外、後続は完全に画面内（現行 YouTube では is-active が
    // 付かない実機確認があるため占有率が主指標）
    stubRect(renderers[0], { top: -500, bottom: 100, height: 600 });
    stubRect(renderers[1], { top: 0, bottom: 600, height: 600 });

    const target = findShortsPlayer();

    expect(target?.video).toBe(renderers[1].querySelector("video"));
  });

  it("PL-05: 動画を持つレンダラーがなければ null を返す", () => {
    document.body.innerHTML = `
      <ytd-reel-video-renderer></ytd-reel-video-renderer>
      <div></div>`;
    expect(findShortsPlayer()).toBeNull();
  });
});

describe("findMiniplayer / findActivePlayer", () => {
  it("PL-06: ytd-miniplayer 内または ytp-mini コンテナ内の動画をミニプレイヤーとして拾う", () => {
    document.body.innerHTML = `
      <ytd-miniplayer>
        <div class="html5-video-player"><video class="html5-main-video"></video></div>
      </ytd-miniplayer>`;
    const inMini = document.querySelector("video");

    expect(findMiniplayer()?.video).toBe(inMini);

    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player ytp-mini">
        <video class="html5-main-video"></video>
      </div>`;

    const target = findMiniplayer();
    expect(target?.page).toBe("watch");
    expect(target?.container.classList.contains("ytp-mini")).toBe(true);
  });

  it("PL-07: 対象外ページはミニプレイヤーへフォールバックし、なければ null", () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player">
        <video class="html5-main-video"></video>
      </div>`;
    // /watch ではなく検索ページ: メインプレイヤーは休眠扱いで拾わない
    expect(findActivePlayer("/results")).toBeNull();

    document.body.innerHTML = `
      <ytd-miniplayer>
        <div class="html5-video-player"><video class="html5-main-video"></video></div>
      </ytd-miniplayer>`;
    expect(findActivePlayer("/results")?.page).toBe("watch");
  });
});
