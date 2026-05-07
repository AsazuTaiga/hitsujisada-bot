interface Env {
  DISCORD_PUBLIC_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  data?: {
    name?: string;
    options?: Array<{
      name: string;
      type: number;
      value?: string | number | boolean;
    }>;
  };
  member?: {
    user?: {
      username?: string;
      global_name?: string | null;
    };
  };
  user?: {
    username?: string;
    global_name?: string | null;
  };
}

interface GeminiResponseBody {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  error?: {
    message?: string;
  };
}

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE = 4;
const RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE = 5;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "GET") {
      return json({ ok: true, service: "hitsujisada-bot" });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await request.text();
    const isValid = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY);
    if (!isValid) {
      return new Response("invalid request signature", { status: 401 });
    }

    const interaction = parseInteraction(body);
    if (interaction.type === INTERACTION_TYPE_PING) {
      return json({ type: RESPONSE_TYPE_PONG });
    }

    if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
      return json({
        type: RESPONSE_TYPE_CHANNEL_MESSAGE,
        data: {
          content: "この interaction type には対応していません。",
          flags: 64
        }
      });
    }

    const commandName = interaction.data?.name;
    if (commandName !== "ask") {
      return json({
        type: RESPONSE_TYPE_CHANNEL_MESSAGE,
        data: {
          content: "未知のコマンドです。",
          flags: 64
        }
      });
    }

    const prompt = getStringOption(interaction, "prompt")?.trim();
    if (!prompt) {
      return json({
        type: RESPONSE_TYPE_CHANNEL_MESSAGE,
        data: {
          content: "質問が空です。`prompt` に聞きたい内容を入れてください。",
          flags: 64
        }
      });
    }

    ctx.waitUntil(answerLater(interaction, prompt, env));
    return json({
      type: RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE
    });
  }
};

async function answerLater(interaction: DiscordInteraction, prompt: string, env: Env): Promise<void> {
  const userName =
    interaction.member?.user?.global_name ??
    interaction.user?.global_name ??
    interaction.member?.user?.username ??
    interaction.user?.username ??
    "Discord user";

  try {
    const answer = await callGemini(prompt, userName, env);
    await editOriginalInteractionResponse(interaction, formatAnswerWithUserInput(prompt, answer));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await editOriginalInteractionResponse(
      interaction,
      `LLM の呼び出しに失敗しました: ${truncateDiscordMessage(message)}`
    );
  }
}

async function callGemini(prompt: string, userName: string, env: Env): Promise<string> {
  const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: "You are hitsujisada-bot, a concise Discord assistant. Reply in the user's language. Keep answers helpful and under 1800 characters."
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Discord user: ${userName}\n\n${prompt}`
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 700
        }
      })
    }
  );

  const body = (await response.json()) as GeminiResponseBody;
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Gemini API returned HTTP ${response.status}`);
  }

  return truncateDiscordMessage(extractGeminiText(body) || "返答が空でした。");
}

function extractGeminiText(body: GeminiResponseBody): string {
  const parts: string[] = [];
  for (const candidate of body.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function editOriginalInteractionResponse(
  interaction: DiscordInteraction,
  content: string
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        content
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord follow-up failed: HTTP ${response.status} ${body}`);
  }
}

function parseInteraction(body: string): DiscordInteraction {
  return JSON.parse(body) as DiscordInteraction;
}

function getStringOption(interaction: DiscordInteraction, name: string): string | undefined {
  const option = interaction.data?.options?.find((item) => item.name === name);
  return typeof option?.value === "string" ? option.value : undefined;
}

async function verifyDiscordRequest(
  request: Request,
  body: string,
  publicKeyHex: string
): Promise<boolean> {
  const signatureHex = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signatureHex || !timestamp || !publicKeyHex) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const signedMessage = new TextEncoder().encode(`${timestamp}${body}`);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signatureHex),
      signedMessage
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have an even length");
  }

  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function truncateDiscordMessage(message: string): string {
  return message.length > 1900 ? `${message.slice(0, 1897)}...` : message;
}

function formatAnswerWithUserInput(prompt: string, answer: string): string {
  return truncateDiscordMessage(`user:「${prompt}」\n\n${answer}`);
}

function json(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init?.headers
    }
  });
}
