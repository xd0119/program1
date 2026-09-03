// site-config.js —— 公开部署配置（放心提交到 GitHub，**不包含任何 Key/Secret**）
//
// 填写说明：
// 1. 先在 Cloudflare 创建 Worker（路线：Start with Hello World → Edit Code → 粘贴 cf-worker-zhipu-proxy.js → Deploy）
// 2. Worker 的 Settings → Variables → Environment Variables，添加 ZHIPU_API_KEY（勾选 Encrypt 加密！）
// 3. 回到 Worker Overview，复制右上角显示的 workers.dev 公网 URL，粘贴到下方 ZHIPU_PROXY_URL
// 4. 保持后面的 /chat/completions 路径（Worker 里只接受 / 或 /chat/completions）
//
// 双通道机制（和 index.html 的 callZhipuStream 一致）：
//   · 本地双击 html 打开：
//       ① 若存在 secret.js（.gitignore 忽略） → 直接带 Bearer 访问 open.bigmodel.cn
//       ② 若没有 secret.js                  → 通过下面 ZHIPU_PROXY_URL 走 Cloudflare Worker 代理
//   · 线上 GitHub Pages：
//       仓库里不会有 secret.js（已被 .gitignore），所以一定走 ZHIPU_PROXY_URL → Cloudflare Worker → 智谱，
//       API Key 只以 Encrypt 环境变量形式存在 Cloudflare 后台，前端永远见不到明文。

window.SITE_CONFIG = {
  // ↓↓↓ Cloudflare Worker 的公网 URL，部署完把下面示例 URL 替换成你自己的 ↓↓↓
  ZHIPU_PROXY_URL: 'https://zhipu-proxy-xd.你的用户名.workers.dev/chat/completions',
  // ↑↑↑ 示例：https://zhipu-proxy-xd.xd316012029.workers.dev/chat/completions（把中间的 subdomain 换成你 Cloudflare 显示的）
};
