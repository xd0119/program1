// site-config.js —— 公开部署配置（放心提交到 GitHub，**不包含任何 Key/Secret**）
//
// 填写说明：
// 1. 先在 Cloudflare 创建 Worker（路线：Start with Hello World → Edit Code → 粘贴 cf-worker-zhipu-proxy.js → Deploy）
// 2. Worker 的 Settings → Variables → Environment Variables，添加 ZHIPU_API_KEY（勾选 Encrypt 加密！）
// 3. 回到 Worker Overview，复制右上角显示的 workers.dev 公网 URL，粘贴到下方 ZHIPU_PROXY_URL
// 4. 保持后面的 /chat/completions 路径（Worker 里只接受 / 或 /chat/completions）

window.SITE_CONFIG = {
  // ↓↓↓ Cloudflare Worker 的公网 URL，部署完把下面示例 URL 替换成你自己的 ↓↓↓
  ZHIPU_PROXY_URL: 'https://program1.pages.dev/api/chat/completions',
  // 
};
