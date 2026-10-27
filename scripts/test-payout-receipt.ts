import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { env } from '../src/config/env';
import { generatePayoutReceipt } from '../src/services/payout-receipt.service';

async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await client.login(env.DISCORD_TOKEN);
  console.log('Bot logged in as:', client.user?.tag);

  const guild = await client.guilds.fetch(env.GUILD_ID);
  const channels = await guild.channels.fetch();

  const targetChannel = channels.find((c) => c?.name === 'ticket-0595');
  if (!targetChannel || !targetChannel.isTextBased()) {
    console.error('Channel ticket-0595 not found or not text based!');
    client.destroy();
    process.exit(1);
  }

  console.log('Found ticket-0595:', targetChannel.id);

  const receipt = await generatePayoutReceipt({
    amount: 420,
    payeeLabel: 'ticket-0595',
    upiId: null,
    paidAt: new Date(),
  });

  await (targetChannel as any).send({
    content: '🧪 Test Payout Receipt (Amount: ₹420)',
    files: [{ attachment: receipt, name: 'test-payout-receipt-420.png' }],
  });

  console.log('Successfully posted receipt to ticket-0595!');
  client.destroy();
}

main().catch((err) => {
  console.error('Error running test script:', err);
  process.exit(1);
});
