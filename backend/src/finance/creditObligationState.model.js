import mongoose from 'mongoose';

const creditObligationStateSchema = new mongoose.Schema(
  {
    obligationKey: { type: String, required: true, unique: true, trim: true },
    revision: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'credit_obligation_states', timestamps: true, strict: 'throw' },
);

export const CreditObligationState = mongoose.models.CreditObligationState
  || mongoose.model('CreditObligationState', creditObligationStateSchema);
