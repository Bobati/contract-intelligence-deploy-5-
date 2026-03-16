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
  const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || '2024-02-01')
    .trim()
    .replace(/^"|"$/g, '');

  if (!endpoint || !apiKey || !deployment) {
    return res.status(500).json({ error: 'Azure OpenAI 환경변수 미설정', missing: { endpoint: !endpoint, apiKey: !apiKey, deployment: !deployment } });
  }

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        messages: openaiMessages,
        max_tokens: max_tokens || 4096,
        temperature: 0.3,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ ...data, _debug_url: url.replace(apiKey, '***') });
    }

    const content = data.choices?.[0]?.message?.content || '';
    res.status(200).json({
      content: [{ type: 'text', text: content }],
      usage: data.usage,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
