import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db/client";
import { customers, supportRequests } from "@/src/db/schema";
import { processSupportRequest } from "@/src/agent/run-agent";
import { listSupportRequests, getSupportRequestDetail } from "@/src/repositories/support-repository";
import { apiError } from "@/src/http/responses";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 240;

const createRequestSchema = z.object({
  customerId: z.string().uuid(),
  message: z.string().trim().min(3).max(2_000),
});

export async function GET() {
  try {
    return NextResponse.json({ requests: await listSupportRequests() });
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = createRequestSchema.parse(await request.json());
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.customerId));
    if (!customer) {
      return NextResponse.json(
        { error: { code: "CUSTOMER_NOT_FOUND", message: "Demo customer was not found." } },
        { status: 404 },
      );
    }

    const [created] = await db
      .insert(supportRequests)
      .values({ customerId: input.customerId, message: input.message })
      .returning();

    let agentError: string | undefined;
    try {
      await processSupportRequest(created.id);
    } catch (error: unknown) {
      agentError = error instanceof Error ? error.message : "Agent execution failed.";
    }

    const detail = await getSupportRequestDetail(created.id);
    return NextResponse.json(
      { request: detail, ...(agentError ? { agentError } : {}) },
      { status: agentError ? 202 : 201 },
    );
  } catch (error: unknown) {
    return apiError(error);
  }
}
