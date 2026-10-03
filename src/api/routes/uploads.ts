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

const PAYMENT_QR_EXTENSIONS = new Set(['png', 'jpg', 'webp']);

router.get('/uploads/payment-qr/:workerId/:filename', (req: Request, res: Response): void => {
  try {
    const workerId = req.params.workerId as string;
    const filename = req.params.filename as string;

    // Same traversal guards as the insights route, plus the filename must be
    // exactly this worker's current file (<workerId>.<ext>) — files are
    // stored flat under uploads/payment-qr/, one per worker.
    if (
      !workerId ||
      !filename ||
      filename.includes('..') ||
      workerId.includes('..') ||
      filename.includes('/') ||
      workerId.includes('/')
    ) {
      res.status(400).json({ success: false, message: 'Invalid path.' });
      return;
    }
    const dot = filename.lastIndexOf('.');
    const stem = dot === -1 ? filename : filename.slice(0, dot);
    const ext = dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
    if (stem !== workerId || !PAYMENT_QR_EXTENSIONS.has(ext)) {
      res.status(400).json({ success: false, message: 'Invalid path.' });
      return;
    }

    const filePath = path.join(UPLOADS_DIR, 'payment-qr', filename);

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
