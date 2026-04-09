export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const apiKey = process.env.Gemini_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini_API_KEY 미설정' });
  try {
    let model = req.body.model || 'gemini-2.5-flash';
    if (!model.startsWith('gemini-')) {
      model = 'gemini-2.5-flash';
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const contents = req.body.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));
    const bodyData = {
      contents: contents
    };
    if (req.body.system) {
      bodyData.systemInstruction = { parts: [{ text: req.body.system }] };
    }
    if (req.body.max_tokens) {
      bodyData.generationConfig = { maxOutputTokens: req.body.max_tokens };
    }
    // PDF/문서 인라인 첨부: 마지막 user 메시지의 parts 앞에 삽입
    if (req.body.document && req.body.document.data) {
      const lastMsg = contents[contents.length - 1];
      lastMsg.parts = [
        { inlineData: { mimeType: req.body.document.mimeType || 'application/pdf', data: req.body.document.data } },
        ...lastMsg.parts,
      ];
    }
    const maxRetries = 5;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyData),
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 503 && attempt < maxRetries - 1) {
            // 503 오류일 경우 점진적 대기 (최대 30초)
            const waitTime = Math.min(5000 * (attempt + 1), 30000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          return res.status(response.status).json(data);
        }
        if (data.candidates && data.candidates[0]) {
          // gemini-2.5-flash는 thinking 모델: parts[0]이 thought(사고과정)이고
          // parts[1]이 실제 응답일 수 있음. thought=true 가 아닌 첫 번째 part 추출.
          const parts = data.candidates[0].content.parts || [];
          const responsePart = parts.find(p => !p.thought && p.text != null) || parts[0] || {};
          const text = responsePart.text || '';
          return res.status(response.status).json({ content: [{ text: text }] });
        } else {
          return res.status(500).json({ error: '응답 처리 실패', response: data });
        }
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
      }
    }

    // 모든 재시도 실패
    return res.status(500).json({ error: lastError?.message || '모든 재시도 실패' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
