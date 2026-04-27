const FACTS_BY_INTENT = {
  housekeeping: [
    { id: "sop-housekeeping-1", text: "Housekeeping requests are acknowledged immediately and dispatched to room operations." }
  ],
  maintenance: [
    { id: "sop-maintenance-1", text: "Maintenance issues should be dispatched with ETA updates when available." }
  ],
  amenity_hours: [
    { id: "faq-amenities-1", text: "Provide official amenity hours from approved property documentation only." }
  ],
  late_checkout: [
    { id: "policy-checkout-1", text: "Late checkout availability depends on occupancy and may include approved fee policy." }
  ],
  parking_fees: [
    { id: "policy-parking-1", text: "Parking and service fees must match current published policy for the property." }
  ],
  billing_documents: [
    { id: "policy-billing-docs-1", text: "Receipt, folio, and invoice requests can be acknowledged and fulfilled once the stay details are verified." }
  ],
  billing_dispute: [
    { id: "policy-billing-1", text: "Billing disputes require human review before final commitment to adjustment." }
  ],
  complaint: [
    { id: "sop-escalation-1", text: "Service complaints should acknowledge concern and escalate to duty manager when needed." }
  ],
  general_request: [
    { id: "sop-general-1", text: "Acknowledge request, confirm next step, and provide ETA if known." }
  ]
};

export function retrieveFacts({ intent }) {
  return FACTS_BY_INTENT[intent] || FACTS_BY_INTENT.general_request;
}
