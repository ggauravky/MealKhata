import mongoose from 'mongoose';

const paymentReferenceClaimSchema = new mongoose.Schema(
  {
    normalizedReference: { type: String, required: true, unique: true, trim: true },
    originalReference: { type: String, required: true, trim: true },
    ledger: {
      type: String,
      required: true,
      enum: ['HOSTEL_DEPOSIT', 'ROOM_PAYMENT', 'MESS_PAYMENT', 'EXPENSE_REIMBURSEMENT'],
    },
    documentId: { type: String, required: true, trim: true },
    memberId: { type: String, default: null, trim: true },
  },
  { collection: 'payment_reference_claims', timestamps: true, strict: 'throw' },
);

paymentReferenceClaimSchema.index({ ledger: 1, documentId: 1 }, { unique: true });

export const PaymentReferenceClaim =
  mongoose.models.PaymentReferenceClaim
  || mongoose.model('PaymentReferenceClaim', paymentReferenceClaimSchema);
