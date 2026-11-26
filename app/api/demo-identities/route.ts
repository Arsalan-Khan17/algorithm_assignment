import { NextResponse } from "next/server";
import { listDemoIdentities } from "@/src/repositories/support-repository";
import { apiError } from "@/src/http/responses";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listDemoIdentities());
  } catch (error: unknown) {
    return apiError(error);
  }
}
