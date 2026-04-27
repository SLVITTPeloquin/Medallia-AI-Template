#!/usr/bin/env node
import 'dotenv/config';

const args = parseArgs(process.argv.slice(2));

const token = args.token || process.env.ZINGLE_TOKEN;
const username = args.username || process.env.ZINGLE_USERNAME;
const password = args.password || process.env.ZINGLE_PASSWORD;
const auth = buildAuth({ token, username, password });

const serviceId = args.service || process.env.ZINGLE_SERVICE_ID;
const baseUrl = (args.baseUrl || process.env.ZINGLE_BASE_URL || 'https://api.zingle.me/v1').replace(/\/$/, '');
const start = args.start;
const end = args.end;
const timestampUnit = args.timestampUnit || 'milliseconds';
const pageSize = Number(args.pageSize || 200);

if (!auth || !serviceId || !start || !end) {
  usage('Missing required params. Need auth (token or username/password), service, start, and end.');
  process.exit(1);
}

const startEpoch = toEpoch(start, timestampUnit);
const endEpoch = toEpoch(end, timestampUnit);

if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) {
  usage('Invalid start/end format. Use ISO-8601 (recommended) or epoch number.');
  process.exit(1);
}

if (startEpoch >= endEpoch) {
  usage('start must be less than end.');
  process.exit(1);
}

const createdAtFilter = `greater_than(${startEpoch}),less_than(${endEpoch})`;

try {
  const outboundTotal = await fetchMessagesTotal({ baseUrl, auth, serviceId, createdAtFilter });

  const eventSummary = await fetchAndClassifyOutboundEvents({
    baseUrl,
    auth,
    serviceId,
    createdAtFilter,
    pageSize
  });

  const result = {
    input: {
      service_id: serviceId,
      base_url: baseUrl,
      auth_mode: auth.kind,
      start,
      end,
      timestamp_unit: timestampUnit,
      start_epoch: startEpoch,
      end_epoch: endEpoch
    },
    counts: {
      outbound_total_messages: outboundTotal,
      outbound_human_events: eventSummary.human,
      outbound_automated_events: eventSummary.automated,
      outbound_unknown_events: eventSummary.unknown,
      outbound_total_events_seen: eventSummary.total
    },
    notes: [
      'outbound_total_messages comes from Messages API total_records for outbound direction.',
      'human/automated split is computed from Events API message events in the same window.',
      'unknown captures message events without clear human or automation signal.'
    ]
  };

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('[error]', err.message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function usage(prefix) {
  if (prefix) console.error(prefix);
  console.error(`\nUsage:\n  node scripts/zingle-outbound-counts.mjs \\
    --service <service_id> \\
    --start <ISO|epoch> \\
    --end <ISO|epoch> \\
    [--token <jwt>] \\
    [--username <email_or_username> --password <password>] \\
    [--baseUrl <https://api.zingle.me/v1>] \\
    [--timestampUnit milliseconds|seconds] \\
    [--pageSize 200]\n`);
}

function buildAuth({ token, username, password }) {
  if (token) {
    return { kind: 'bearer', token };
  }
  if (username && password) {
    const value = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return { kind: 'basic', value };
  }
  return null;
}

function toEpoch(value, unit) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return NaN;
  }
  return unit === 'seconds' ? Math.floor(ms / 1000) : ms;
}

async function fetchMessagesTotal({ baseUrl, auth, serviceId, createdAtFilter }) {
  const url = `${baseUrl}/services/${encodeURIComponent(serviceId)}/messages?communication_direction=outbound&created_at=${encodeURIComponent(createdAtFilter)}&page_size=1`;
  const data = await getJson({ url, auth });
  return Number(data?.status?.total_records || 0);
}

async function fetchAndClassifyOutboundEvents({ baseUrl, auth, serviceId, createdAtFilter, pageSize }) {
  let page = 1;
  let totalPages = 1;

  let human = 0;
  let automated = 0;
  let unknown = 0;
  let total = 0;

  while (page <= totalPages) {
    const url = `${baseUrl}/services/${encodeURIComponent(serviceId)}/events?communication_direction=outbound&created_at=${encodeURIComponent(createdAtFilter)}&page_size=${pageSize}&page=${page}`;
    const data = await getJson({ url, auth });

    totalPages = Number(data?.status?.total_pages || 1);
    const rows = Array.isArray(data?.result) ? data.result : [];

    for (const ev of rows) {
      const msg = ev?.message;
      if (!msg || Object.keys(msg).length === 0) {
        continue;
      }

      total += 1;

      const hasAutomation = Boolean(ev?.automation?.id || ev?.automation_id);
      const hasUser = Boolean(msg?.triggered_by_user_id || ev?.triggered_by_user?.id || ev?.triggered_by_user_id);

      if (hasAutomation) {
        automated += 1;
      } else if (hasUser) {
        human += 1;
      } else {
        unknown += 1;
      }
    }

    page += 1;
  }

  return { human, automated, unknown, total };
}

async function getJson({ url, auth }) {
  const authHeader = auth.kind === 'bearer' ? `Bearer ${auth.token}` : `Basic ${auth.value}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json'
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response (${response.status}) from ${url}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const desc = data?.status?.description || data?.status?.text || response.statusText;
    throw new Error(`HTTP ${response.status} for ${url}: ${desc}`);
  }

  return data;
}
