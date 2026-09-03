# 智谱 API Key 保护方案（Gitee Go 云函数代理）

> **核心思路**：把真 API Key 放在 Gitee Go 云函数的「环境变量」里，浏览器永远只和你自己的云函数通信，云函数再带 Key 去调用智谱。
> 浏览器方 **拿不到** 真 Key，Key 也 **不会** 出现在任何公开文件里。

---

## 一、架构

```
浏览器（GitHub Pages / 本地）
     │
     │  fetch('https://你的Gitee云函数域名/api/chat', { body: 同智谱请求体 })
     ▼
Gitee Go 云函数（Node.js 18）
     │  Authorization: Bearer process.env.ZHIPU_API_KEY   ← 真Key存在云函数环境变量
     ▼
智谱 API （https://open.bigmodel.cn/api/paas/v4/chat/completions）
     │
     └───── SSE流式结果 ─────► 云函数 ─────► 原样透传给浏览器
```

顺便在云函数里做：
- **Referer 白名单**（只允许 `xd0119.github.io` + `localhost`）
- **简易限流**（每个 IP 每分钟最多 10 次）
- **CORS 放行**（仅允许你自己域名跨域）

---

## 二、Gitee Go 云函数部署步骤

### 1. 开通 Gitee Go
1. 打开 <https://gitee.com/go> 登录你的 Gitee 账号
2. 进入「云函数」→「新建服务」→ 服务名填 `zhipu-proxy`（任意）
3. 运行环境选择 **Node.js 18**（或 20），函数名 `chat`，触发器选「HTTP 触发器」，认证方式选「匿名调用」。

### 2. 写函数代码
把本目录下 `zhipu-proxy-handler.js` 的内容 **整个粘贴** 进在线代码编辑器的 `index.js`（或 `handler.js`，看Gitee给你的入口文件名）。

### 3. 配置环境变量（最关键！）
在云函数控制台 → 「配置」→「环境变量」，新增：
```
键名：ZHIPU_API_KEY
值：  你自己的智谱 API Key（在智谱控制台取一个新Key）
```
保存。环境变量是加密存储的，谁（包括仓库其他合作者）都看不到真实值。

### 4. 部署并拿触发URL
- 点击「部署」，等待几秒后上线
- 触发器会给你一个公网URL，类似：
  ```
  https://xxxx-xxxx.gitee.io/zhipu-proxy/chat
  ```
  或者是：
  ```
  https://go.gitee.com/api/v1/namespaces/xxxx/services/zhipu-proxy/functions/chat:invoke
  ```
- 把这个URL填到 **下一节三 的配置步骤里**。

---

## 三、作品集站点代码切换到云函数代理

在 `index.html` 的调用端（`callZhipuStream`）已经预留了两种模式：
- 本地开发：直连智谱（读 `secret.js` 的 Key）
- 线上：走云函数代理（读 `window.ZHIPU_PROXY_URL`）

### 方法：在线上注入代理URL变量

在 `index.html` 中 `<script src="./secret.js">` 那一行，**改成只有本地开发才有secret.js，而线上引入代理配置**。

推荐做法：新建一个不会被忽略的 `site-config.js`（安全，因为它只存公开URL）：

```js
// site-config.js — 可以安全 commit，只放公开信息
// ======================================
// 🎯 请把下面的URL换成你部署Gitee云函数后拿到的触发器URL
window.ZHIPU_PROXY_URL = 'https://xxxx-xxxx.gitee.io/zhipu-proxy/chat';
```

然后 `index.html` 改成：
```html
<script src="./site-config.js"></script>
<!-- 线上不传 secret.js，自动判断：有 PROXY_URL 走代理，否则看是否有本地Key -->
<script src="./secret.js"></script>
```

判断逻辑在 `callZhipuStream` 里加一句优先级即可——下面给出修改示例：

```js
// callZhipuStream 入口处增加：
if (typeof window.ZHIPU_PROXY_URL === 'string' && window.ZHIPU_PROXY_URL.startsWith('http')) {
  // 走云函数代理（不传 Key，云函数自己拿）
  return callZhipuThroughProxy(window.ZHIPU_PROXY_URL, message, onToken);
}
// 否则按原本逻辑读本地Key直连
```

（需要我帮你把这个判断直接加进 index.html，告诉我一声就加。）

---

## 四、为什么选 Gitee Go 而不是其他云函数

| 对比项 | Gitee Go 云函数 | Cloudflare Worker | Vercel Functions |
|---|---|---|---|
| 免费额度 | 每月 100万 调用 / 400GB·s | 每日 10万 无冷启动 | 每月 100GB·h |
| 国内访问速度 | ✅ 快（国内节点） | ⚠️ 偶发延迟 | ⚠️ 海外 |
| 你已有账号 | ✅ Gitee 已有账号 | ❌ 需注册 | ⚠️ 可能有 |
| SSE 流式透传 | ✅ Node原生支持 | ✅ 原生支持 | ✅ 支持 |

**你已经有 Gitee 账号 + 使用习惯，直接复用最省事。**

---

## 五、其他保护动作（强烈建议一并完成）

1. **废弃当前Key**：智谱控制台把 `81fb7bcd...` 这个Key删掉/立即失效，重新生成一个新Key。
2. **域名Referer白名单**：智谱控制台给新Key加 HTTP Referer 白名单：
   ```
   xd0119.github.io
   localhost
   ```
3. **日限额**：智谱控制台给新Key设一个你能接受的日最大消耗值。

做完这三步，即使最坏情况（代理代码被他人搭车调用），损失也可控。
