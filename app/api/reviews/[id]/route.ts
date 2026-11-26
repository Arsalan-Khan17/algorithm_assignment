import { NextResponse } from "next/server";
import { z } from "zod";
import { getReviewDetail } from "@/src/repositories/support-repository";
import { apiError } from "@/src/http/responses";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const detail = await getReviewDetail(id);
    return detail
      ? NextResponse.json(detail)
      : NextResponse.json(
          { error: { code: "REVIEW_NOT_FOUND", message: "Review task was not found." } },
          { status: 404 },
        );
  } catch (error: unknown) {
    return apiError(error);
  }
}
