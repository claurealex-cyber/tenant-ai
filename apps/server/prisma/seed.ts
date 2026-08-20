import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function main() {
  console.log("Seeding database...");

  // ── Pricing Tiers ──
  const starterTier = await prisma.pricingTier.upsert({
    where: { name: "starter" },
    update: {},
    create: {
      name: "starter",
      displayName: "Starter",
      basePriceCents: 2000,
      includedAiCents: 1000,
      aiMarkupPercent: 50,
      maxProperties: 3,
      maxPhoneNumbers: 3,
      websiteEnabled: true,
      customDomainEnabled: false,
      description: "For small landlords getting started",
      sortOrder: 1,
    },
  });

  await prisma.pricingTier.upsert({
    where: { name: "growth" },
    update: {},
    create: {
      name: "growth",
      displayName: "Growth",
      basePriceCents: 5000,
      includedAiCents: 3000,
      aiMarkupPercent: 40,
      maxProperties: 10,
      maxPhoneNumbers: 10,
      websiteEnabled: true,
      customDomainEnabled: true,
      description: "For growing property managers",
      sortOrder: 2,
    },
  });

  await prisma.pricingTier.upsert({
    where: { name: "scale" },
    update: {},
    create: {
      name: "scale",
      displayName: "Scale",
      basePriceCents: 10000,
      includedAiCents: 7500,
      aiMarkupPercent: 30,
      maxProperties: null,
      maxPhoneNumbers: null,
      websiteEnabled: true,
      customDomainEnabled: true,
      description: "Unlimited everything for large operations",
      sortOrder: 3,
    },
  });

  // ── Admin User ──
  const adminHash = await hashPassword("admin123");
  const admin = await prisma.user.upsert({
    where: { email: "admin@tenantai.com" },
    update: { passwordHash: adminHash },
    create: {
      email: "admin@tenantai.com",
      name: "Platform Admin",
      passwordHash: await hashPassword("admin123"),
      role: "admin",
      onboarded: true,
    },
  });

  // ── Client User (landlord) ──
  const clientHash = await hashPassword("demo123");
  const client = await prisma.user.upsert({
    where: { email: "landlord@example.com" },
    update: { passwordHash: clientHash },
    create: {
      email: "landlord@example.com",
      name: "Demo Landlord",
      passwordHash: await hashPassword("demo123"),
      role: "client",
      companyName: "Acme Properties",
      phone: "+13125551234",
      onboarded: true,
    },
  });

  // ── Client Subscription ──
  await prisma.subscription.upsert({
    where: { userId: client.id },
    update: {},
    create: {
      userId: client.id,
      tierId: starterTier.id,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // ── Property 1 ──
  const property1 = await prisma.property.upsert({
    where: { twilioPhone: "+13125550001" },
    update: {},
    create: {
      name: "Sunset Apartments",
      address: "123 Main St, Chicago, IL 60601",
      unitCount: 12,
      twilioPhone: "+13125550001",
      twilioPhoneSid: "PN_DEMO_001",
      description:
        "Beautiful 12-unit apartment building in downtown Chicago. Recently renovated with modern amenities.",
      isActive: true,
      userId: client.id,
      cookCounty: true,
      amenities: ["Laundry", "Parking", "Pet-Friendly", "Dishwasher"],
    },
  });

  // ── Property 2 ──
  const property2 = await prisma.property.upsert({
    where: { twilioPhone: "+13125550002" },
    update: {},
    create: {
      name: "Oak Street Townhomes",
      address: "456 Oak St, Naperville, IL 60540",
      unitCount: 4,
      twilioPhone: "+13125550002",
      twilioPhoneSid: "PN_DEMO_002",
      description:
        "Charming townhomes in quiet Naperville neighborhood. Great schools nearby.",
      isActive: true,
      userId: client.id,
      cookCounty: false,
      amenities: ["Garage", "Backyard", "Pet-Friendly"],
    },
  });

  // ── Standard Questions for Property 1 ──
  const standardQuestions = [
    { fieldKey: "fullName", text: "What is your full name?", type: "text", sortOrder: 1 },
    { fieldKey: "dateOfBirth", text: "What is your date of birth?", type: "date", sortOrder: 2 },
    { fieldKey: "ssn", text: "What is your Social Security Number?", type: "text", sortOrder: 3 },
    { fieldKey: "email", text: "What is your email address?", type: "text", sortOrder: 4 },
    { fieldKey: "monthlyIncome", text: "What is your monthly income?", type: "number", sortOrder: 5 },
  ];

  for (const prop of [property1, property2]) {
    for (const q of standardQuestions) {
      await prisma.question.upsert({
        where: {
          id: `seed-${prop.id}-${q.fieldKey}`,
        },
        update: {},
        create: {
          id: `seed-${prop.id}-${q.fieldKey}`,
          propertyId: prop.id,
          text: q.text,
          fieldKey: q.fieldKey,
          type: q.type,
          required: true,
          sortOrder: q.sortOrder,
          isStandard: true,
        },
      });
    }
  }

  // ── Sample Applications ──
  await prisma.application.upsert({
    where: { id: "seed-app-1" },
    update: {},
    create: {
      id: "seed-app-1",
      propertyId: property1.id,
      status: "completed",
      channel: "voice",
      callerPhone: "+13125559001",
      fullName: "John Smith",
      email: "john.smith@email.com",
      monthlyIncome: "5000",
      employer: "Acme Corp",
      completedAt: new Date(),
    },
  });

  await prisma.application.upsert({
    where: { id: "seed-app-2" },
    update: {},
    create: {
      id: "seed-app-2",
      propertyId: property1.id,
      status: "in_progress",
      channel: "sms",
      callerPhone: "+13125559002",
      fullName: "Jane Doe",
    },
  });

  await prisma.application.upsert({
    where: { id: "seed-app-3" },
    update: {},
    create: {
      id: "seed-app-3",
      propertyId: property2.id,
      status: "completed",
      channel: "web",
      fullName: "Bob Wilson",
      email: "bob.wilson@email.com",
      monthlyIncome: "4500",
      employer: "Tech Startup Inc",
      completedAt: new Date(),
    },
  });

  // ── Units for Property 1 ──
  const unit1 = await prisma.unit.upsert({
    where: { propertyId_unitNumber: { propertyId: property1.id, unitNumber: "101" } },
    update: {},
    create: {
      propertyId: property1.id,
      unitNumber: "101",
      bedrooms: 2,
      bathrooms: 1,
      sqft: 850,
      monthlyRent: 150000,
      status: "occupied",
    },
  });

  await prisma.unit.upsert({
    where: { propertyId_unitNumber: { propertyId: property1.id, unitNumber: "102" } },
    update: {},
    create: {
      propertyId: property1.id,
      unitNumber: "102",
      bedrooms: 1,
      bathrooms: 1,
      sqft: 650,
      monthlyRent: 120000,
      status: "vacant",
    },
  });

  await prisma.unit.upsert({
    where: { propertyId_unitNumber: { propertyId: property1.id, unitNumber: "201" } },
    update: {},
    create: {
      propertyId: property1.id,
      unitNumber: "201",
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1100,
      monthlyRent: 180000,
      status: "vacant",
    },
  });

  await prisma.unit.upsert({
    where: { propertyId_unitNumber: { propertyId: property1.id, unitNumber: "202" } },
    update: {},
    create: {
      propertyId: property1.id,
      unitNumber: "202",
      bedrooms: 2,
      bathrooms: 1,
      sqft: 850,
      monthlyRent: 150000,
      status: "vacant",
    },
  });

  // ── Units for Property 2 ──
  await prisma.unit.upsert({
    where: { propertyId_unitNumber: { propertyId: property2.id, unitNumber: "A" } },
    update: {},
    create: {
      propertyId: property2.id,
      unitNumber: "A",
      bedrooms: 3,
      bathrooms: 2.5,
      sqft: 1400,
      monthlyRent: 200000,
      status: "vacant",
    },
  });

  await prisma.unit.upsert({
    where: { propertyId_unitNumber: { propertyId: property2.id, unitNumber: "B" } },
    update: {},
    create: {
      propertyId: property2.id,
      unitNumber: "B",
      bedrooms: 3,
      bathrooms: 2.5,
      sqft: 1400,
      monthlyRent: 200000,
      status: "vacant",
    },
  });

  // ── Demo Tenant ──
  const tenant = await prisma.tenant.upsert({
    where: { email_userId: { email: "john.smith@email.com", userId: client.id } },
    update: {},
    create: {
      email: "john.smith@email.com",
      passwordHash: await hashPassword("tenant123"),
      firstName: "John",
      lastName: "Smith",
      phone: "+13125559001",
      userId: client.id,
    },
  });

  // ── Demo Lease ──
  await prisma.lease.upsert({
    where: { id: "seed-lease-1" },
    update: {},
    create: {
      id: "seed-lease-1",
      unitId: unit1.id,
      tenantId: tenant.id,
      monthlyRent: 150000,
      securityDeposit: 150000,
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2026, 0, 1),
      leaseType: "fixed",
      status: "active",
      rentDueDay: 1,
      depositReceivedDate: new Date(2025, 0, 1),
      depositReceiptSent: true,
      depositHoldingBank: "First National Bank",
      depositHoldingAddress: "200 Bank St, Chicago IL 60601",
    },
  });

  // ── Website Config ──
  await prisma.websiteConfig.upsert({
    where: { userId: client.id },
    update: {},
    create: {
      userId: client.id,
      subdomain: "acme",
      companyName: "Acme Properties",
      primaryColor: "#2563eb",
      aboutText: "Premium rental properties in the Chicagoland area. We pride ourselves on well-maintained homes and responsive management.",
      contactEmail: "landlord@example.com",
      contactPhone: "+13125551234",
    },
  });

  console.log("Seed complete:");
  console.log(`  - 3 pricing tiers`);
  console.log(`  - 1 admin user (admin@tenantai.com / admin123)`);
  console.log(`  - 1 client user (landlord@example.com / demo123)`);
  console.log(`  - 1 demo tenant (john.smith@email.com / tenant123)`);
  console.log(`  - 2 properties with 5 questions each, 6 units total`);
  console.log(`  - 3 sample applications, 1 lease`);
  console.log(`  - 1 website config (acme.tenantai.com)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
