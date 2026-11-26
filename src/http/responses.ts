import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ReviewConflict } from "@/src/domain/reviews/review-service";

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Request validation failed.", issues: error.issues } },
      { status: 400 },
    );
  }

  if (error instanceof ReviewConflict) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message }, current: error.current },
      { status: error.code === "REVIEW_NOT_FOUND" ? 404 : 409 },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } },
    { status: 500 },
  );
}
