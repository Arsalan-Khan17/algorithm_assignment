import { notFound } from "next/navigation";
import { z } from "zod";
import { ReviewWorkspace } from "@/components/review-workspace";
import { getReviewDetail, listDemoIdentities } from "@/src/repositories/support-repository";
import { serialize } from "@/src/types/serialized";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [detail, identities] = await Promise.all([getReviewDetail(id), listDemoIdentities()]);
  if (!detail) notFound();
  return <main className="shell"><ReviewWorkspace initialDetail={serialize(detail)} reviewers={serialize(identities.reviewers)} /></main>;
}
