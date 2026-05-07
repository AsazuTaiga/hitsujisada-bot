# hitsujisada-bot

Bun と Cloudflare Workers で動く LLM Discord bot です。Discord の Interactions Endpoint で `/ask` slash command を受け、Gemini Developer API で返答します。

## 必要なもの

- Bun
- Cloudflare account
- Discord application
- Gemini API key

## セットアップ

```bash
bun install
```

Cloudflare Worker に secret を登録します。

```bash
bunx wrangler secret put DISCORD_PUBLIC_KEY
bunx wrangler secret put GEMINI_API_KEY
```

Discord slash command 登録用の値はローカル環境変数で渡します。`DISCORD_GUILD_ID` を指定すると特定サーバーだけに即時反映され、未指定なら global command として登録されます。

```bash
export DISCORD_APPLICATION_ID="..."
export DISCORD_BOT_TOKEN="..."
export DISCORD_GUILD_ID="..."
bun run register
```

## ローカル起動

`.dev.vars` を作る場合は次の値を入れます。

```dotenv
DISCORD_PUBLIC_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

```bash
bun run dev
```

Discord Developer Portal の Interactions Endpoint URL に、`wrangler dev` または deploy 後の Worker URL を設定します。

## デプロイ

```bash
bun run deploy
```

## Bot の使い方

Discord 上で次の slash command を実行します。

```text
/ask prompt: 今日の予定を3行で整理して
```

## 実装メモ

- Discord の署名検証は `x-signature-ed25519` と `x-signature-timestamp` を Cloudflare Workers の Web Crypto Ed25519 で検証します。
- Discord の 3 秒応答制限に合わせ、最初に deferred response を返し、`ctx.waitUntil()` で LLM 呼び出し後に original response を更新します。
- Gemini の model は `wrangler.toml` の `GEMINI_MODEL` で変更できます。
