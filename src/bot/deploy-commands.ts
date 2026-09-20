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
import { data as sendNowData } from './commands/send-now';
import { data as helpData } from './commands/help';
import { data as referralData } from './commands/referral';
import { data as mystatsData } from './commands/mystats';
import { data as myinvitesData } from './commands/myinvites';

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
  sendNowData.toJSON(),
  helpData.toJSON(),
  referralData.toJSON(),
  mystatsData.toJSON(),
  myinvitesData.toJSON(),
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

    // The on-demand scan trigger moved to DM text ("scan") — clear any
    // previously published global /scan so no stale command lingers.
    await rest.put(
      Routes.applicationCommands(env.CLIENT_ID),
      { body: [] },
    );

    logger.info('✅ Global /scan command cleared (DM text trigger).');
    console.log('✅ Global /scan command cleared (DM text trigger).');

  } catch (error) {
    logger.error('Failed to deploy commands', { error });
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  }
}

deployCommands();
