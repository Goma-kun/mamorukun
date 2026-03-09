export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: 'Invalid JSON body' } }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: { message: 'Server configuration error: GEMINI_API_KEY is not set.' },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
    apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const upstreamRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: payload.contents,
        // デフォルトで googleSearch ツールを有効にする（フロント側から tools を渡していればそれを優先）
        tools: payload.tools || [{ googleSearch: {} }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await upstreamRes.json();

    return new Response(JSON.stringify(data), {
      status: upstreamRes.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);

    return new Response(
      JSON.stringify({
        error: { message: 'Upstream request failed: ' + err.toString() },
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

