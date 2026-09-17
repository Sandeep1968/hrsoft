import "server-only";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";

interface NotifyInput {
  /** Target by user id or by employee id (resolved to the linked user). */
  userId?: string;
  employeeId?: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

/** In-app notification (+ optional email). Never throws. */
export async function notify(input: NotifyInput) {
  try {
    let userId = input.userId;
    let email: string | undefined;
    if (!userId && input.employeeId) {
      const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { userId: true, workEmail: true } });
      userId = emp?.userId ?? undefined;
      email = emp?.workEmail;
    }
    if (!userId) return;
    await db.notification.create({ data: { userId, type: input.type, title: input.title, body: input.body, link: input.link } });
    if (input.email) {
      if (!email) email = (await db.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email;
      if (email) await sendMail({ to: email, subject: input.title, text: `${input.body ?? input.title}${input.link ? `\n\n${input.link}` : ""}` });
    }
  } catch (e) {
    console.error("notify failed", e);
  }
}

export async function notifyMany(employeeIds: string[], input: Omit<NotifyInput, "userId" | "employeeId">) {
  await Promise.all(employeeIds.map((employeeId) => notify({ ...input, employeeId })));
}
