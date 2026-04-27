# Template Library v1 (Medallia Zingle)

Use these as skeletons. The AI should personalize wording using thread context, guest tone, and known property facts.

## Variables

- `{{guest_name}}`
- `{{request_summary}}`
- `{{service_eta}}`
- `{{policy_fact}}`
- `{{next_step}}`
- `{{agent_signature}}`

## 1. First Response Acknowledgement

Intent: generic service request  
Template:

Hello {{guest_name}}, thanks for messaging us. I understand you need {{request_summary}}. I’m checking this now and will follow up shortly with an update. {{agent_signature}}

## 2. Housekeeping Request

Intent: towels, linens, room refresh  
Template:

Hi {{guest_name}}, absolutely, we can help with {{request_summary}}. I’ve sent this to our housekeeping team now. Expected timing is about {{service_eta}}. I’ll update you if anything changes. {{agent_signature}}

## 3. Maintenance Dispatch

Intent: in-room issue, non-safety maintenance  
Template:

Hi {{guest_name}}, thanks for reporting this. I’ve created a maintenance request for {{request_summary}} and the team is on it. Current ETA is {{service_eta}}. Please let us know if the issue gets worse. {{agent_signature}}

## 4. Amenity/Hours Question

Intent: pool, gym, restaurant, shuttle, etc.  
Template:

Hi {{guest_name}}, happy to help. Here are the details for your question: {{policy_fact}}. If you want, I can also help with directions or reservations. {{agent_signature}}

## 5. Late Checkout (Policy-Bound)

Intent: late checkout request  
Template:

Hi {{guest_name}}, thanks for your request. Our current late checkout policy is: {{policy_fact}}. I can check availability for your stay and confirm what we can offer. {{next_step}} {{agent_signature}}

## 6. Parking/Fee Question (Policy-Bound)

Intent: parking, resort fee, service fee  
Template:

Hi {{guest_name}}, great question. Here is the current policy: {{policy_fact}}. If you want, I can review your reservation details and confirm how this applies to your stay. {{agent_signature}}

## 7. Escalation to Manager

Intent: complaint or sensitive dissatisfaction  
Template:

Hi {{guest_name}}, I’m sorry this has been your experience. I’m escalating this now so the right team member can assist directly. {{next_step}} Thank you for your patience while we address this. {{agent_signature}}

## 8. Billing Review Request

Intent: charge dispute or billing clarification  
Template:

Hi {{guest_name}}, thank you for flagging this. I’m routing your billing concern for review now. {{next_step}} We’ll follow up as soon as we have confirmation. {{agent_signature}}

## 9. Resolution Confirmation

Intent: close the loop after completion  
Template:

Hi {{guest_name}}, just checking in to confirm that {{request_summary}} has been completed. Please let me know if everything looks good or if you still need anything else. {{agent_signature}}

## 10. Safety/Urgent Escalation

Intent: safety, health, lockout, urgent incident  
Template:

Hi {{guest_name}}, thank you for contacting us. I’m escalating this as urgent right now so immediate assistance can be provided. If this is an emergency, please contact local emergency services immediately. {{next_step}} {{agent_signature}}

## Notes

- Never send these verbatim if context requires empathy or correction.
- Do not mention ETAs unless they are known or policy-approved.
- Do not offer refunds, credits, or exceptions unless policy allows and role permissions permit.
