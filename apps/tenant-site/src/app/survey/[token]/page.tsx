import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * /survey/[token] — entry point for a texted survey link. Validates the invite
 * and forwards to the rental application form (carrying the token so the
 * submission is attributed to the invite). Shows a friendly notice if the link
 * is expired, already used, or unknown.
 */
export default async function SurveyEntryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invite = await prisma.surveyInvite
    .findUnique({
      where: { token },
      include: { property: { select: { id: true, isActive: true } } },
    })
    .catch(() => null);

  const now = new Date();
  const valid =
    !!invite && !!invite.property?.isActive && !invite.usedAt && invite.expiresAt > now;

  if (valid) {
    redirect(`/apply/${invite!.propertyId}?invite=${encodeURIComponent(token)}`);
  }

  let title = "Link not found";
  let message =
    "This application link isn't valid. Please text us again to get a fresh link.";
  if (invite?.usedAt) {
    title = "Already submitted";
    message =
      "You've already completed an application with this link. If you need to make a change, please contact us.";
  } else if (invite && invite.expiresAt <= now) {
    title = "Link expired";
    message =
      "This application link has expired. Please text us again and we'll send you a new one.";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-3 text-sm text-gray-600">{message}</p>
      </div>
    </main>
  );
}
