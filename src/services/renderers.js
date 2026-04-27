const SMS_SEGMENT_MAX = 320;

function cleanLines(text = "") {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitSmsSegments(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const segments = [];
  let remaining = normalized;

  while (remaining.length > SMS_SEGMENT_MAX) {
    const candidate = remaining.slice(0, SMS_SEGMENT_MAX + 1);
    const breakAt = Math.max(
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf("! "),
      candidate.lastIndexOf("? "),
      candidate.lastIndexOf("; "),
      candidate.lastIndexOf(", ")
    );
    const index = breakAt > 80 ? breakAt + 1 : SMS_SEGMENT_MAX;
    segments.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }

  if (remaining) {
    segments.push(remaining);
  }

  return segments;
}

function buildEmailSubject(envelope, intent) {
  if (envelope.subject) {
    return envelope.subject.toLowerCase().startsWith("re:") ? envelope.subject : `Re: ${envelope.subject}`;
  }

  const labels = {
    housekeeping: "Your housekeeping request",
    maintenance: "Your maintenance request",
    amenity_hours: "Details for your question",
    late_checkout: "Regarding your late checkout request",
    parking_fees: "Regarding your parking question",
    billing_documents: "Regarding your requested document",
    billing_dispute: "Regarding your billing request",
    complaint: "Following up on your concern",
    general_request: "Following up on your message"
  };

  return labels[intent] || labels.general_request;
}

function buildEmailBody(envelope, draft) {
  const greetingName = envelope.contact.name || "Guest";
  const lines = cleanLines(draft);
  const body = lines.join("\n\n");

  return [`Hello ${greetingName},`, body, "Best,", "Guest Services"].join("\n\n");
}

export function renderSuggestion({ envelope, draft, intent }) {
  if (envelope.channel === "email") {
    return {
      channel: "email",
      subject: buildEmailSubject(envelope, intent),
      body: buildEmailBody(envelope, draft)
    };
  }

  return {
    channel: "sms",
    segments: splitSmsSegments(draft)
  };
}
