# リリース手順

バージョンの更新から GitHub Release への zip 公開まで、リリース作業の手順を定める。
リリースの対象は main にマージ済みのコミットである。
Chrome Web Store への投稿は末尾の節で扱う。

## 前提

- `gh` CLI がインストールされ、認証済みであること（`gh auth status` で確認する）。
- git タグの push と GitHub Release の作成には、リポジトリのメンテナー権限が必要である。
- main への直接 push はルールセットで塞がれているため、バージョンの更新は PR 経由で行う。

## バージョンの保持場所と整合ルール

バージョンを保持する場所は 3 つある。

- `manifest.json` の `version`。
  MV3 上必須の値で、zip のファイル名と chrome://extensions の表示に使われる。
- `package.json` の `version`。
  `private: true` のためどのツールも参照しないが、慣習上 manifest と同じ値を保持する。
- git タグ `v<version>`。
  `v` 接頭辞を付け、zip 名と同じバージョン値から作る。

`manifest.json` と `package.json` の `version` が一致しない場合、`npm run pack` は不一致の旨を表示して中止する。
両者のずれは遅くとも pack の時点で止まる。

## 手順

1. バージョンを更新する PR を作成する。
   `manifest.json` と `package.json` の `version` を同じ値に手で更新する。
   `npm version` は使わない。
   `package.json` しか更新しないため、manifest との間で無言のずれが起きる。
2. PR をマージし、main のマージコミットにタグを打って push する。

   ```bash
   git checkout main
   git pull
   git tag v<version>
   git push origin v<version>
   ```

   タグの push は `.github/workflows/release.yml` のトリガでもある。
   本節の手動経路と後述の自動経路は、どちらか一方で行う。
   ワークフローが先にリリースを作成した場合、手順 4 の `gh release create` は同名リリースの競合で失敗するため、自動経路の後始末（生成された本文をテンプレートへ整える）に切り替える。
3. パッケージを生成する。

   ```bash
   npm run pack
   ```

   `manifest.json` の version から `yt-frame-scrub-<version>.zip` が生成される。
   同名の zip は警告なく上書きされるため、バージョンを上げ忘れたまま実行しない。
   完了時に「次の手順」として、タグの作成と push、リリース作成の各コマンドが同じバージョン値から生成されて表示される。
   生成した zip の読み込み確認は `docs/manual-test.md` の MT-22 を参照する。
4. リリースを作成し、zip を添付する。

   ```bash
   gh release create v<version> yt-frame-scrub-<version>.zip
   ```

   リリース本文は後述のテンプレートに沿って書く。

## 自動経路

`.github/workflows/release.yml` は `v*` タグの push で起動し、タグ名と `manifest.json` の version の一致を検証したうえで、`npm run pack` と `gh release create --generate-notes` を自動で実行する。
タグの push だけで済ませたい場合はこの経路を使う。

ワークフローが生成するリリース本文は PR タイトルの自動列挙であり、導入方法を含まない。
リリースが作成されたあとで本文を編集し、後述のテンプレートの形へ手で整える。

## 巻き戻し

リリースを取り消す場合は、GitHub Release とタグの両方を削除する。

```bash
gh release delete v<version>
git push origin :refs/tags/v<version>
git tag -d v<version>
```

`gh release delete` は確認プロンプトを挟む。
非対話で実行する場合は `--yes` を付ける。

## リリース本文のテンプレート

v0.1.0 と同型の構成（概要、導入方法、変更点）で書く。

````markdown
## 概要

<このリリースの内容を 1〜2 文で述べる>

### 導入方法

1. 添付の yt-frame-scrub-<version>.zip をダウンロードして展開する
2. chrome://extensions で「デベロッパーモード」を有効化する
3. 「パッケージ化されていない拡張機能を読み込む」で展開したフォルダを選択する

詳細: https://github.com/Tkg-tamagohan/yt-frame-scrub#readme

### 変更点

- <変更点を箇条書きで列挙する>
````

## Chrome Web Store への投稿

ストアへの投稿は、拡張の管理者がデベロッパーダッシュボード上で行う作業である。
本リポジトリ側で用意するものは次の通りである。

- 掲載素材は `docs/store-listing.md` にまとめてある（アイコン、説明文、プライバシー表明、カテゴリ）。
- スクリーンショットの撮影は実機の Chrome で行うユーザー作業である。
  推奨する構図も `docs/store-listing.md` を参照する。
- 投稿する zip は `npm run pack` の生成物 `yt-frame-scrub-<version>.zip` を使う。
