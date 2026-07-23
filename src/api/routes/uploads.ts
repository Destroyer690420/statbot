import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/logger';

const router = Router();

const UPLOADS_DIR = path.resolve('uploads');

router.get('/uploads/insights/:taskId/:filename', (req: Request, res: Response): void => {
  try {
    const taskId = req.params.taskId as string;
    const filename = req.params.filename as string;

    if (filename.includes('..') || taskId.includes('..') || filename.includes('/') || taskId.includes('/')) {
      res.status(400).json({ success: false, message: 'Invalid path.' });
      return;
    }

    const filePath = path.join(UPLOADS_DIR, 'insights', taskId, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, message: 'Image not found.' });
      return;
    }

    res.sendFile(filePath);
  } catch (error) {
    logger.error('Failed to serve upload', { error });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
