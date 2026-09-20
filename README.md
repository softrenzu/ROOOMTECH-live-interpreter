# Live Interpreter

OpenAI `gpt-realtime-translate` と WebRTC を使った、低遅延のリアルタイム同時通訳PWAです。

## 特徴

- 音声はブラウザから OpenAI へ WebRTC で直接送信
- 話している途中から翻訳音声をストリーミング再生
- 原文・翻訳字幕をリアルタイム表示
- 日本語 / 英語 / 韓国語 / 中国語 / スペイン語 / フランス語 / ドイツ語 / イタリア語 / ポルトガル語 / タイ語 / ベトナム語 / インドネシア語
- 言語をワンタップで入れ替え
- iPhone / Android でホーム画面に追加可能
- 通常の OpenAI API キーはブラウザに渡さず、短寿命のクライアントシークレットだけを発行

## 起動

Node.js 20以上を使用します。依存パッケージはありません。

macOS / Linux:

```bash
export OPENAI_API_KEY="sk-proj-..."
node server.mjs
```

Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="sk-proj-..."
node server.mjs
```

ブラウザで `http://localhost:3000` を開きます。

## Render へ公開

このリポジトリには `render.yaml` が含まれています。Render で Blueprint としてこのリポジトリを接続し、環境変数 `OPENAI_API_KEY` に自分の OpenAI API キーを設定してください。

マイク利用には HTTPS が必要ですが、Render の公開URLは HTTPS です。

## スマホで使う場合

必須環境変数:

- `OPENAI_API_KEY`
- `PORT` は任意（既定 3000）

## 仕組み

1. ブラウザが `/session` に翻訳先言語を送信
2. サーバーが OpenAI に短寿命の Translation client secret を発行依頼
3. ブラウザはその client secret を使って `v1/realtime/translations/calls` に WebRTC 接続
4. マイク音声をメディアトラックとして直接送信
5. 翻訳音声をリモート音声トラックとして即時再生
6. DataChannel から原文・翻訳字幕の delta を受信

## 現在の仕様

1台のスマホで使う場合は、選択した方向に翻訳します。相手が話す番になったら `⇄` で方向を切り替えます。

本当に2人が同時に話す双方向通訳は、各話者の音声トラックを分離して翻訳方向ごとに1セッションずつ持つ構成が必要です。2台の端末、WebRTC通話、または会議ルーム機能として拡張するのが適切です。

## セキュリティ

- APIキーを `public/` 以下に置かないでください。
- `.env` やシークレットはGitにコミットしないでください。
- 公開運用では `/session` にログイン・レート制限を追加してください。
