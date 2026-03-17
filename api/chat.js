export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '')
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\/+$/, '');
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '')
    .trim()
    .replace(/^"|"$/g, '');
  const modelName = (process.env.AZURE_OPENAI_MODEL_NAME || '')
    .trim()
    .replace(/^"|"$/g, '');
  const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || '2024-02-01')
    .trim()
    .replace(/^"|"$/g, '');

  if (!endpoint || !apiKey || !deployment) {
    return res.status(500).json({ error: 'Azure OpenAI 환경변수 미설정', missing: { endpoint: !endpoint, apiKey: !apiKey, deployment: !deployment } });
  }

  const legacyUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const v1Url = `${endpoint}/openai/v1/chat/completions`;

  const extractText = (payload) => {
    const firstChoice = payload?.choices?.[0];
    const msg = payload?.choices?.[0]?.message?.content;
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (msg && typeof msg === 'object' && typeof msg.text === 'string' && msg.text.trim()) {
      return msg.text;
    }
    if (Array.isArray(msg)) {
      const joined = msg
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim();
      if (joined) return joined;
    }

    const refusal = payload?.choices?.[0]?.message?.refusal;
    if (typeof refusal === 'string' && refusal.trim()) return refusal;

    if (typeof firstChoice?.text === 'string' && firstChoice.text.trim()) {
      return firstChoice.text;
    }

    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
      return payload.output_text;
    }

    const outArr = payload?.output;
    if (Array.isArray(outArr)) {
      const joined = outArr
        .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
        .map((c) => (typeof c?.text === 'string' ? c.text : ''))
        .join('')
        .trim();
      if (joined) return joined;
    }

    return '';
  };

  try {
    const { max_tokens, system, messages } = req.body;

    const openaiMessages = [];
    if (system) {
      openaiMessages.push({ role: 'system', content: system });
    }

    for (const msg of (messages || [])) {
      if (Array.isArray(msg.content)) {
        const textParts = [];
        for (const part of msg.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'document') {
            const docText = part.source?.data || part.source?.text || '';
            const title = part.title || '첨부 문서';
            textParts.push('\n\n[' + title + ']\n' + docText);
          }
        }
        openaiMessages.push({ role: msg.role, content: textParts.join('\n') });
      } else {
        openaiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const tokenLimit = Number(max_tokens) || 4096;
    const legacyPayload = {
      messages: openaiMessages,
      max_tokens: tokenLimit,
      temperature: 0,
    };
    const v1Payload = {
      messages: openaiMessages,
      max_completion_tokens: tokenLimit,
    };

    let response = await fetch(legacyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(legacyPayload),
    });

    let data = await response.json();
    let usedUrl = legacyUrl;

    // Some Azure resources only support the newer v1 chat path with model in body.
    if (!response.ok && response.status === 404 && data?.error?.code === 'DeploymentNotFound') {
      const modelCandidates = [
        modelName,
        deployment,
        deployment.replace(/-\d+$/g, ''),
      ].filter((v, i, arr) => v && arr.indexOf(v) === i);

      for (const model of modelCandidates) {
        response = await fetch(v1Url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify({
            ...v1Payload,
            model,
          }),
        });
        data = await response.json();

        // If the model stops by length and returns empty content, retry once with a larger output budget.
        const firstChoice = data?.choices?.[0];
        const maybeEmpty = !firstChoice?.message?.content;
        if (
          response.ok &&
          maybeEmpty &&
          firstChoice?.finish_reason === 'length'
        ) {
          const retryLimit = Math.min(Math.max(tokenLimit * 3, 8192), 16384);
          response = await fetch(v1Url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': apiKey,
            },
            body: JSON.stringify({
              ...v1Payload,
              max_completion_tokens: retryLimit,
              model,
            }),
          });
          data = await response.json();
        }

        if (response.ok) break;
      }
      usedUrl = v1Url;
    }

    if (!response.ok) {
      return res.status(response.status).json({ ...data, _debug_url: usedUrl });
    }

    const content = extractText(data);
    if (!content) {
      return res.status(502).json({
        error: {
          code: 'EMPTY_MODEL_OUTPUT',
          message: '모델 응답이 비어 있습니다. model/response format을 확인하세요.',
        },
        _debug_url: usedUrl,
        _debug_keys: Object.keys(data || {}),
        _debug_choice: data?.choices?.[0] || null,
      });
    }
    res.status(200).json({
      content: [{ type: 'text', text: content }],
      usage: data.usage,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
