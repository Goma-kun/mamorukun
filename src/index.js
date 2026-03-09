export default {
  /**
   * Cloudflare Workers entry point.
   * - /api/chat への POST を Gemini API へプロキシ
   * - それ以外のパスは静的アセット (public/) を返す
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API ルート: /api/chat
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChatProxy(request, env);
    }

    // 上記以外は静的ファイルを返す
    return env.ASSETS.fetch(request);
  },
};

async function handleChatProxy(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(
      {
        error: {
          message:
            "Server configuration error: GEMINI_API_KEY is not set on this Worker.",
        },
      },
      { status: 500 }
    );
  }

  const upstreamUrl =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
    apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: payload.contents,
        systemInstruction: {
          parts: [{ text: "参考リンクやURLは絶対に出力しないでください。回答は本文のみにしてください。" }],
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await upstreamRes.json();

    // そのままフロントに返す（askAI 側で data.candidates をパースする）
    return json(data, { status: upstreamRes.status });
  } catch (err) {
    clearTimeout(timeoutId);
    return json(
      { error: { message: "Upstream request failed: " + err.toString() } },
      { status: 502 }
    );
  }
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

