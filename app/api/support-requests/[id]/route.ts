import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupportRequestDetail } from "@/src/repositories/support-repository";
import { apiError } from "@/src/http/responses";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const detail = await getSupportRequestDetail(id);
    return detail
      ? NextResponse.json(detail)
      : NextResponse.json(
          { error: { code: "REQUEST_NOT_FOUND", message: "Support request was not found." } },
          { status: 404 },
        );
  } catch (error: unknown) {
    return apiError(error);
  }
}
