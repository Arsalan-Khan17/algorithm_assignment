import { describe, expect, it } from "vitest";
import { conciseDecisionSummary } from "@/src/presentation/decision-summary";

describe("conciseDecisionSummary", () => {
  it("removes a reviewer-facing technical appendix", () => {
    const result = conciseDecisionSummary(
      "A refund is pending human approval. Reviewer summary: orderId abc, amountCents 12999.",
    );

    expect(result).toBe("A refund is pending human approval.");
  });

  it("removes action-list details from older model output", () => {
    const result = conciseDecisionSummary(
      "I submitted a refund request for order 1043.\n\n- Action taken: Requested a full refund.\n- Current state: Pending review.",
    );

    expect(result).toBe("I submitted a refund request for order 1043.");
  });

  it("truncates long unstructured output at a readable boundary", () => {
    const result = conciseDecisionSummary("word ".repeat(100), "Fallback", 80);

    expect(result.length).toBeLessThanOrEqual(81);
    expect(result.endsWith("…")).toBe(true);
  });

  it("uses a fallback for missing output", () => {
    expect(conciseDecisionSummary(null, "Processing")).toBe("Processing");
  });
});
