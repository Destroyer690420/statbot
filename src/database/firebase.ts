import admin from 'firebase-admin';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let db: admin.firestore.Firestore;

/**
 * Initialize Firebase Admin SDK and return Firestore instance.
 */
export function initializeFirebase(): admin.firestore.Firestore {
  if (db) return db;

  try {
    const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });

    db = admin.firestore();

    // Enable Firestore settings
    db.settings({
      ignoreUndefinedProperties: true,
    });

    logger.info('Firebase initialized successfully', {
      projectId: env.FIREBASE_PROJECT_ID,
    });

    return db;
  } catch (error) {
    logger.error('Failed to initialize Firebase', { error });
    process.exit(1);
  }
}

/**
 * Get the Firestore database instance.
 */
export function getDb(): admin.firestore.Firestore {
  if (!db) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return db;
}

// ─── Collection References ───────────────────────────────────

export function tasksCollection() {
  return getDb().collection('tasks');
}

export function remindersCollection() {
  return getDb().collection('reminders');
}

export function auditLogsCollection() {
  return getDb().collection('auditLogs');
}

// ─── Helper: Convert Firestore Timestamp to Date ─────────────

export function toDate(timestamp: admin.firestore.Timestamp | Date | null): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  return timestamp.toDate();
}

/**
 * Convert a Date to Firestore Timestamp.
 */
export function toTimestamp(date: Date): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromDate(date);
}

/**
 * Check if Firebase connection is healthy.
 */
export async function checkFirebaseHealth(): Promise<boolean> {
  try {
    await getDb().collection('_health').doc('ping').set({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}
