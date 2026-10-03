import { getDb } from '../db';

export class WorkerPaymentInfoRepository {
  async get(workerId: string) {
    return getDb().workerPaymentInfo.findUnique({ where: { workerId } });
  }

  async upsert(workerId: string, data: { filename: string; mimeType: string }) {
    const now = new Date();
    return getDb().workerPaymentInfo.upsert({
      where: { workerId },
      create: { workerId, filename: data.filename, mimeType: data.mimeType, updatedAt: now },
      update: { filename: data.filename, mimeType: data.mimeType, updatedAt: now },
    });
  }
}

export const workerPaymentInfoRepository = new WorkerPaymentInfoRepository();
