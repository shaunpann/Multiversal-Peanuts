import { verifyDocuments, checkShipmentStatus } from "../tools/agentTools";
import { AgentLogEvent } from "../shared/types";

export class VerificationAgent {
  public async verifyOrder(dealId: string, emitEvent: (e: AgentLogEvent) => void): Promise<boolean> {
    emitEvent({
      type: "agent_action",
      agent: "verification",
      action: "inspecting_documents",
      message: `Verification Agent inspecting Certificate of Conformity for Deal ${dealId}...`,
      timestamp: new Date().toISOString(),
    });

    const result = await verifyDocuments(dealId);

    if (result.passed) {
      emitEvent({
        type: "agent_action",
        agent: "verification",
        action: "inspection_passed",
        message: `Inspection passed! Certificate ID: ${result.certificateId}`,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    return false;
  }
}

export class LogisticsAgent {
  public async confirmDelivery(trackingNumber: string, emitEvent: (e: AgentLogEvent) => void) {
    emitEvent({
      type: "agent_action",
      agent: "logistics",
      action: "check_shipment",
      message: `Logistics Agent pinging carrier API for tracking #${trackingNumber}...`,
      timestamp: new Date().toISOString(),
    });

    const shipment = await checkShipmentStatus(trackingNumber);

    emitEvent({
      type: "agent_action",
      agent: "logistics",
      action: "delivery_confirmed",
      message: `Carrier status: ${shipment.status} via ${shipment.carrier}. Delivery confirmed.`,
      timestamp: new Date().toISOString(),
    });

    return shipment;
  }
}