import { getDb } from '../db';

export class WorkerPaymentInfoRepository {
  async get(workerId: string) {
    return getDb().workerPaymentInfo.findUnique({ where: { workerId } });
  }

  async list() {
    return getDb().workerPaymentInfo.findMany();
  }

  async upsert(workerId: string, data: { filename: string; mimeType: string; upiId?: string | null }) {
    const now = new Date();
    const upiId = data.upiId ?? null;
    return getDb().workerPaymentInfo.upsert({
      where: { workerId },
      create: { workerId, filename: data.filename, mimeType: data.mimeType, upiId, updatedAt: now },
      update: { filename: data.filename, mimeType: data.mimeType, upiId, updatedAt: now },
    });
  }
}

export const workerPaymentInfoRepository = new WorkerPaymentInfoRepository();
