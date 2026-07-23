import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';

const INSIGHT_TTL_MS = 30 * 60 * 60 * 1000;
const UPLOADS_DIR = path.resolve('uploads', 'insights');

class InsightStorageService {
  async save(taskId: string, reminderId: string, attachmentUrl: string, filename: string): Promise<string> {
    const ext = path.extname(filename) || '.png';
    const safeName = `${reminderId}${ext}`;
    const dir = path.join(UPLOADS_DIR, taskId);

    await fs.mkdir(dir, { recursive: true });

    const response = await fetch(attachmentUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const filePath = path.join(dir, safeName);
    await fs.writeFile(filePath, buffer);

    return `/api/v1/uploads/insights/${encodeURIComponent(taskId)}/${safeName}`;
  }

  async cleanup(): Promise<number> {
    let deleted = 0;
    const cutoff = Date.now() - INSIGHT_TTL_MS;

    try {
      const taskDirs = await fs.readdir(UPLOADS_DIR);
      for (const taskId of taskDirs) {
        const taskDir = path.join(UPLOADS_DIR, taskId);
        const files = await fs.readdir(taskDir);
        for (const file of files) {
          const filePath = path.join(taskDir, file);
          try {
            const stat = await fs.stat(filePath);
            if (stat.mtimeMs < cutoff) {
              await fs.unlink(filePath);
              deleted++;
            }
          } catch {
            // Skip files that fail to stat or unlink
          }
        }
        try {
          const remaining = await fs.readdir(taskDir);
          if (remaining.length === 0) {
            await fs.rmdir(taskDir);
          }
        } catch {
          // Skip if unable to read/remove dir
        }
      }
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr.code !== 'ENOENT') {
        logger.error('Insight cleanup error', { error });
      }
    }

    return deleted;
  }

  async deleteTaskDir(taskId: string): Promise<void> {
    const dir = path.join(UPLOADS_DIR, taskId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }
}

export const insightStorageService = new InsightStorageService();
