import fs from 'fs';
import path from 'path';
import { Collection, Message, TextChannel } from 'discord.js';
import { getDb } from '../database/db';
import { TICKET_BACKUP_BASE_DIR } from '../config/constants';
import { logger } from './logger';

export interface TicketBackupSummary {
  channelId: string;
  channelName: string;
  workerId: string | null;
  workerUsername: string | null;
  backupDir: string;
  messagesCount: number;
  attachmentsCount: number;
  downloadedAttachmentsCount: number;
  tasksCount: number;
  createdAt: string;
}

export interface BackupResult {
  success: boolean;
  backupDir: string;
  messagesCount: number;
  attachmentsCount: number;
  error?: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/**
 * Downloads a remote file to a local path with retries.
 */
async function downloadAttachment(url: string, destPath: string, retries = 2): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          // Permanently gone on CDN
          return false;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      return true;
    } catch (err) {
      if (attempt === retries) {
        logger.warn('Failed downloading ticket attachment', { url, destPath, error: err });
        return false;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return false;
}

/**
 * Backs up a complete Discord ticket channel before deletion:
 * 1. Fetches all messages in the channel (newest to oldest).
 * 2. Downloads all attachments (screenshots, proofs, images) to disk.
 * 3. Fetches all database records (tasks, reminders, payouts, onboarding, payment info).
 * 4. Writes structured transcript.json, human-readable transcript.txt, and metadata.json.
 * 5. Verifies files on disk before returning success.
 */
export async function backupTicketChannel(
  channel: TextChannel,
  workerId: string | null,
  workerUsername: string | null = null,
  baseDir: string = TICKET_BACKUP_BASE_DIR,
): Promise<BackupResult> {
  const channelDir = path.resolve(process.cwd(), baseDir, channel.id);
  const attachmentsDir = path.join(channelDir, 'attachments');

  try {
    fs.mkdirSync(attachmentsDir, { recursive: true });

    // 1. Fetch all messages in the channel
    const messages: Message[] = [];
    let lastId: string | undefined = undefined;

    while (true) {
      const batch: Collection<string, Message> = await channel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {}),
      });

      if (batch.size === 0) break;
      for (const msg of batch.values()) {
        messages.push(msg);
      }
      const batchValues: Message[] = Array.from(batch.values());
      lastId = batchValues[batchValues.length - 1]?.id;
      if (batch.size < 100) break;
    }

    // Sort chronologically (oldest to newest)
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // 2. Process messages and download attachments
    let totalAttachments = 0;
    let downloadedAttachments = 0;

    const messageRecords = [];
    for (const msg of messages) {
      const attRecords = [];

      for (const att of msg.attachments.values()) {
        totalAttachments += 1;
        const sanitized = sanitizeFilename(att.name || 'attachment');
        const filename = `${att.id}_${sanitized}`;
        const localFilePath = path.join(attachmentsDir, filename);

        const ok = await downloadAttachment(att.url, localFilePath);
        if (ok) downloadedAttachments += 1;

        attRecords.push({
          id: att.id,
          name: att.name,
          url: att.url,
          contentType: att.contentType,
          size: att.size,
          localPath: ok ? path.relative(channelDir, localFilePath).replace(/\\/g, '/') : null,
          downloaded: ok,
        });
      }

      messageRecords.push({
        id: msg.id,
        author: {
          id: msg.author.id,
          tag: msg.author.tag,
          username: msg.author.username,
          bot: msg.author.bot,
        },
        content: msg.content,
        createdAt: msg.createdAt.toISOString(),
        attachments: attRecords,
        embeds: msg.embeds.map((e) => ({
          title: e.title,
          description: e.description,
          fields: e.fields,
          footer: e.footer?.text,
        })),
      });
    }

    // 3. Query associated database records
    const db = getDb();
    const tasks = await db.task.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: 'asc' },
    });

    const taskIds = tasks.map((t) => t.id);
    const reminders = taskIds.length > 0
      ? await db.reminder.findMany({ where: { taskId: { in: taskIds } } })
      : [];
    const payoutItems = taskIds.length > 0
      ? await db.payoutItem.findMany({ where: { taskId: { in: taskIds } } })
      : [];

    const onboarding = await db.ticketOnboarding.findUnique({
      where: { channelId: channel.id },
    }).catch(() => null);

    const portalAccess = await db.workerPortalAccess.findUnique({
      where: { channelId: channel.id },
    }).catch(() => null);

    const paymentInfo = workerId
      ? await db.workerPaymentInfo.findUnique({ where: { workerId } }).catch(() => null)
      : null;

    const referrals = workerId
      ? await db.referral.findMany({
          where: {
            OR: [
              { inviteeId: workerId },
              { inviterId: workerId },
              { ticketId: channel.name },
            ],
          },
        }).catch(() => [])
      : [];

    // 4. Build and save transcript.json
    const transcriptData = {
      channel: {
        id: channel.id,
        name: channel.name,
        guildId: channel.guildId,
        createdAt: channel.createdAt.toISOString(),
      },
      worker: {
        id: workerId,
        username: workerUsername,
      },
      backedUpAt: new Date().toISOString(),
      messageCount: messageRecords.length,
      attachmentCount: totalAttachments,
      downloadedAttachmentCount: downloadedAttachments,
      messages: messageRecords,
      database: {
        tasks,
        reminders,
        payoutItems,
        onboarding,
        portalAccess,
        paymentInfo,
        referrals,
      },
    };

    const transcriptJsonPath = path.join(channelDir, 'transcript.json');
    fs.writeFileSync(transcriptJsonPath, JSON.stringify(transcriptData, null, 2), 'utf8');

    // 5. Build and save transcript.txt (human-readable)
    const textLines = [
      `================================================================================`,
      `TICKET TRANSCRIPT: #${channel.name} (${channel.id})`,
      `Worker: ${workerUsername || 'unknown'} (${workerId || 'none'})`,
      `Channel Created: ${channel.createdAt.toISOString()}`,
      `Backup Created: ${new Date().toISOString()}`,
      `Messages: ${messageRecords.length} | Attachments: ${downloadedAttachments}/${totalAttachments} saved`,
      `Tasks on Record: ${tasks.length}`,
      `================================================================================\n`,
    ];

    for (const m of messageRecords) {
      const role = m.author.bot ? '[BOT]' : `[USER:${m.author.id}]`;
      textLines.push(`[${m.createdAt}] ${role} ${m.author.tag}: ${m.content}`);
      for (const a of m.attachments) {
        textLines.push(`   📎 Attachment: ${a.name} (${a.localPath ? `saved: ${a.localPath}` : 'remote only'})`);
      }
      for (const e of m.embeds) {
        if (e.title) textLines.push(`   📋 Embed: ${e.title} - ${e.description || ''}`);
      }
    }

    const transcriptTxtPath = path.join(channelDir, 'transcript.txt');
    fs.writeFileSync(transcriptTxtPath, textLines.join('\n'), 'utf8');

    // 6. Build and save metadata.json
    const metadata: TicketBackupSummary = {
      channelId: channel.id,
      channelName: channel.name,
      workerId,
      workerUsername,
      backupDir: channelDir,
      messagesCount: messageRecords.length,
      attachmentsCount: totalAttachments,
      downloadedAttachmentsCount: downloadedAttachments,
      tasksCount: tasks.length,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(channelDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

    // Verify files on disk
    if (!fs.existsSync(transcriptJsonPath) || fs.statSync(transcriptJsonPath).size === 0) {
      throw new Error('transcript.json was not created or is empty');
    }
    if (!fs.existsSync(transcriptTxtPath) || fs.statSync(transcriptTxtPath).size === 0) {
      throw new Error('transcript.txt was not created or is empty');
    }

    logger.info('Ticket backup completed successfully', {
      channelId: channel.id,
      channelName: channel.name,
      messages: messageRecords.length,
      attachments: downloadedAttachments,
      path: channelDir,
    });

    return {
      success: true,
      backupDir: channelDir,
      messagesCount: messageRecords.length,
      attachmentsCount: downloadedAttachments,
    };
  } catch (error) {
    const errStr = error instanceof Error ? error.message : String(error);
    logger.error('Failed to backup ticket channel', {
      channelId: channel.id,
      channelName: channel.name,
      error: errStr,
    });
    return {
      success: false,
      backupDir: channelDir,
      messagesCount: 0,
      attachmentsCount: 0,
      error: errStr,
    };
  }
}
