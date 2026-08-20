import { prisma } from "../lib/prisma.js";
import { sendEmail } from "@tenant-ai/shared";

/**
 * Create a maintenance request for a tenant.
 * Looks up the tenant's unit from their active lease.
 */
export async function createMaintenanceRequest(
  propertyId: string,
  tenantId: string,
  data: {
    title: string;
    description: string;
    category?: string;
    imageUrls?: string[];
  },
) {
  // Look up tenant's unit from active lease
  const lease = await prisma.lease.findFirst({
    where: { tenantId, status: "active" },
    include: { unit: true },
  });

  // Validate category
  const validCategories = ["plumbing", "electrical", "appliance", "hvac", "pest", "general", "other"];
  const safeCategory = data.category && validCategories.includes(data.category) ? data.category : "general";

  const request = await prisma.maintenanceRequest.create({
    data: {
      propertyId,
      tenantId,
      unitId: lease?.unitId || null,
      title: data.title,
      description: data.description,
      category: safeCategory,
      imageUrls: data.imageUrls || [],
    },
    include: {
      property: { select: { name: true, userId: true, user: { select: { email: true } } } },
      tenant: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  // Notify landlord
  try {
    const landlordEmail = request.property?.user?.email;
    if (landlordEmail) {
      const tenantName = request.tenant
        ? `${request.tenant.firstName || ""} ${request.tenant.lastName || ""}`.trim() || "Unknown"
        : "Unknown";
      await sendEmail({
        to: landlordEmail,
        subject: `New Maintenance Request - ${request.property.name}`,
        html: `
          <h2>New Maintenance Request</h2>
          <p><strong>Property:</strong> ${request.property.name}</p>
          <p><strong>Tenant:</strong> ${tenantName}</p>
          <p><strong>Title:</strong> ${data.title}</p>
          <p><strong>Category:</strong> ${safeCategory}</p>
          <p><strong>Description:</strong> ${data.description}</p>
          <p>Log in to your dashboard to review and manage this request.</p>
        `,
      });
    }
  } catch {
    // Don't fail request creation if notification fails
  }

  return request;
}

/**
 * Update a maintenance request status and/or notes.
 */
export async function updateMaintenanceStatus(
  id: string,
  updates: {
    status?: string;
    notes?: string;
    priority?: string;
  },
) {
  const data: Record<string, unknown> = {};
  if (updates.status) {
    const validStatuses = ["open", "in_progress", "completed", "closed"];
    if (!validStatuses.includes(updates.status)) {
      throw new Error(`Invalid status: ${updates.status}`);
    }
    data.status = updates.status;
    if (updates.status === "completed" || updates.status === "closed") {
      data.resolvedAt = new Date();
    }
  }
  if (updates.notes !== undefined) data.notes = updates.notes;
  if (updates.priority) {
    const validPriorities = ["low", "medium", "high", "urgent"];
    if (!validPriorities.includes(updates.priority)) {
      throw new Error(`Invalid priority: ${updates.priority}`);
    }
    data.priority = updates.priority;
  }

  const request = await prisma.maintenanceRequest.update({
    where: { id },
    data,
    include: {
      property: { select: { name: true } },
      tenant: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  // Notify tenant of status change
  const tenantEmail = request.tenant?.email;
  if (updates.status && tenantEmail) {
    try {
      await sendEmail({
        to: tenantEmail,
        subject: `Maintenance Update - ${request.title}`,
        html: `
          <h2>Maintenance Request Update</h2>
          <p>Your maintenance request "<strong>${request.title}</strong>" at ${request.property?.name || "your property"} has been updated.</p>
          <p><strong>New Status:</strong> ${updates.status.replace("_", " ")}</p>
          ${updates.notes ? `<p><strong>Notes from landlord:</strong> ${updates.notes}</p>` : ""}
          <p>Log in to your tenant portal for more details.</p>
        `,
      });
    } catch {
      // Don't fail update if notification fails
    }
  }

  return request;
}

/**
 * Get maintenance requests for a tenant (open/in_progress).
 */
export async function getMaintenanceRequestsForTenant(tenantId: string) {
  return prisma.maintenanceRequest.findMany({
    where: {
      tenantId,
      status: { in: ["open", "in_progress"] },
    },
    orderBy: { createdAt: "desc" },
  });
}
