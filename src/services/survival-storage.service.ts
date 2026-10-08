import * as fs from 'fs/promises';
import * as path from 'path';
import { SURVIVAL_TTL_MS } from '../config/constants';
import { logger } from '../utils/logger';

const UPLOADS_DIR = path.resolve('uploads', 'survival');

/**
 * 10-minute survival screenshots. Same shape as insight storage but with a
 * 15-day TTL (payment evidence, not a transient reminder attachment).
 * Files: uploads/survival/<taskId>/survival-<attempt>.png
 * Served unauthenticated via /api/v1/uploads/survival/... (accepted risk,
 * same as insights).
 */
class SurvivalStorageService {
  async save(taskId: string, attempt: number, buffer: Buffer): Promise<{ url: string; filename: string }> {
    const filename = `survival-${attempt}.png`;
    const dir = path.join(UPLOADS_DIR, taskId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    return {
      url: `/api/v1/uploads/survival/${encodeURIComponent(taskId)}/${filename}`,
      filename,
    };
  }

  async cleanup(): Promise<number> {
    let deleted = 0;
    const cutoff = Date.now() - SURVIVAL_TTL_MS;
    try {
      const taskDirs = await fs.readdir(UPLOADS_DIR);
      for (const taskId of taskDirs) {
        const taskDir = path.join(UPLOADS_DIR, taskId);
        let files: string[];
        try {
          files = await fs.readdir(taskDir);
        } catch {
          continue;
        }
        const remaining: string[] = [];
        for (const file of files) {
          const filePath = path.join(taskDir, file);
          try {
            const stat = await fs.stat(filePath);
            if (stat.mtimeMs < cutoff) {
              await fs.unlink(filePath);
              deleted++;
            } else {
              remaining.push(file);
            }
          } catch {
            // Skip files that fail to stat or unlink
          }
        }
        try {
          if (remaining.length === 0) await fs.rmdir(taskDir);
        } catch {
          // Skip if unable to remove dir
        }
      }
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr.code !== 'ENOENT') {
        logger.error('Survival cleanup error', { error });
      }
    }
    return deleted;
  }

  async deleteTaskDir(taskId: string): Promise<void> {
    try {
      await fs.rm(path.join(UPLOADS_DIR, taskId), { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }
}

export const survivalStorageService = new SurvivalStorageService();
