import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/rbac/authorize";
import { ForbiddenError } from "@/lib/errors";
import { actorFor } from "./_test-helpers";
import { addComment, getTicket, listTickets, raiseTicket, updateTicketStatus } from "./helpdesk";

describe("helpdesk service (DB)", () => {
  let employee: Actor;
  let it_: Actor;
  let ticketId: string;
  const startedAt = new Date();

  beforeAll(async () => {
    employee = await actorFor("employee@acme.example");
    it_ = await actorFor("it@acme.example");
  });

  afterAll(async () => {
    if (ticketId) await db.ticket.delete({ where: { id: ticketId } }).catch(() => {});
    await db.notification.deleteMany({ where: { type: { startsWith: "ticket." }, createdAt: { gte: startedAt }, userId: { in: [employee.userId, it_.userId] } } });
  });

  it("auto-assigns an IT Support ticket to the IT_ADMIN-linked employee and sets the SLA due date", async () => {
    const cat = await db.ticketCategory.findUnique({ where: { name: "IT Support" } });
    if (!cat) throw new Error("IT Support category not seeded");
    const t = await raiseTicket(employee, { categoryId: cat.id, subject: "QA: laptop will not boot", description: "Black screen after the update this morning.", priority: "HIGH" });
    ticketId = t.id;
    expect(t.status).toBe("OPEN");
    expect(t.assignee?.id).toBe(it_.employeeId);
    expect(t.dueAt).not.toBeNull();
    const expected = t.dueAt ? new Date(t.dueAt).getTime() - new Date(t.createdAt).getTime() : 0;
    expect(Math.abs(expected - cat.slaHours * 3_600_000)).toBeLessThan(60_000);
    const n = await db.notification.findFirst({ where: { userId: it_.userId, type: "ticket.assigned", link: `/helpdesk/${t.id}` } });
    expect(n).not.toBeNull();
  });

  it("the raiser sees it under 'mine'; the agent sees it under 'assigned to me'", async () => {
    const mine = await listTickets(employee, { mine: true, page: 1, pageSize: 50, order: "desc" });
    expect(mine.items.some((x) => x.id === ticketId)).toBe(true);
    const queue = await listTickets(it_, { assignedToMe: true, page: 1, pageSize: 50, order: "desc" });
    expect(queue.items.some((x) => x.id === ticketId)).toBe(true);
  });

  it("internal comments are hidden from the raiser and the raiser cannot write them", async () => {
    await addComment(it_, ticketId, { body: "Internal: disk looks dead, order a replacement", isInternal: true });
    const c = await addComment(it_, ticketId, { body: "Please bring the laptop to the IT desk.", isInternal: false });
    expect(c.status).toBe("WAITING_ON_EMPLOYEE");

    const asRaiser = await getTicket(employee, ticketId);
    expect(asRaiser.viewerIsAgent).toBe(false);
    expect(asRaiser.comments.some((x) => x.isInternal)).toBe(false);
    expect(asRaiser.comments).toHaveLength(1);

    const asAgent = await getTicket(it_, ticketId);
    expect(asAgent.comments).toHaveLength(2);
    expect(asAgent.comments.filter((x) => x.isInternal)).toHaveLength(1);

    await expect(addComment(employee, ticketId, { body: "sneaky", isInternal: true })).rejects.toBeInstanceOf(ForbiddenError);
    const reply = await addComment(employee, ticketId, { body: "On my way.", isInternal: false });
    expect(reply.status).toBe("IN_PROGRESS");
  });

  it("resolving notifies the raiser; the raiser can close", async () => {
    await expect(updateTicketStatus(employee, ticketId, "RESOLVED")).rejects.toBeInstanceOf(ForbiddenError);
    const r = await updateTicketStatus(it_, ticketId, "RESOLVED");
    expect(r.status).toBe("RESOLVED");
    expect(r.resolvedAt).not.toBeNull();
    const n = await db.notification.findFirst({ where: { userId: employee.userId, type: "ticket.resolved", link: `/helpdesk/${ticketId}` } });
    expect(n).not.toBeNull();
    const closed = await updateTicketStatus(employee, ticketId, "CLOSED");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
  });
});
