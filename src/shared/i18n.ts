/**
 * chrome.i18n の薄いヘルパー。
 * 文言は _locales/<locale>/messages.json に定義し、manifest の
 * default_locale 設定と合わせて実行時の UI 言語へ解決される。
 * 拡張機能ページ(オプション画面など)とサービスワーカーの両方から使える。
 */

/**
 * メッセージキーの文言を取得する。
 * 未定義キーは空文字が返るため、デバッグ用にキー自体をフォールバックとして返す。
 */
export function t(key: string, substitutions?: string | string[]): string {
  const message = chrome.i18n.getMessage(key, substitutions);
  return message === "" ? key : message;
}

/**
 * data-i18n 属性を持つ要素の textContent を messages.json の文言で置き換える。
 * `data-i18n-attrs="属性:キー,属性:キー"` 形式で属性への適用もできる
 * (例: data-i18n-attrs="title:hintKey" → title 属性を文言で上書き)。
 * documentElement.lang も UI 言語へ揃える。
 */
export function localizePage(root: ParentNode = document): void {
  if (root instanceof Document) {
    root.documentElement.lang = chrome.i18n.getUILanguage();
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key !== undefined && key !== "") {
      element.textContent = t(key);
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-attrs]")) {
    const mapping = element.dataset.i18nAttrs;
    if (mapping === undefined) {
      continue;
    }
    for (const pair of mapping.split(",")) {
      const [attribute, key] = pair.split(":");
      if (attribute !== undefined && key !== undefined) {
        element.setAttribute(attribute.trim(), t(key.trim()));
      }
    }
  }
}
