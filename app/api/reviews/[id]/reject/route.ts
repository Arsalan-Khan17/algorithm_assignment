import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rejectReview } from "@/src/domain/reviews/review-service";
import { getReviewDetail } from "@/src/repositories/support-repository";
import { apiError } from "@/src/http/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    await rejectReview(id, await request.json());
    return NextResponse.json(await getReviewDetail(id));
  } catch (error: unknown) {
    return apiError(error);
  }
}
