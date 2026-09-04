import type { Deal } from "../shared/types.js";
import { bus } from "../shared/events.js";
import { callPaidService } from "../x402/client.js";

const BASE_URL = () => `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export interface Evidence {
  type: string;
  [key: string]: unknown;
}

interface InspectionReport {
  verdict: "pass" | "fail";
  defectsFound: number;
  reportId: string;
}

/**
 * The oracle. It decides whether a milestone's evidence is good enough, and by
 * doing so it decides whether the preimage is revealed. The ledger cannot check
 * a photo or a carrier webhook, so this is the trusted component - the escrow
 * guarantees only that funds move nowhere else, and CancelAfter guarantees the
 * buyer is refunded if this agent never releases.
 */
export async function evaluateMilestone(
  deal: Deal,
  milestoneId: string,
  evidence: Evidence,
): Promise<{ passed: boolean; reason: string }> {
  const milestone = deal.milestones.find((m) => m.id === milestoneId);
  if (!milestone) return { passed: false, reason: `unknown milestone '${milestoneId}'` };

  bus.emitEvent(
    "verification_agent",
    "evaluating",
    `Checking '${milestone.label}' against the agreed evidence: ${milestone.evidence}`,
    { data: { milestoneId, evidence } },
  );

  let passed = false;
  let reason = "";

  if (milestoneId === "inspection") {
    const result = await callPaidService<InspectionReport>(
      "inspection",
      `/api/inspection/${deal.supplierId}`,
      "Decides whether the inspection milestone releases",
    );
    if (!result.ok || !result.data) {
      return { passed: false, reason: `inspection could not be booked: ${result.reason}` };
    }
    passed = result.data.verdict === "pass";
    reason = passed
      ? `Inspection ${result.data.reportId} passed with ${result.data.defectsFound} defects.`
      : `Inspection ${result.data.reportId} failed.`;
  } else if (milestoneId === "delivery") {
    passed = evidence.status === "delivered";
    reason = passed
      ? `Carrier reported delivery (${String(evidence.trackingRef ?? "no ref")}).`
      : `Carrier status is '${String(evidence.status)}', not 'delivered'.`;
  } else {
    const photos = Number(evidence.photos ?? 0);
    passed = photos >= 3;
    reason = passed
      ? `${photos} timestamped workshop photos received.`
      : `Only ${photos} photos received, 3 required.`;
  }

  bus.emitEvent(
    "verification_agent",
    passed ? "milestone_passed" : "milestone_failed",
    `${milestone.label}: ${reason}`,
    { data: { milestoneId, passed } },
  );

  if (!passed) return { passed, reason };

  const response = await fetch(`${BASE_URL()}/settlement/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId: deal.dealId, milestoneId, reason }),
  });
  if (!response.ok) {
    return { passed: false, reason: `settlement/release failed: ${await response.text()}` };
  }
  return { passed, reason };
}
