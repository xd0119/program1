/**
 * ==========================================
 *  Gitee Go 云函数 — 智谱 API 代理 / SSE流式透传
 * ==========================================
 *  粘贴到 Gitee Go 的入口文件（通常是 index.js 或 handler.js）。
 *  在云函数控制台「环境变量」里添加：
 *      ZHIPU_API_KEY = 你自己的智谱 API Key
 *  （可选）ZHIPU_ALLOWED_REFERERS = xd0119.github.io,localhost
 *  （可选）ZHIPU_RATE_LIMIT_PER_MIN = 10   （每IP每分钟最多请求数，0=不限）
 * ==========================================
 */

const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// —— 简易内存限流（单实例维度；Gitee多实例会分散，但对作品集站点够用）——
const rateMap = new Map(); // ip -> [ts, ts, ...]
function isRateLimited(ip, perMin) {
  if (!perMin || perMin <= 0) return false;
  const now = Date.now();
  const windowStart = now - 60 * 1000;
  const arr = rateMap.get(ip) || [];
  const fresh = arr.filter((t) => t > windowStart);
  if (fresh.length >= perMin) return true;
  fresh.push(now);
  rateMap.set(ip, fresh);
  return false;
}

// —— 入口（Gitee Go 标准导出：handler = async (req, res) => {} 或 exports.main）——
// Gitee Go 常见两种签名：
//   A. exports.main = async (req, res) => {}   (Express 风格)
//   B. exports.main = async (event) => {}      (事件风格)
// 为了兼容两种，这里都导出：

async function handle(reqLike, resLike) {
  const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
  const ALLOWED_REFERERS = (process.env.ZHIPU_ALLOWED_REFERERS || 'xd0119.github.io,localhost,127.0.0.1')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const RATE_LIMIT = parseInt(process.env.ZHIPU_RATE_LIMIT_PER_MIN || '10', 10) || 0;

  // —— 归一化 req（兼容事件和Express）——
  let method = 'POST';
  let headers = {};
  let body = null;
  let clientIp = '0.0.0.0';
  let referer = '';
  let res = resLike;

  if (resLike && typeof resLike === 'object' && typeof resLike.setHeader === 'function') {
    // Express/Connect 风格
    method = (reqLike.method || 'POST').toUpperCase();
    headers = reqLike.headers || {};
    body = reqLike.body;   // 有些平台会自动解析；若为 buffer/string 稍后处理
    referer = headers.referer || headers.referrer || '';
    clientIp =
      headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      headers['x-real-ip'] ||
      reqLike.ip ||
      clientIp;
  } else {
    // 事件风格（event 对象）
    const event = reqLike;
    method = (event.httpMethod || event.method || 'POST').toUpperCase();
    headers = event.headers || {};
    referer = headers.referer || headers.referrer || '';
    clientIp =
      headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      headers['x-real-ip'] ||
      event.requestContext?.identity?.sourceIp ||
      clientIp;
    if (event.body) {
      try {
        body = event.isBase64Encoded ? JSON.parse(Buffer.from(event.body, 'base64').toString('utf-8')) : JSON.parse(event.body);
      } catch (_) {
        body = null;
      }
    }
    // 事件风格需要手工返回 {statusCode, headers, body}，下面赋值假的 res 用于透传
    res = null;
  }

  // —— 1. 预检 CORS ——
  const origin = headers.origin || '';
  const corsOrigin = ALLOWED_REFERERS.some((r) => origin.includes(r)) || origin.includes('gitee.io')
    ? origin
    : 'https://xd0119.github.io';

  const send = (code, payload, extraHeaders = {}) => {
    const outHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    };
    if (res) {
      res.status(code);
      for (const k of Object.keys(outHeaders)) res.setHeader(k, outHeaders[k]);
      if (typeof payload === 'string') res.send(payload); else res.json(payload);
      return;
    }
    // 事件风格返回
    return { statusCode: code, headers: outHeaders, body: JSON.stringify(payload) };
  };

  if (method === 'OPTIONS') return send(204, null);

  // —— 2. 方法校验 ——
  if (method !== 'POST') return send(405, { error: 'Method Not Allowed' });

  // —— 3. Referer 白名单 ——
  const isAllowedReferer = ALLOWED_REFERERS.some((r) => referer.includes(r)) || referer === '';
  if (!isAllowedReferer) {
    return send(403, { error: 'Forbidden: referer not allowed' });
  }

  // —— 4. 限流 ——
  if (isRateLimited(clientIp, RATE_LIMIT)) {
    return send(429, { error: 'Too Many Requests. 作品集代理限流，请稍后再试。' });
  }

  // —— 5. Key 校验 ——
  if (!ZHIPU_API_KEY) {
    return send(500, { error: 'Server misconfigured: ZHIPU_API_KEY missing' });
  }

  // —— 6. 请求体校验 ——
  if (!body || typeof body !== 'object') return send(400, { error: 'Invalid JSON body' });
  // 强制用 glm-4-flash + stream，禁止改模型防越权
  body.model = 'glm-4-flash';
  body.stream = true;
  // 强制只在服务端附加 knowledge_id（避免前端乱改）
  body.retrieval = {
    knowledge_id: '2083129946280181760',
    prompt_template: '用户提问：{{question}}\n从知识库中检索到的参考内容：{{knowledge}}\n请结合知识库内容优先作答。',
    top_k: 3,
  };
  // messages 必须存在
  if (!Array.isArray(body.messages)) return send(400, { error: 'messages missing' });

  // —— 6.1 把客户端传上来的项目详情页内容拼进 system prompt（代理端完成，避免传输大内容走往返）
  const SYSPROMPT = `你是许晓丹（XD）的个人AI助手，负责回答关于XD的求职、项目经历、技能背景等问题。
你的人物设定：自信又低调，专业但不呆板，回答要简洁、真实、有具体数据。
核心能力边界：
- 只说XD真实做过的事情，不要编造项目、数据、奖项、院校、经历
- 项目回答格式：[项目名称]担任[角色]，负责[核心职责]，使用[技术栈]，实现[主要功能]，成果[具体数据]
- 不要每次都做自我介绍
- 项目回答格式：如果不确定的信息，直接说"这个问题建议联系本人电话咨询~"
- 如果用户提问与【标准问答库】中的问题匹配或同类，严格按照知识库答案的措辞和结构回答（分点务必1.2.3.递增编号，严禁所有条目都写1.）
- 技术栈归属：作品集网站=纯静态HTML/CSS/JS，Vue/Node/MongoDB等均是其他项目的技术栈，禁止串答。
`;
  const ctx = body._project_context;
  let systemContent = SYSPROMPT;
  if (ctx && typeof ctx === 'string' && ctx.trim().length > 20) {
    systemContent += `\n\n${ctx}\n\n【回答规则 - 强制遵守】\n1. 优先依据上述项目详情资料和知识库中检索到的内容作答，不要编造。\n2. 分点务必1.2.3.递增编号，严禁所有条目都写1.。\n3. 不要添加知识库中没有的信息。\n4. 技术栈归属：作品集网站=纯静态HTML/CSS/JS，Vue/Node/MongoDB等均是其他项目技术栈，禁止串答。`;
  }
  delete body._project_context;
  // 确保 messages 第0条是 system（前端代理模式下故意不传system，由服务端统一注入）
  if (!body.messages.some((m) => m.role === 'system')) {
    body.messages.unshift({ role: 'system', content: systemContent });
  } else {
    // 如果已经有 system 就覆盖为服务端版本，防止前端绕过规则
    body.messages = body.messages.map((m) => m.role === 'system' ? { role: 'system', content: systemContent } : m);
  }

  // —— 7. 转发到智谱 ——
  let upstream;
  try {
    upstream = await fetch(ZHIPU_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ZHIPU_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return send(502, { error: 'Upstream unavailable: ' + e.message });
  }

  const upstreamType = upstream.headers.get('content-type') || '';
  const streamMode = upstreamType.includes('text/event-stream') || upstreamType.includes('application/x-ndjson');

  // —— 8A. 非流式（智谱偶尔会回非流式）——
  if (!streamMode) {
    const json = await upstream.json();
    if (json.error) return send(502, json);
    // 服务端去掉 retrieval_documents，精简 payload 大小
    if (json?.choices?.[0]?.message) delete json.choices[0].retrieval_documents;
    return send(upstream.status, json);
  }

  // —— 8B. SSE 流式：边读边写 ——
  const outHeaders = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (res) {
    // Express 风格：直接写流
    res.status(upstream.status);
    for (const k of Object.keys({
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      ...outHeaders,
    })) {
      res.setHeader(k, {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        ...outHeaders,
      }[k]);
    }
    // Express 4.x 开启 flush
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split(/\r?\n\r?\n/);
      buf = chunks.pop() || '';
      for (const c of chunks) {
        res.write(c + '\n\n');
        if (typeof res.flush === 'function') res.flush();
      }
    }
  } else {
    // 事件风格：很难透传SSE，只能等全部收完再回
    const text = await upstream.text();
    const merged = {
      statusCode: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Access-Control-Allow-Origin': corsOrigin,
        'Cache-Control': 'no-cache',
      },
      isBase64Encoded: false,
      body: text,
    };
    return merged;
  }
}

exports.main = handle;
exports.handler = handle;
module.exports = handle;
