/**
 * Cloudflare Pages Function —— 智谱大模型 API 代理
 * 部署路径：functions/api/chat/completions.js
 * 对应 URL：https://<project>.pages.dev/api/chat/completions
 *
 * 选择 Pages Function 而非 Worker 的原因：
 *   workers.dev 子域名在国内网络下常被屏蔽，导致 GitHub Pages 前端无法访问 Worker
 *   pages.dev 子域名国内可达性更好，且复用 Cloudflare 账号 0 成本迁移
 *
 * 环境变量配置（Pages 项目 → Settings → Environment variables）：
 *   ZHIPU_API_KEY = 你的智谱 API Key（务必勾选 Encrypt）
 *
 * 前端调用：
 *   POST https://<project>.pages.dev/api/chat/completions
 *   body 原样透传给智谱 /api/paas/v4/chat/completions
 */

const UPSTREAM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
};

// —— GET 验证入口：浏览器直接访问能返回 JSON，方便确认 Pages Function 已部署
// 实际智谱调用走 POST（onRequestPost），GET 只用来人肉验证部署成功
export async function onRequestGet({ request, env }) {
  const hasKey = !!(env && env.ZHIPU_API_KEY);
  return jsonResponse({
    service: 'zhipu-pages-proxy',
    status: 'alive',
    method: 'Use POST to call Zhipu API',
    apiKeyConfigured: hasKey,
    timestamp: new Date().toISOString()
  }, 200);
}

// —— 预检 CORS ——
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}

// —— 主请求处理 ——
export async function onRequestPost({ request, env }) {
  // 1. 读取 API Key（在 Pages 项目 Settings → Environment variables 加 ZHIPU_API_KEY，勾选 Encrypt）
  const apiKey = env.ZHIPU_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'ZHIPU_API_KEY not set in Pages env' }, 500);
  }

  // 2. 读请求体（原样透传，由智谱校验 model/messages/retrieval 等字段）
  let bodyText;
  try {
    bodyText = await request.text();
    JSON.parse(bodyText); // 仅校验合法性，避免转发坏请求
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // 3. 转发到智谱
  let upstreamResp;
  try {
    upstreamResp = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': request.headers.get('Accept') || 'text/event-stream',
        'User-Agent': 'Cloudflare-Pages-Zhipu-Proxy/1.0',
      },
      body: bodyText,
    });
  } catch (e) {
    return jsonResponse({
      error: 'Upstream network error: ' + (e && e.message ? e.message : String(e))
    }, 502);
  }

  // 4. 构造响应，保留流式可读
  const respHeaders = new Headers(upstreamResp.headers);
  respHeaders.set('Access-Control-Allow-Origin', '*');
  respHeaders.set('Access-Control-Expose-Headers', 'Content-Type, X-Request-ID');
  // 移除可能影响流式解析的压缩/传输头
  respHeaders.delete('Content-Encoding');
  respHeaders.delete('Transfer-Encoding');

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: respHeaders,
  });
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}