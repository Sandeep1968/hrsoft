/* eslint-disable no-console */
/**
 * HRsoft seed — creates the organisation, system roles, lookup tables and
 * `SEED_EMPLOYEES` (default 2000) employees with users, salaries, leave
 * balances and a month of attendance so the app is load-testable out of the box.
 *
 *   npm run db:seed              # 2000 employees
 *   SEED_EMPLOYEES=50 npm run db:seed
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { faker } from "@faker-js/faker";
import { hash } from "@node-rs/argon2";
import { createCipheriv, randomBytes } from "node:crypto";
import { SYSTEM_ROLES } from "../src/lib/rbac/permissions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const COUNT = Number(process.env.SEED_EMPLOYEES ?? 2000);
const PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";
faker.seed(42);

function encrypt(plain: string) {
  const key = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? "0".repeat(64), "hex");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const today = new Date();
const TY = today.getUTCFullYear();

async function main() {
  console.time("seed");
  const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 });

  // ── Roles ──────────────────────────────────────────────────────────────
  const roleIds: Record<string, string> = {};
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.upsert({
      where: { key },
      update: { name: def.name, description: def.description, isSystem: true },
      create: { key, name: def.name, description: def.description, isSystem: true },
    });
    roleIds[key] = role.id;
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: def.grants.map(([permission, scope]) => ({ roleId: role.id, permission, scope })) });
  }
  console.log("roles seeded");

  // ── Organisation ───────────────────────────────────────────────────────
  const org = (await db.organization.findFirst()) ?? (await db.organization.create({ data: { name: "Acme Technologies", legalName: "Acme Technologies Pvt Ltd", domain: "acme.example" } }));
  const entity =
    (await db.legalEntity.findFirst({ where: { isDefault: true } })) ??
    (await db.legalEntity.create({ data: { name: "Acme Technologies Pvt Ltd", pan: "AAACA1234A", tan: "HYDA12345B", gstin: "36AAACA1234A1Z5", ptState: "TS", isDefault: true, address: { line1: "Hitec City", city: "Hyderabad", state: "Telangana", pincode: "500081" } } }));

  const locationDefs = [
    { name: "Hyderabad HQ", city: "Hyderabad", state: "Telangana" },
    { name: "Bengaluru", city: "Bengaluru", state: "Karnataka" },
    { name: "Pune", city: "Pune", state: "Maharashtra" },
    { name: "Gurugram", city: "Gurugram", state: "Haryana" },
  ];
  const locations: { id: string; name: string }[] = [];
  for (const l of locationDefs) locations.push((await db.location.findFirst({ where: { name: l.name } })) ?? (await db.location.create({ data: l })));

  const deptDefs = ["Engineering", "Product", "Design", "Sales", "Marketing", "Customer Success", "Finance", "Human Resources", "Operations", "IT", "Legal", "Data"];
  const departments: { id: string; name: string; code: string }[] = [];
  for (const name of deptDefs) {
    const code = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
    departments.push(await db.department.upsert({ where: { code }, update: {}, create: { name, code } }));
  }

  const desigDefs: [string, number][] = [["Associate", 1], ["Analyst", 2], ["Senior Analyst", 3], ["Software Engineer", 3], ["Senior Software Engineer", 4], ["Lead", 5], ["Manager", 6], ["Senior Manager", 7], ["Director", 8], ["Vice President", 9], ["Chief Executive Officer", 10]];
  const designations: Record<string, string> = {};
  for (const [name, level] of desigDefs) designations[name] = (await db.designation.upsert({ where: { name }, update: { level }, create: { name, level } })).id;

  const shift = (await db.shift.findFirst({ where: { isDefault: true } })) ?? (await db.shift.create({ data: { name: "General (9-6)", isDefault: true } }));
  await db.shift.upsert({ where: { id: shift.id }, update: {}, create: { name: "General (9-6)", isDefault: true } });
  if (!(await db.shift.findFirst({ where: { name: "Night (10pm-7am)" } }))) await db.shift.create({ data: { name: "Night (10pm-7am)", startTime: "22:00", endTime: "07:00" } });

  // Holidays (India, current year)
  let calendar = await db.holidayCalendar.findFirst({ where: { year: TY, locationId: null } });
  if (!calendar) {
    calendar = await db.holidayCalendar.create({ data: { name: `India ${TY}`, year: TY } });
    const hol: [number, number, string, boolean][] = [[1, 1, "New Year's Day", false], [1, 14, "Makar Sankranti / Pongal", true], [1, 26, "Republic Day", false], [3, 4, "Holi", false], [3, 31, "Eid ul-Fitr", true], [4, 14, "Dr. Ambedkar Jayanti", true], [5, 1, "May Day", false], [8, 15, "Independence Day", false], [8, 27, "Ganesh Chaturthi", true], [10, 2, "Gandhi Jayanti", false], [10, 20, "Dussehra", false], [11, 8, "Diwali", false], [11, 9, "Diwali (Govardhan Puja)", true], [12, 25, "Christmas", false]];
    await db.holiday.createMany({ data: hol.map(([m, d, name, isOptional]) => ({ calendarId: calendar!.id, date: date(TY, m, d), name, isOptional })) });
  }

  // Leave types
  const leaveDefs = [
    { name: "Casual Leave", code: "CL", annualQuota: 12, accrualPerMonth: 1, carryForwardMax: 0, color: "#2563eb" },
    { name: "Sick Leave", code: "SL", annualQuota: 12, accrualPerMonth: 1, carryForwardMax: 0, color: "#dc2626", requiresDocAfterDays: 2 },
    { name: "Earned Leave", code: "EL", annualQuota: 18, accrualPerMonth: 1.5, carryForwardMax: 30, color: "#16a34a", isEncashable: true, minNoticeDays: 7 },
    { name: "Maternity Leave", code: "ML", annualQuota: 182, accrualPerMonth: 0, carryForwardMax: 0, color: "#db2777", applicableGender: "FEMALE" as const, allowHalfDay: false },
    { name: "Paternity Leave", code: "PL", annualQuota: 10, accrualPerMonth: 0, carryForwardMax: 0, color: "#7c3aed", applicableGender: "MALE" as const, allowHalfDay: false },
    { name: "Loss of Pay", code: "LOP", annualQuota: 0, accrualPerMonth: 0, carryForwardMax: 0, color: "#6b7280", isPaid: false, allowNegative: true },
  ];
  const leaveTypes = [];
  for (const lt of leaveDefs) leaveTypes.push(await db.leaveType.upsert({ where: { code: lt.code }, update: {}, create: lt }));

  // Salary components + default structure
  const compDefs: Prisma.SalaryComponentCreateInput[] = [
    { name: "Basic", code: "BASIC", type: "EARNING", order: 1 },
    { name: "House Rent Allowance", code: "HRA", type: "EARNING", order: 2 },
    { name: "Conveyance Allowance", code: "CONV", type: "EARNING", order: 3 },
    { name: "Special Allowance", code: "SPECIAL", type: "EARNING", order: 4 },
    { name: "Provident Fund (Employee)", code: "PF_EE", type: "DEDUCTION", isStatutory: true, isTaxable: false, isProrated: false, order: 10 },
    { name: "ESI (Employee)", code: "ESI_EE", type: "DEDUCTION", isStatutory: true, isTaxable: false, isProrated: false, order: 11 },
    { name: "Professional Tax", code: "PT", type: "DEDUCTION", isStatutory: true, isTaxable: false, isProrated: false, order: 12 },
    { name: "Income Tax (TDS)", code: "TDS", type: "DEDUCTION", isStatutory: true, isTaxable: false, isProrated: false, order: 13 },
    { name: "Provident Fund (Employer)", code: "PF_ER", type: "EMPLOYER_CONTRIBUTION", isStatutory: true, isTaxable: false, isProrated: false, order: 20 },
    { name: "ESI (Employer)", code: "ESI_ER", type: "EMPLOYER_CONTRIBUTION", isStatutory: true, isTaxable: false, isProrated: false, order: 21 },
  ];
  const comps: Record<string, string> = {};
  for (const c of compDefs) comps[c.code] = (await db.salaryComponent.upsert({ where: { code: c.code }, update: {}, create: c })).id;
  let structure = await db.salaryStructure.findFirst({ where: { isDefault: true } });
  if (!structure) {
    structure = await db.salaryStructure.create({ data: { name: "Standard India CTC", isDefault: true, description: "Basic 40% of CTC, HRA 50% of Basic, Conveyance fixed, Special Allowance balance" } });
    await db.salaryStructureLine.createMany({
      data: [
        { structureId: structure.id, componentId: comps.BASIC, calcType: "PERCENT_OF_CTC", value: 40, order: 1 },
        { structureId: structure.id, componentId: comps.HRA, calcType: "PERCENT_OF_BASIC", value: 50, order: 2 },
        { structureId: structure.id, componentId: comps.CONV, calcType: "FIXED", value: 1600, order: 3 },
        { structureId: structure.id, componentId: comps.SPECIAL, calcType: "BALANCE", value: 0, order: 4 },
      ],
    });
  }

  // Lookups for other modules
  for (const c of [{ name: "Travel", code: "TRAVEL" }, { name: "Meals", code: "MEALS", maxAmountPerClaim: 2000 }, { name: "Accommodation", code: "STAY" }, { name: "Internet & Phone", code: "TELECOM", maxAmountPerClaim: 1500 }, { name: "Office Supplies", code: "SUPPLIES" }, { name: "Training", code: "TRAINING" }]) {
    await db.expenseCategory.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  for (const name of ["Laptop", "Monitor", "Mobile Phone", "Access Card", "Headset", "Furniture"]) await db.assetCategory.upsert({ where: { name }, update: {}, create: { name } });
  for (const c of [{ name: "IT Support", slaHours: 24, assigneeRoleKey: "IT_ADMIN" }, { name: "HR Query", slaHours: 48, assigneeRoleKey: "HR_ADMIN" }, { name: "Payroll Query", slaHours: 72, assigneeRoleKey: "PAYROLL_ADMIN" }, { name: "Facilities", slaHours: 48 }, { name: "Grievance", slaHours: 72, assigneeRoleKey: "HR_ADMIN" }]) {
    await db.ticketCategory.upsert({ where: { name: c.name }, update: {}, create: c });
  }
  let template = await db.onboardingTemplate.findFirst({ where: { isDefault: true } });
  if (!template) {
    template = await db.onboardingTemplate.create({ data: { name: "Standard onboarding", isDefault: true } });
    await db.onboardingTemplateTask.createMany({
      data: [
        { templateId: template.id, title: "Upload ID proof (PAN & Aadhaar)", assigneeType: "EMPLOYEE", dueDaysAfterJoining: 2, order: 1 },
        { templateId: template.id, title: "Add bank account details", assigneeType: "EMPLOYEE", dueDaysAfterJoining: 3, order: 2 },
        { templateId: template.id, title: "Sign employment agreement", assigneeType: "EMPLOYEE", dueDaysAfterJoining: 1, order: 3 },
        { templateId: template.id, title: "Provision laptop and accounts", assigneeType: "IT", dueDaysAfterJoining: 0, order: 4 },
        { templateId: template.id, title: "Welcome call and role briefing", assigneeType: "MANAGER", dueDaysAfterJoining: 1, order: 5 },
        { templateId: template.id, title: "Complete background verification", assigneeType: "HR", dueDaysAfterJoining: 14, order: 6 },
        { templateId: template.id, title: "Set 30-60-90 day goals", assigneeType: "MANAGER", dueDaysAfterJoining: 7, order: 7 },
      ],
    });
  }
  console.log("lookups seeded");

  // ── Employees ──────────────────────────────────────────────────────────
  const existing = await db.employee.count();
  if (existing >= COUNT) {
    console.log(`employees already seeded (${existing}); skipping`);
  } else {
    // Fixed demo accounts first
    const demo: { email: string; name: string; roles: string[]; designation: string; dept: number }[] = [
      { email: "admin@acme.example", name: "Asha Rao", roles: ["SUPER_ADMIN"], designation: "Chief Executive Officer", dept: 8 },
      { email: "hr@acme.example", name: "Priya Menon", roles: ["HR_ADMIN", "EMPLOYEE"], designation: "Director", dept: 7 },
      { email: "payroll@acme.example", name: "Rohit Verma", roles: ["PAYROLL_ADMIN", "EMPLOYEE"], designation: "Senior Manager", dept: 6 },
      { email: "finance@acme.example", name: "Neha Gupta", roles: ["FINANCE", "EMPLOYEE"], designation: "Manager", dept: 6 },
      { email: "recruiter@acme.example", name: "Karan Shah", roles: ["RECRUITER", "EMPLOYEE"], designation: "Senior Analyst", dept: 7 },
      { email: "it@acme.example", name: "Suresh Iyer", roles: ["IT_ADMIN", "EMPLOYEE"], designation: "Lead", dept: 9 },
      { email: "pm@acme.example", name: "Meera Nair", roles: ["PROJECT_MANAGER", "MANAGER", "EMPLOYEE"], designation: "Senior Manager", dept: 0 },
      { email: "manager@acme.example", name: "Vikram Singh", roles: ["MANAGER", "EMPLOYEE"], designation: "Manager", dept: 0 },
      { email: "employee@acme.example", name: "Ananya Das", roles: ["EMPLOYEE"], designation: "Software Engineer", dept: 0 },
    ];

    const created: { id: string; userId: string; departmentId: string; joiningDate: Date; ctc: number; gender: "MALE" | "FEMALE"; level: number }[] = [];
    let seq = existing + 1;

    async function createEmployee(opts: { email: string; first: string; last: string; roles: string[]; designation: string; dept: number; managerId?: string | null; joiningDate?: Date; ctc?: number; gender?: "MALE" | "FEMALE" }) {
      const gender = opts.gender ?? (faker.number.int(1) ? "MALE" : "FEMALE");
      const joiningDate = opts.joiningDate ?? faker.date.between({ from: date(TY - 8, 1, 1), to: date(TY, today.getUTCMonth(), 1) });
      const level = desigDefs.find((d) => d[0] === opts.designation)?.[1] ?? 3;
      const ctc = opts.ctc ?? Math.round((350_000 + level * 250_000 + faker.number.int(400_000)) / 1000) * 1000;
      const code = `ACM${String(seq++).padStart(5, "0")}`;
      const user = await db.user.create({ data: { email: opts.email, name: `${opts.first} ${opts.last}`, passwordHash, status: "ACTIVE", emailVerifiedAt: new Date(), roles: { create: opts.roles.map((r) => ({ roleId: roleIds[r] })) } } });
      const emp = await db.employee.create({
        data: {
          employeeCode: code,
          userId: user.id,
          firstName: opts.first,
          lastName: opts.last,
          displayName: `${opts.first} ${opts.last}`,
          workEmail: opts.email,
          personalEmail: faker.internet.email({ firstName: opts.first, lastName: opts.last }).toLowerCase(),
          phone: `+91${faker.string.numeric({ length: 10, allowLeadingZeros: false })}`,
          dateOfBirth: faker.date.birthdate({ min: 22, max: 58, mode: "age" }),
          gender,
          joiningDate,
          confirmationDate: new Date(joiningDate.getTime() + 182 * 86_400_000),
          employmentType: faker.helpers.weightedArrayElement([{ weight: 88, value: "FULL_TIME" as const }, { weight: 6, value: "CONTRACT" as const }, { weight: 4, value: "INTERN" as const }, { weight: 2, value: "CONSULTANT" as const }]),
          status: "ACTIVE",
          departmentId: departments[opts.dept].id,
          designationId: designations[opts.designation],
          locationId: faker.helpers.arrayElement(locations).id,
          legalEntityId: entity.id,
          managerId: opts.managerId ?? null,
          shiftId: shift.id,
          currentAddress: { line1: faker.location.streetAddress(), city: faker.location.city(), state: "Telangana", pincode: faker.location.zipCode("5#####") },
          emergencyContact: { name: faker.person.fullName(), relation: "Spouse", phone: `+91${faker.string.numeric(10)}` },
          panEnc: encrypt(`${faker.string.alpha({ length: 5, casing: "upper" })}${faker.string.numeric(4)}${faker.string.alpha({ length: 1, casing: "upper" })}`),
          uanEnc: encrypt(faker.string.numeric(12)),
          bankAccount: { create: { accountHolder: `${opts.first} ${opts.last}`, accountNumberEnc: encrypt(faker.string.numeric(14)), accountLast4: faker.string.numeric(4), ifsc: `HDFC0${faker.string.numeric(6)}`, bankName: "HDFC Bank" } },
        },
      });
      created.push({ id: emp.id, userId: user.id, departmentId: departments[opts.dept].id, joiningDate, ctc, gender, level });
      return emp;
    }

    const ceo = await createEmployee({ email: demo[0].email, first: "Asha", last: "Rao", roles: demo[0].roles, designation: demo[0].designation, dept: demo[0].dept, joiningDate: date(TY - 10, 1, 1), ctc: 12_000_000 });
    const leaders: string[] = [];
    for (const d of demo.slice(1)) {
      const [first, ...rest] = d.name.split(" ");
      const e = await createEmployee({ email: d.email, first, last: rest.join(" "), roles: d.roles, designation: d.designation, dept: d.dept, managerId: ceo.id, joiningDate: date(TY - 5, 1, 15) });
      if (d.roles.includes("MANAGER") || d.designation === "Director") leaders.push(e.id);
    }
    // Department heads / VPs → managers → ICs (roughly 1:8 span of control)
    const managers: string[] = [];
    for (let i = 0; i < departments.length; i++) {
      const vp = await createEmployee({ email: `vp.${departments[i].code.toLowerCase()}@acme.example`, first: faker.person.firstName(), last: faker.person.lastName(), roles: ["MANAGER", "EMPLOYEE"], designation: "Vice President", dept: i, managerId: ceo.id });
      await db.department.update({ where: { id: departments[i].id }, data: { headId: vp.id } });
      const mgrCount = Math.max(2, Math.round((COUNT / departments.length) / 9));
      for (let m = 0; m < mgrCount; m++) {
        const mgr = await createEmployee({ email: faker.internet.email({ provider: "acme.example" }).toLowerCase().replace(/[^a-z0-9@._-]/g, "") + `.${seq}`, first: faker.person.firstName(), last: faker.person.lastName(), roles: ["MANAGER", "EMPLOYEE"], designation: faker.helpers.arrayElement(["Manager", "Senior Manager", "Lead"]), dept: i, managerId: vp.id });
        managers.push(mgr.id);
      }
    }
    // Fill remaining headcount with individual contributors in batches
    const icDesignations = ["Associate", "Analyst", "Senior Analyst", "Software Engineer", "Senior Software Engineer"];
    while (created.length < COUNT) {
      const mgrId = faker.helpers.arrayElement(managers);
      const mgr = created.find((c) => c.id === mgrId)!;
      const deptIdx = departments.findIndex((d) => d.id === mgr.departmentId);
      const first = faker.person.firstName();
      const last = faker.person.lastName();
      await createEmployee({ email: `${first}.${last}.${seq}@acme.example`.toLowerCase().replace(/[^a-z0-9@._-]/g, ""), first, last, roles: ["EMPLOYEE"], designation: faker.helpers.arrayElement(icDesignations), dept: deptIdx, managerId: mgrId });
      if (created.length % 250 === 0) console.log(`  employees: ${created.length}/${COUNT}`);
    }
    // Demo manager gets a few named reports so the "My Team" screens are populated.
    const vikram = await db.employee.findUnique({ where: { workEmail: "manager@acme.example" } });
    const ananya = await db.employee.findUnique({ where: { workEmail: "employee@acme.example" } });
    if (vikram && ananya) await db.employee.update({ where: { id: ananya.id }, data: { managerId: vikram.id } });
    if (vikram) {
      const sample = created.filter((c) => c.level <= 4).slice(0, 6);
      await db.employee.updateMany({ where: { id: { in: sample.map((s) => s.id) } }, data: { managerId: vikram.id } });
    }
    console.log(`employees seeded: ${created.length}`);

    // ── Salaries ─────────────────────────────────────────────────────────
    const salaryRows: Prisma.EmployeeSalaryCreateManyInput[] = created.map((c) => {
      const monthlyCtc = c.ctc / 12;
      const basic = Math.round(monthlyCtc * 0.4);
      const hra = Math.round(basic * 0.5);
      const conv = 1600;
      const special = Math.round(monthlyCtc - basic - hra - conv);
      return { employeeId: c.id, structureId: structure!.id, effectiveFrom: c.joiningDate, annualCtc: c.ctc, monthly: { BASIC: basic, HRA: hra, CONV: conv, SPECIAL: special }, pfApplicable: true, esiApplicable: monthlyCtc <= 21000, ptApplicable: true, taxRegime: faker.number.int(3) ? "NEW" : "OLD", isCurrent: true };
    });
    for (let i = 0; i < salaryRows.length; i += 500) await db.employeeSalary.createMany({ data: salaryRows.slice(i, i + 500) });
    console.log("salaries seeded");

    // ── Leave balances (current year) ────────────────────────────────────
    const monthsElapsed = today.getUTCMonth() + 1;
    const balRows: Prisma.LeaveBalanceCreateManyInput[] = [];
    for (const c of created) {
      for (const lt of leaveTypes) {
        if (lt.applicableGender && lt.applicableGender !== c.gender) continue;
        const accrued = Number(lt.accrualPerMonth) > 0 ? Number(lt.accrualPerMonth) * monthsElapsed : Number(lt.annualQuota);
        balRows.push({ employeeId: c.id, leaveTypeId: lt.id, year: TY, opening: 0, accrued, used: Number(lt.accrualPerMonth) > 0 ? faker.number.int({ min: 0, max: Math.floor(accrued / 2) }) : 0 });
      }
    }
    for (let i = 0; i < balRows.length; i += 1000) await db.leaveBalance.createMany({ data: balRows.slice(i, i + 1000) });
    console.log("leave balances seeded");

    // ── Attendance: last 30 days for everyone ────────────────────────────
    const attRows: Prisma.AttendanceRecordCreateManyInput[] = [];
    const start = new Date(Date.UTC(TY, today.getUTCMonth(), today.getUTCDate() - 30));
    for (let d = 0; d < 30; d++) {
      const day = new Date(start.getTime() + d * 86_400_000);
      const dow = day.getUTCDay();
      for (const c of created) {
        if (dow === 0 || dow === 6) {
          attRows.push({ employeeId: c.id, date: day, status: "WEEK_OFF" });
          continue;
        }
        const r = faker.number.int(100);
        if (r < 85) {
          const inMin = 9 * 60 + faker.number.int({ min: -20, max: 45 });
          const firstIn = new Date(day.getTime() + (inMin - 330) * 60_000);
          const work = 8 * 60 + faker.number.int({ min: -60, max: 90 });
          attRows.push({ employeeId: c.id, date: day, firstIn, lastOut: new Date(firstIn.getTime() + (work + 60) * 60_000), workMinutes: work, lateMinutes: Math.max(0, inMin - 9 * 60 - 15), status: work >= 480 ? "PRESENT" : work >= 240 ? "HALF_DAY" : "ABSENT", source: "WEB" });
        } else if (r < 92) attRows.push({ employeeId: c.id, date: day, status: "WFH", workMinutes: 480, source: "WEB" });
        else if (r < 97) attRows.push({ employeeId: c.id, date: day, status: "ON_LEAVE" });
        else attRows.push({ employeeId: c.id, date: day, status: "ABSENT" });
      }
    }
    for (let i = 0; i < attRows.length; i += 2000) await db.attendanceRecord.createMany({ data: attRows.slice(i, i + 2000), skipDuplicates: true });
    console.log(`attendance seeded: ${attRows.length} rows`);
  }

  console.log("\nDemo logins (password: %s):", PASSWORD);
  for (const e of ["admin", "hr", "payroll", "finance", "recruiter", "it", "pm", "manager", "employee"]) console.log(`  ${e}@acme.example`);
  console.timeEnd("seed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
