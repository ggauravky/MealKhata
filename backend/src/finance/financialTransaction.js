import mongoose from 'mongoose';

export function isTransientTransactionError(error) {
  return error.errorLabels?.has?.('TransientTransactionError')
    || error.errorLabelSet?.has?.('TransientTransactionError')
    || error.code === 112
    || (typeof error.message === 'string'
      && (error.message.includes('WriteConflict') || error.message.includes('catalog changes')));
}

export async function runFinancialTransaction(
  work,
  { maxRetries = 5, retryOnDuplicateKey = false } = {},
) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    const error = new Error('Financial transaction unavailable. Database connection required.');
    error.statusCode = 503;
    throw error;
  }

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    let session = null;
    let transactionStarted = false;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      transactionStarted = true;
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session?.inTransaction()) await session.abortTransaction();
      if (!transactionStarted) {
        const unavailable = new Error('Financial transaction unavailable. Database transaction support is required.');
        unavailable.statusCode = 503;
        unavailable.cause = error;
        throw unavailable;
      }
      if (
        (isTransientTransactionError(error) || (retryOnDuplicateKey && error.code === 11000))
        && attempt < maxRetries - 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (
        error.message?.includes('Transactions are not supported')
        || error.message?.includes('replica set')
      ) {
        const unavailable = new Error('Financial transaction unavailable. Database transaction support is required.');
        unavailable.statusCode = 503;
        throw unavailable;
      }
      throw error;
    } finally {
      if (session) await session.endSession();
    }
  }

  const error = new Error('Financial transaction could not be completed safely.');
  error.statusCode = 409;
  throw error;
}
