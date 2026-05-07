interface DiscordCommand {
  name: string;
  description: string;
  type: number;
  options?: Array<{
    name: string;
    description: string;
    type: number;
    required?: boolean;
  }>;
}

declare const process: {
  env: Record<string, string | undefined>;
};

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !botToken) {
  throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required.");
}

const commands: DiscordCommand[] = [
  {
    name: "ask",
    description: "hitsujisada-bot に質問します",
    type: 1,
    options: [
      {
        name: "prompt",
        description: "質問内容",
        type: 3,
        required: true
      }
    ]
  }
];

const route = guildId
  ? `/applications/${applicationId}/guilds/${guildId}/commands`
  : `/applications/${applicationId}/commands`;

const response = await fetch(`https://discord.com/api/v10${route}`, {
  method: "PUT",
  headers: {
    authorization: `Bot ${botToken}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(commands)
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Failed to register Discord commands: HTTP ${response.status} ${body}`);
}

console.log(body);

export {};
