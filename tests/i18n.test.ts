/**
 * i18n キー整合の回帰テスト。
 * 非機能要件「拡張機能が提供する UI は日本語と英語に対応する」を根拠に、
 * manifest の __MSG_ 参照と options.html の data-i18n 系属性が
 * ja・en 両ロケールの messages.json で解決できることを機械検査する。
 * manifest description の未ローカライズ(日本語直書き)の再発を防ぐのが目的。
 * ID 規約は I18N-番号。
 */

/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import enMessagesRaw from "../_locales/en/messages.json?raw";
import jaMessagesRaw from "../_locales/ja/messages.json?raw";
import manifestRaw from "../manifest.json?raw";
import optionsHtmlRaw from "../src/options/options.html?raw";

const LOCALES = {
  ja: JSON.parse(jaMessagesRaw) as Record<string, unknown>,
  en: JSON.parse(enMessagesRaw) as Record<string, unknown>,
};

function messageKeys(locale: keyof typeof LOCALES): string[] {
  return Object.keys(LOCALES[locale]).sort();
}

describe("i18n キー整合", () => {
  it("I18N-01: ja と en のメッセージキー集合が一致する", () => {
    expect(messageKeys("ja")).toEqual(messageKeys("en"));
  });

  it("I18N-02: manifest.json の __MSG_ 参照が全ロケールに存在する", () => {
    const referenced = [...manifestRaw.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map(
      (match) => match[1],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      const keys = new Set(messageKeys(locale));
      for (const key of referenced) {
        expect(keys.has(key), `${locale} に ${key} が無い`).toBe(true);
      }
    }
  });

  it("I18N-04: manifest.json の description が __MSG_ 参照である", () => {
    const manifest = JSON.parse(manifestRaw) as { description?: string };
    expect(manifest.description).toMatch(/^__MSG_[A-Za-z0-9_@]+__$/);
  });

  it("I18N-03: options.html の data-i18n / data-i18n-attrs キーが全ロケールに存在する", () => {
    const keys = new Set<string>();
    for (const match of optionsHtmlRaw.matchAll(/data-i18n="([^"]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of optionsHtmlRaw.matchAll(/data-i18n-attrs="([^"]+)"/g)) {
      for (const pair of match[1].split(",")) {
        const key = pair.split(":")[1];
        if (key !== undefined) {
          keys.add(key.trim());
        }
      }
    }
    expect(keys.size).toBeGreaterThan(0);
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      const defined = new Set(messageKeys(locale));
      for (const key of keys) {
        expect(defined.has(key), `${locale} に ${key} が無い`).toBe(true);
      }
    }
  });
});
