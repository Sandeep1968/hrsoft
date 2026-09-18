"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { OrgNode } from "@/server/services/employees";

interface TreeNode extends OrgNode {
  children: TreeNode[];
}

function buildTree(nodes: OrgNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  for (const n of map.values()) {
    const parent = n.managerId ? map.get(n.managerId) : undefined;
    if (parent && parent.id !== n.id) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

export function OrgTree({ nodes }: { nodes: OrgNode[] }) {
  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(nodes.filter((n) => n.depth >= 2).map((n) => n.id)));
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Button variant="ghost" size="xs" onClick={() => setCollapsed(new Set())}>Expand all</Button>
      <Button variant="ghost" size="xs" onClick={() => setCollapsed(new Set(nodes.filter((n) => n.reportCount > 0).map((n) => n.id)))}>Collapse all</Button>
      <span className="ml-auto">{nodes.length} people shown</span>
      <ul className="basis-full space-y-1">{roots.map((r) => <Node key={r.id} node={r} collapsed={collapsed} toggle={toggle} />)}</ul>
    </div>
  );
}

function Node({ node, collapsed, toggle }: { node: TreeNode; collapsed: Set<string>; toggle: (id: string) => void }) {
  const hasChildren = node.children.length > 0;
  const truncated = node.reportCount > 0 && !hasChildren; // beyond depth limit
  const open = !collapsed.has(node.id);
  return (
    <li>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
        {hasChildren ? (
          <button type="button" aria-label={open ? "Collapse" : "Expand"} className="rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => toggle(node.id)}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="size-5" />
        )}
        <Avatar className="size-7">{node.photoUrl && <AvatarImage src={node.photoUrl} alt="" />}<AvatarFallback className="text-[10px]">{node.displayName.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <Link href={`/employees/${node.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">{node.displayName}</Link>
          <div className="truncate text-xs text-muted-foreground">{[node.designation, node.department].filter(Boolean).join(" · ") || node.employeeCode}</div>
        </div>
        {node.reportCount > 0 && (
          <Link href={`/org-chart?root=${node.id}`} className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground" title="Focus on this team">
            <Users className="size-3" /> {node.reportCount}{truncated ? " ›" : ""}
          </Link>
        )}
      </div>
      {hasChildren && open && <ul className="ml-4 border-l pl-2">{node.children.map((c) => <Node key={c.id} node={c} collapsed={collapsed} toggle={toggle} />)}</ul>}
    </li>
  );
}
