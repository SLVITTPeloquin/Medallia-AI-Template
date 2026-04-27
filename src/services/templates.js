const TEMPLATE_BY_INTENT = {
  housekeeping:
    "Hi {{guestName}}, absolutely, we can help with {{requestSummary}}. I sent this to housekeeping now. ETA is about {{eta}}. {{signature}}",
  maintenance:
    "Hi {{guestName}}, thanks for reporting this. I created a maintenance request for {{requestSummary}} and the team is on it. Current ETA is {{eta}}. {{signature}}",
  amenity_hours:
    "Hi {{guestName}}, happy to help. Here are the details: {{policyFact}}. {{signature}}",
  late_checkout:
    "Hi {{guestName}}, thanks for your request. Our late checkout policy is: {{policyFact}}. I can check availability and confirm what we can offer. {{signature}}",
  parking_fees:
    "Hi {{guestName}}, great question. Here is the current policy: {{policyFact}}. I can review your reservation details and confirm how this applies to your stay. {{signature}}",
  billing_documents:
    "Hi {{guestName}}, thank you for your request. I am reviewing the stay details now and will send the requested document shortly. {{signature}}",
  billing_dispute:
    "Hi {{guestName}}, thank you for flagging this. I am routing your billing concern for review now. We will follow up as soon as we have confirmation. {{signature}}",
  complaint:
    "Hi {{guestName}}, I am sorry this has been your experience. I am escalating this now so the right team member can assist directly. {{signature}}",
  general_request:
    "Hi {{guestName}}, thanks for messaging us. I understand you need {{requestSummary}}. I am checking this now and will follow up shortly with an update. {{signature}}"
};

export function getTemplate(intent) {
  return TEMPLATE_BY_INTENT[intent] || TEMPLATE_BY_INTENT.general_request;
}
