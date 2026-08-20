/**
 * Audit logging utility — writes to the AuditLog table.
 *
 * Never throws — errors are silently logged to console.
 */

export async function logAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  params: {
    userId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}
