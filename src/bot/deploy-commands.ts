import { REST, Routes } from 'discord.js';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Import command data
import { data as taskData } from './commands/task';
import { data as statusData } from './commands/status';
import { data as findData } from './commands/find';
import { data as deleteData } from './commands/delete';
import { data as pendingData } from './commands/pending';
import { data as completedData } from './commands/completed';
import { data as overdueData } from './commands/overdue';
import { data as statsData } from './commands/stats';
import { data as rescheduleData } from './commands/reschedule';
import { data as helpData } from './commands/help';

const commands = [
  taskData.toJSON(),
  statusData.toJSON(),
  findData.toJSON(),
  deleteData.toJSON(),
  pendingData.toJSON(),
  completedData.toJSON(),
  overdueData.toJSON(),
  statsData.toJSON(),
  rescheduleData.toJSON(),
  helpData.toJSON(),
];

async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  try {
    logger.info(`Deploying ${commands.length} slash commands...`);

    await rest.put(
      Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID),
      { body: commands },
    );

    logger.info('✅ Slash commands deployed successfully!');
    console.log('✅ Slash commands deployed successfully!');

  } catch (error) {
    logger.error('Failed to deploy commands', { error });
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  }
}

deployCommands();
