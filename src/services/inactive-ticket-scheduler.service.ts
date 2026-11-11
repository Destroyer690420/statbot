import { Client } from 'discord.js';
import { inactiveTicketService } from './inactive-ticket.service';
import { TICKET_MONITORING_SWEEP_INTERVAL_MS } from '../config/constants';
import { logger } from '../utils/logger';

let isSweepRunning = false;

/**
 * Executes a single automated monitoring sweep for inactive tickets.
 * Handles warnings (Day 7/10) and Day 15+ deletions.
 */
export async function runAutomatedInactivitySweep(client: Client): Promise<void> {
  if (isSweepRunning) {
    logger.info('Inactive ticket sweep already in progress; skipping duplicate trigger.');
    return;
  }

  isSweepRunning = true;
  try {
    logger.info('Running automated inactive ticket monitoring sweep...');
    const result = await inactiveTicketService.runLifecycleSweep(client, {
      dryRun: false,
      sendWarnings: true,
      deleteEligible: true,
      concurrency: 6,
      notifyAdminOnDeletion: true,
    });

    logger.info('Automated inactive ticket monitoring sweep completed', {
      scanned: result.scanned,
      active: result.active,
      firstWarningsSent: result.firstWarningsSent,
      finalWarningsSent: result.finalWarningsSent,
      deletionDue: result.deletionDue,
      deleted: result.deleted,
      protected: result.protectedCount,
      skippedBackupFailed: result.skippedBackupFailed,
    });
  } catch (error) {
    logger.error('Error during automated inactive ticket monitoring sweep', { error });
  } finally {
    isSweepRunning = false;
  }
}

/**
 * Starts the ongoing background scheduler for inactive ticket monitoring.
 * Runs every 6 hours automatically.
 */
export function startInactiveTicketScheduler(client: Client): NodeJS.Timeout {
  logger.info(
    `Starting inactive ticket monitoring scheduler (sweep every ${TICKET_MONITORING_SWEEP_INTERVAL_MS / (60 * 60 * 1000)}h)`,
  );

  // Arm periodic sweep
  const interval = setInterval(() => {
    void runAutomatedInactivitySweep(client);
  }, TICKET_MONITORING_SWEEP_INTERVAL_MS);

  // Schedule initial check 15 minutes after boot to allow startup and rehydration to settle
  setTimeout(() => {
    void runAutomatedInactivitySweep(client);
  }, 15 * 60 * 1000);

  return interval;
}

