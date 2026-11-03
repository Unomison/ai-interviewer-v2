/**
 * MongoDB connection helper with mandatory graceful degradation.
 *
 * The API must ALWAYS start, even when no database is available:
 *  - MONGODB_URI missing      -> status "not_configured"
 *  - MONGODB_URI unreachable  -> status "unreachable" (connect attempt fails fast)
 *  - connection succeeds      -> status "connected"
 *
 * /api/health reports the status; it never throws for the server.
 */
import mongoose from 'mongoose';

let status = 'not_configured'; // 'not_configured' | 'connected' | 'unreachable'

export function getDbStatus() {
  return status;
}

export async function connectDb(uri, log) {
  if (!uri) {
    status = 'not_configured';
    log.warn('MONGODB_URI not set — running without a database (health will report db:"not_configured")');
    return status;
  }

  try {
    // Fail fast: don't hang the boot sequence on a dead host.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    status = 'connected';
    log.info('MongoDB connected');
  } catch (err) {
    status = 'unreachable';
    log.warn(`MongoDB unreachable (${err.message}) — running without a database`);
  }
  return status;
}

export async function disconnectDb() {
  try {
    await mongoose.disconnect();
  } catch {
    // Best-effort cleanup for tests/shutdown; a failed disconnect is not fatal.
  }
}
