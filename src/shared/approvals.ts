import crypto from "node:crypto";
import { bus } from "./events.js";

export interface PendingApproval {
  id: string;
  kind: "deal" | "payment";
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

type Resolver = (approved: boolean) => void;

/**
 * The escalation channel. Tier 1 actions never come through here; the deal
 * itself and any payment above the auto-approval threshold do.
 */
class ApprovalQueue {
  private pending = new Map<string, { approval: PendingApproval; resolve: Resolver }>();

  request(
    kind: PendingApproval["kind"],
    summary: string,
    data: Record<string, unknown> = {},
    timeoutMs = 180_000,
  ): Promise<boolean> {
    const approval: PendingApproval = {
      id: crypto.randomUUID(),
      kind,
      summary,
      data,
      createdAt: new Date().toISOString(),
    };

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(approval.id)) {
          bus.emitEvent("human", "approval_timeout", `No response to: ${summary}. Treating as declined.`);
          resolve(false);
        }
      }, timeoutMs);

      this.pending.set(approval.id, {
        approval,
        resolve: (approved) => {
          clearTimeout(timer);
          resolve(approved);
        },
      });

      bus.emitEvent("human", "approval_requested", summary, {
        data: { approvalId: approval.id, kind, ...data },
      });
    });
  }

  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    bus.emitEvent(
      "human",
      approved ? "approved" : "declined",
      `${approved ? "Approved" : "Declined"}: ${entry.approval.summary}`,
    );
    entry.resolve(approved);
    return true;
  }

  list(): PendingApproval[] {
    return [...this.pending.values()].map((e) => e.approval);
  }

  reset(): void {
    for (const [id] of this.pending) this.resolve(id, false);
    this.pending.clear();
  }
}

export const approvals = new ApprovalQueue();
