import { config } from "../config.js";

function trimUrl(value = "") {
  return (value || "").trim().replace(/\/+$/, "");
}

function isAzureInferenceChatUrl(value = "") {
  return /\.services\.ai\.azure\.com\/models\/chat\/completions(?:\?|$)/i.test(value);
}

function normalizeBaseUrl(baseUrl = "") {
  const trimmed = trimUrl(baseUrl);
  if (!trimmed) {
    return "https://api.openai.com/v1";
  }

  if (isAzureInferenceChatUrl(trimmed)) {
    return trimmed;
  }

  if (/\.azure\.com$/i.test(trimmed) || /\.azure\.com\/openai$/i.test(trimmed)) {
    return `${trimmed.replace(/\/openai$/i, "")}/openai/v1`;
  }

  if (/\.azure\.com\/openai\/v1$/i.test(trimmed) || /\.services\.ai\.azure\.com\/openai\/v1$/i.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

function getMode(baseUrl) {
  if (isAzureInferenceChatUrl(baseUrl)) {
    return "azure-inference-chat";
  }

  if (/\.openai\.azure\.com\/openai\/v1$/i.test(baseUrl) || /\.services\.ai\.azure\.com\/openai\/v1$/i.test(baseUrl)) {
    return "responses";
  }

  if (/\/v1$/i.test(baseUrl)) {
    return "responses";
  }

  return "responses";
}

export function getLlmRequestConfig() {
  const baseUrl = normalizeBaseUrl(config.openai.baseUrl);
  const mode = getMode(baseUrl);
  const headers = {
    "Content-Type": "application/json"
  };

  if (mode === "azure-inference-chat" || /\.azure\./i.test(baseUrl)) {
    headers["api-key"] = config.openai.apiKey;
  } else {
    headers.Authorization = `Bearer ${config.openai.apiKey}`;
  }

  return { baseUrl, mode, headers };
}

export function buildLlmRequest({ input, temperature = 0.1 }) {
  const llm = getLlmRequestConfig();

  if (llm.mode === "azure-inference-chat") {
    return {
      url: llm.baseUrl,
      headers: llm.headers,
      body: {
        model: config.openai.model,
        messages: [{ role: "user", content: input }],
        temperature
      }
    };
  }

  return {
    url: `${llm.baseUrl}/responses`,
    headers: llm.headers,
    body: {
      model: config.openai.model,
      input,
      temperature
    }
  };
}

export async function callLlm({ input, temperature = 0.1 }) {
  const request = buildLlmRequest({ input, temperature });
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  return response;
}

export function extractResponseText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const choiceContent = data.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string" && choiceContent.trim()) {
    return choiceContent.trim();
  }

  if (Array.isArray(choiceContent)) {
    const blocks = choiceContent
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (typeof item?.text === "string") {
          return item.text.trim();
        }
        return "";
      })
      .filter(Boolean);
    if (blocks.length) {
      return blocks.join("\n").trim();
    }
  }

  const chunks = [];
  for (const item of data.output || []) {
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (typeof contentItem.text === "string" && contentItem.text.trim()) {
        chunks.push(contentItem.text.trim());
      }
    }
  }

  return chunks.join("\n").trim();
}
