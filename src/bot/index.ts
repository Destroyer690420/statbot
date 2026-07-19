import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { handleInteractionCreate } from './events/interactionCreate';
import { handleMessageCreate } from './events/messageCreate';

/**
 * Create and configure the Discord bot client.
 */
export function createBotClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
    ],
  });

  // ─── Event Listeners ────────────────────────────────────────

  client.once('ready', (readyClient) => {
    logger.info(`Discord bot logged in as ${readyClient.user.tag}`);
    logger.info(`Serving ${readyClient.guilds.cache.size} guild(s)`);
  });

  client.on('interactionCreate', handleInteractionCreate);
  client.on('messageCreate', handleMessageCreate);

  client.on('error', (error) => {
    logger.error('Discord client error', { error: error.message });
  });

  client.on('warn', (warning) => {
    logger.warn('Discord client warning', { warning });
  });

  return client;
}

/**
 * Start the Discord bot.
 */
export async function startBot(client: Client): Promise<void> {
  await client.login(env.DISCORD_TOKEN);
}
