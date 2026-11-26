import { z } from "zod";

export const refundProposalSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export const cancellationProposalSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const reviewDecisionSchema = z.object({
  reviewerId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().max(1_000).optional(),
});

export type RefundProposal = z.infer<typeof refundProposalSchema>;
export type CancellationProposal = z.infer<typeof cancellationProposalSchema>;
