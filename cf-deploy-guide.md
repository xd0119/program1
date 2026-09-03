# Cloudflare Workers 部署智谱代理 —— 完整 8 步指南

适用场景：
- 作品集网站部署在 GitHub Pages（纯静态，无法放后端代码）
- 智谱 API Key 绝不能出现在前端 index.html（否则被扒走就会被刷 token）
- 使用 Cloudflare Workers 做 Serverless 中转，Key 只存在 Cloudflare 后台，前端只拿到一个代理 URL

---

## 第 1 步：注册 / 登录 Cloudflare 账号
打开：`https://workers.cloudflare.com/`
- 没有账号 → 点右上角 **Sign Up**，用邮箱注册（免费方案可用，每天 10 万次请求完全够作品集用）
- 已有账号 → 直接登录

登录后进入 Dashboard，左侧选择 **Workers & Pages**。

## 第 2 步：新建 Worker Service
1. Workers & Pages → 右上角 **Create application**
2. 切到 **Create Worker** 标签（不要选 Pages，Pages 是部署静态站的）
3. Name 填一个好记的，比如 `zhipu-proxy-xd`，下面会自动生成 `zhipu-proxy-xd.你的用户名.workers.dev` 这个公网 URL
4. 点 **Deploy**（先随便部署，下一步会改代码）

## 第 3 步：粘贴 Worker 代理代码
1. 上一步 Deploy 完后，点 **Edit Code**（进入在线编辑器）
2. 把左侧默认的 `worker.js` 内容**全删**
3. 打开本地仓库里的 `cf-worker-zhipu-proxy.js`，全选复制 → 粘贴到编辑器
4. 右上角点 **Deploy** → 确认

> 这一步只是把代理代码跑起来，还没填 API Key，下一步配置。

## 第 4 步：配置环境变量（放智谱 API Key，加密）
1. 回到刚才的 Worker Service 主页（不是编辑器，是 Overview 那页）
2. 切到 **Settings → Variables** 标签
3. **Environment Variables** 区域点 **Add variable**：
   - Variable name：`ZHIPU_API_KEY`
   - Value：粘贴你智谱开放平台生成的 Key（和你本地 secret.js 里那个是同一个）
   - ✅ **Encrypt** 一定要勾（勾了之后就没人能再读到明文，包括你自己）
4. 点 **Save and Deploy**

> 免费版 Encrypt 变量会安全加密保存，Worker 运行时才能解密，前端和 git 仓库都接触不到。

## 第 5 步：拿到 Worker 公网 URL
回到 Worker 的 **Overview** 页面，右侧有一个类似：
```
https://zhipu-proxy-xd.你的用户名.workers.dev
```
复制保存下来，下一步填前端。

可以先用 curl 快速测一下是否存活（能返回不是 Not Found/500 的响应就算没问题，返回 401/400 都是正常的"收到请求了"）：
```bash
curl -X POST -H "Content-Type: application/json" -d "{}" https://zhipu-proxy-xd.你的用户名.workers.dev/chat/completions
```

## 第 6 步：修改前端代码 —— 新增 `site-config.js`
在 `index.html` 同级目录新建 `site-config.js`（这个文件**不包含任何 Key**，只是放代理 URL，是公开的）：

```js
// site-config.js —— 纯静态站点公共配置（可以放心提交到 GitHub，不含 Key）
// 部署在 GitHub Pages 时，PROXY 走 Cloudflare Worker，Key 只在 Worker 里
// 本地双击 html 打开时，ZHIPU_API_KEY 仍由 secret.js 注入（secret.js 已被 .gitignore 保护）
window.SITE_CONFIG = {
  // ↓↓↓ 把第 5 步拿到的 Worker URL 粘贴到这里 ↓↓↓
  ZHIPU_PROXY_URL: 'https://zhipu-proxy-xd.你的用户名.workers.dev/chat/completions',
  // ↑↑↑ 填好后删这行注释 ↑↑↑
};
```

然后在 `index.html` 的 `<head>` 里，在引用 `secret.js` 的**前面**，加一行引入：
```html
<script src="site-config.js"></script>
```

## 第 7 步：修改 `callZhipuStream` —— 支持"本地 secret.js"和"Cloudflare 代理"两条路
把 `index.html` 里 `callZhipuStream` 函数开头 **从 L4349 开始** 的这三行：

```js
async function callZhipuStream(message, onToken) {
    // 没有Key直接失败，让sendMessage降级到本地FAQ
    const apiKey = window.ZHIPU_API_KEY;
    if (!apiKey) return { success: false, error: 'API Key 未配置（仅本地开发通过 secret.js 注入，线上走本地FAQ）' };
```

替换成：

```js
async function callZhipuStream(message, onToken) {
    // —— 两种认证方式，二选一就行 ——
    //   ① 本地开发：secret.js 注入了 window.ZHIPU_API_KEY → 直连 open.bigmodel.cn
    //   ② 线上 GitHub Pages：走 Cloudflare Worker 代理（Key 只存在 Worker 环境变量）
    const apiKey = window.ZHIPU_API_KEY;
    const proxyUrl = window.SITE_CONFIG && window.SITE_CONFIG.ZHIPU_PROXY_URL;

    let targetUrl = '';      // 最终请求 URL
    let sendAuthHeader = ''; // 要附加的 Bearer Token（只有直连才加，代理不加，防止前端再带 Key）

    if (apiKey) {
        // 本地模式：直连智谱
        targetUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
        sendAuthHeader = 'Bearer ' + apiKey;
    } else if (proxyUrl && proxyUrl.indexOf('zhipu-proxy-xd.你的用户名.workers.dev') === -1
        && proxyUrl.indexOf('你的用户名.workers.dev') === -1
        && proxyUrl.indexOf('https://zhipu-proxy-xd.你的用户名.workers.dev') === -1) {
        // 线上模式：用代理。上面这一大串判断是防止你忘记把"第6步示例URL"替换成真实URL —— 如果检测到还是示例值就直接报错
        targetUrl = proxyUrl;
        sendAuthHeader = ''; // 注意：这里不要塞 Key！Key 只在 Cloudflare Worker 那边加
    } else {
        return {
            success: false,
            error: '未配置智谱调用通道：本地需 secret.js，线上需在 site-config.js 填 Cloudflare Worker URL。当前自动降级到本地 FAQ。'
        };
    }
```

然后把同函数里 **L4399** 附近原本写死智谱域名的那一段 fetch 调用：

```js
response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
    },
    body: JSON.stringify(requestBody)
});
```

替换成：

```js
const hdrs = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
};
if (sendAuthHeader) hdrs['Authorization'] = sendAuthHeader; // 只有本地直连才带

response = await fetch(targetUrl, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify(requestBody)
});
```

> 顺带检查一下 L4391 附近的 `knowledge_id` 是否已修正为 `2095377489592545280`，model 已修正为 `glm-4.5-air`（对话记录里之前已修过，确认一下即可）。

## 第 8 步：验证 & 推送
1. **本地验证**：先把 secret.js 留着 → 本地 `index.html` 应该仍走"①直连"通路 → 聊天框里提问，观察是否"来自智谱AI"
2. **线上验证**：把 `site-config.js` 的 URL 填对、前端第 7 步改完 → git add commit push → 等 1~3 分钟 GitHub Pages 部署
3. 在线上（`https://xd0119.github.io/program1/`）打开 F12 → Network → 聊天提问 → 看请求是不是打到了 `https://zhipu-proxy-xd.你的用户名.workers.dev/chat/completions`，且返回是 `text/event-stream` 流式内容
4. 如果线上看到 401 → 回到 Worker 的 Variables 页面检查 ZHIPU_API_KEY 是否拼写正确、是否已 Save and Deploy
5. 如果线上看到 CORS 报错 → 清空浏览器缓存再试，Worker 代码里已对 OPTIONS 和正常响应都加了 `Access-Control-Allow-Origin: *`

---

## 常见坑排查清单
| 现象 | 可能原因 | 解决 |
| --- | --- | --- |
| 线上直接降级到本地 FAQ | site-config.js 里 URL 还是示例值 / 没被正确加载 | 按第 6 步替换真实 Worker URL，确认 `<script src="site-config.js">` 已插入 |
| 返回 "ZHIPU_API_KEY not set in Worker env" | 第 4 步没加变量或没加密 | 重走第 4 步，勾 Encrypt，Save and Deploy |
| 401 Unauthorized | Worker 里填的 Key 错了，或智谱那边失效了 | 去智谱开放平台重新生成 Key 再填一次 |
| 流式打字不出内容，但状态码 200 | 返回的 content-type 不是 text/event-stream | F12 看上游响应头，若智谱返回错误 JSON，按错误信息改 requestBody |
| "API Key 未配置"一直出现 | 前端同时没检测到 secret.js 和代理 URL | 确认两条路至少走一条 |

## 后续可选加固（不做也能用，做了更稳）
1. **自定义域名**：Worker Service → Triggers → Custom Domains，绑你自己的域名，比 workers.dev 更"像正规产品"
2. **WAF 速率限制**：Workers → Triggers → Routes，配合 Cloudflare 安全规则做简单防刷（免费版额度足够）
3. **鉴权签名**：如果担心代理 URL 被人刷，可在 site-config 里再加一个"轻量 token"字段，Worker 里先校验这个 token 再转发（这个 token 即使被盗刷额度仍然是你智谱账号里的，防君子不防小人，真要防刷建议绑 WAF + 速率限制）
