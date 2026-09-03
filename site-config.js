// site-config.js —— 纯静态站点公共配置（可以放心提交到 GitHub，不含 Key）
// 部署在 GitHub Pages 时，PROXY 走 Cloudflare Worker，Key 只在 Worker 里
// 本地双击 html 打开时，ZHIPU_API_KEY 仍由 secret.js 注入（secret.js 已被 .gitignore 保护）
window.SITE_CONFIG = {
  // ↓↓↓ 把第 5 步拿到的 Worker URL 粘贴到这里 ↓↓↓
  ZHIPU_PROXY_URL: 'https://zhipu-proxy-xd.xd316012029.workers.dev/chat/completions',
};