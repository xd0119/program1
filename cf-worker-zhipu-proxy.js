/**
 * Cloudflare Worker —— 智谱大模型 API 代理
 * 功能：
 *   1. 前端只需要把 POST 请求发到本 Worker 的 URL（路径 /chat/completions 或根路径都行）
 *   2. Worker 从环境变量 ZHIPU_API_KEY 读取 Key，附加 Authorization，再转发到 open.bigmodel.cn
 *   3. 支持流式（SSE）与非流式响应，支持请求头透传（Content-Type / Accept 等）
 *   4. CORS 全开，方便 GitHub Pages 跨域调用
 *
 * 部署步骤详见文档：8 步即可完成。
 */

export default {
  async fetch(request, env, ctx) {
    // —— 预检 CORS ——
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // —— 只允许 POST ——
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed, use POST /chat/completions' }), {
        status: 405,
        headers: corsHeaders(),
      });
    }

    // —— 读取 API Key（在 Workers 控制台 "Settings → Variables → Environment Variables" 里加 ZHIPU_API_KEY，勾选 Encrypt）——
    const apiKey = env.ZHIPU_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ZHIPU_API_KEY not set in Worker env' }), {
        status: 500,
        headers: corsHeaders(),
      });
    }

    let upstreamUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    try {
      const reqUrl = new URL(request.url);
      // 前端如果调用 https://xxx.workers.dev/chat/completions 也行；调用根路径也走同一个接口
      if (reqUrl.pathname && reqUrl.pathname !== '/' && reqUrl.pathname !== '/chat/completions') {
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: corsHeaders() });
      }
    } catch (e) {}

    // —— 读请求体（原样透传，由智谱校验 model/messages/retrieval 等字段）——
    let bodyText;
    try {
      bodyText = await request.text();
      JSON.parse(bodyText); // 只是校验一下合法性，避免直接转发坏请求
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    // —— 转发到智谱 ——
    let upstreamResp;
    try {
      upstreamResp = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Accept': request.headers.get('Accept') || 'text/event-stream',
          'User-Agent': 'Cloudflare-Worker-Zhipu-Proxy/1.0',
        },
        body: bodyText,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Upstream network error: ' + (e && e.message ? e.message : String(e)) }), {
        status: 502,
        headers: corsHeaders(),
      });
    }

    // —— 构造响应，保留流式可读 ——
    const respHeaders = new Headers(upstreamResp.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.set('Access-Control-Expose-Headers', 'Content-Type, X-Request-ID');
    // 移除可能影响流式的缓存头
    respHeaders.delete('Content-Encoding');
    respHeaders.delete('Transfer-Encoding');

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      headers: respHeaders,
    });
  },
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  };
}
