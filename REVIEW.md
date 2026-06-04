# Playwright Publisher — 设计方案 Review 与优化建议

> **评审日期**: 2026-06-03  
> **评审范围**: 架构增强、反风控补充、稳定性增强、开发体验、未来扩展性

---

## 1. 架构增强建议

### 1.1 引入事件总线 / 发布订阅模式解耦模块通信

**现状问题**：当前各模块通过直接函数调用紧耦合，日志输出、状态变更通知散落在各处，难以统一监控。

**建议方案**：引入轻量级事件总线，模块间通过事件通信：

```typescript
// src/core/EventBus.ts
type EventHandler = (...args: any[]) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  async emit(event: string, ...args: any[]): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      await handler(...args);
    }
  }
}

export const eventBus = new EventBus();

// 定义类型安全的事件
export interface PublishEvents {
  'publish:start': { platform: string; title: string };
  'publish:success': { platform: string; url: string };
  'publish:failed': { platform: string; error: string; tracePath?: string };
  'browser:launched': void;
  'browser:context-created': { platform: string };
  'auth:expired': { platform: string };
  'auth:saved': { platform: string; path: string };
}
```

**使用示例**：

```typescript
// 在 Publisher 中发射事件
eventBus.emit('publish:success', { platform: 'csdn', url: articleUrl });

// 在日志模块中监听
eventBus.on('publish:success', ({ platform, url }) => {
  logger.info(`✅ [${platform}] 发布成功: ${url}`);
});

// 在通知模块中监听（未来扩展 webhook/钉钉通知）
eventBus.on('publish:failed', ({ platform, error }) => {
  notifier.sendAlert(`${platform} 发布失败: ${error}`);
});
```

**收益**：日志、监控、通知等横切关注点与业务逻辑解耦；新增观察者无需修改发布逻辑。

---

### 1.2 CLI 工具化（commander / yargs）

**现状问题**：手动解析 `process.argv`，缺乏参数校验、子命令支持、自动 help 生成。

**建议方案**：使用 `commander` 构建专业 CLI：

```typescript
// src/cli.ts
import { Command } from 'commander';
import { version } from '../package.json';

const program = new Command();

program
  .name('autopublish')
  .description('自动化多平台文章发布工具')
  .version(version);

// 发布命令
program
  .command('publish')
  .description('发布 Markdown 文章到指定平台')
  .requiredOption('-f, --file <path>', 'Markdown 文件路径')
  .requiredOption('-p, --platforms <platforms>', '目标平台（逗号分隔）', commaSeparated)
  .option('--headless', '无头模式运行', false)
  .option('--trace', '启用 Playwright Trace', false)
  .option('--dry-run', '仅解析不发布（验证流程）', false)
  .action(async (options) => {
    await handlePublish(options);
  });

// 登录命令
program
  .command('login <platform>')
  .description('手动登录并保存认证状态')
  .action(async (platform) => {
    await handleLogin(platform);
  });

// 历史查询命令
program
  .command('history')
  .description('查看发布历史')
  .option('-n, --limit <number>', '显示条数', '10')
  .action(async (options) => {
    await handleHistory(options);
  });

// 状态检查命令
program
  .command('status')
  .description('检查各平台登录状态')
  .action(async () => {
    await handleStatus();
  });

program.parse();

// 辅助函数
function commaSeparated(value: string): string[] {
  return value.split(',').map(s => s.trim());
}
```

**使用效果**：

```bash
autopublish publish -f posts/article.md -p csdn,zhihu --trace
autopublish login csdn
autopublish history -n 20
autopublish status
autopublish --help
```

---

### 1.3 插件化扩展：动态加载平台适配器

**现状问题**：新增平台需修改 `createPublisher` 的 switch-case，违反开放封闭原则。

**建议方案**：基于配置文件动态加载适配器：

```typescript
// src/core/PluginLoader.ts
import type { BasePublisher } from './BasePublisher.js';

interface PluginManifest {
  platforms: Record<string, {
    module: string;       // 相对路径或 npm 包名
    className: string;    // 导出的类名
    enabled: boolean;
  }>;
}

export class PluginLoader {
  private publishers = new Map<string, BasePublisher>();

  async loadFromManifest(manifest: PluginManifest): Promise<void> {
    for (const [name, config] of Object.entries(manifest.platforms)) {
      if (!config.enabled) continue;

      try {
        const module = await import(config.module);
        const PublisherClass = module[config.className];
        this.publishers.set(name, new PublisherClass());
        console.log(`[PluginLoader] ✅ 已加载平台适配器: ${name}`);
      } catch (err) {
        console.error(`[PluginLoader] ❌ 加载 ${name} 失败:`, err);
      }
    }
  }

  getPublisher(platform: string): BasePublisher | undefined {
    return this.publishers.get(platform);
  }

  listAvailable(): string[] {
    return Array.from(this.publishers.keys());
  }
}
```

**配置文件** (`plugins.json`):

```json
{
  "platforms": {
    "csdn": {
      "module": "./platforms/CsdnPublisher.js",
      "className": "CsdnPublisher",
      "enabled": true
    },
    "zhihu": {
      "module": "./platforms/ZhihuPublisher.js",
      "className": "ZhihuPublisher",
      "enabled": true
    },
    "juejin": {
      "module": "./platforms/JuejinPublisher.js",
      "className": "JuejinPublisher",
      "enabled": false
    }
  }
}
```

---

### 1.4 配置分层：环境变量 > 命令行参数 > 配置文件

**建议方案**：实现配置合并优先级链：

```typescript
// src/core/ConfigResolver.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface ResolvedConfig {
  headless: boolean;
  timeout: number;
  proxy?: string;
  platforms: Record<string, PlatformConfig>;
}

export class ConfigResolver {
  /**
   * 配置优先级：ENV > CLI Args > config.json > 默认值
   */
  resolve(cliArgs: Partial<ResolvedConfig>): ResolvedConfig {
    // 1. 默认配置
    const defaults: ResolvedConfig = {
      headless: false,
      timeout: 15_000,
      platforms: {},
    };

    // 2. 配置文件
    const fileConfig = this.loadFileConfig();

    // 3. 环境变量
    const envConfig: Partial<ResolvedConfig> = {
      headless: process.env.AP_HEADLESS === 'true' || undefined,
      timeout: process.env.AP_TIMEOUT ? Number(process.env.AP_TIMEOUT) : undefined,
      proxy: process.env.AP_PROXY || undefined,
    };

    // 4. 合并（后者覆盖前者）
    return this.deepMerge(defaults, fileConfig, cliArgs, this.cleanUndefined(envConfig));
  }

  private loadFileConfig(): Partial<ResolvedConfig> {
    const configPath = resolve(process.cwd(), 'autopublish.config.json');
    if (!existsSync(configPath)) return {};
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  private cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined)
    );
  }

  private deepMerge(...sources: Record<string, unknown>[]): any {
    // 深度合并实现...
  }
}
```

**使用方式**：

```bash
# 环境变量覆盖
AP_HEADLESS=true AP_PROXY=http://127.0.0.1:7890 autopublish publish -f article.md -p csdn

# 命令行参数覆盖
autopublish publish -f article.md -p csdn --headless --timeout 30000
```

---

## 2. 反风控补充

### 2.1 Canvas 指纹随机化

**原理**：网站通过 Canvas 渲染结果生成唯一指纹。注入噪声使每次生成不同的 Canvas 指纹。

```typescript
// src/core/fingerprint/canvas.ts
export function getCanvasNoiseScript(): string {
  return `
    // Canvas 指纹噪声注入
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // 生成稳定的随机偏移（基于 session seed）
    const seed = ${Math.random() * 1000 | 0};
    function noise(x) {
      const n = Math.sin(x * 12.9898 + seed) * 43758.5453;
      return n - Math.floor(n);
    }

    // 拦截 getImageData，添加不可感知的像素噪声
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const imageData = originalGetImageData.apply(this, args);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        // 仅对 R 通道添加 ±1 的噪声（人眼不可感知）
        data[i] = Math.max(0, Math.min(255, data[i] + (noise(i) > 0.5 ? 1 : -1)));
      }
      return imageData;
    };

    // 拦截 toDataURL
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        // 添加不可见的 1px 噪声点
        const r = (noise(1) * 255) | 0;
        const g = (noise(2) * 255) | 0;
        const b = (noise(3) * 255) | 0;
        ctx.fillStyle = \`rgba(\${r},\${g},\${b},0.01)\`;
        ctx.fillRect(0, 0, 1, 1);
      }
      return originalToDataURL.apply(this, args);
    };
  `;
}
```

**集成方式**：

```typescript
// BrowserManager.ts 中注入
await context.addInitScript(getCanvasNoiseScript());
```

---

### 2.2 WebGL 渲染指纹伪造

```typescript
// src/core/fingerprint/webgl.ts
export function getWebGLFingerprintScript(): string {
  return `
    // WebGL 指纹伪造
    const getParameterProxy = new Proxy(
      WebGLRenderingContext.prototype.getParameter,
      {
        apply(target, thisArg, args) {
          const param = args[0];
          // 伪造渲染器信息
          if (param === 0x1F01) return 'NVIDIA Corporation'; // VENDOR
          if (param === 0x1F00) return 'ANGLE (NVIDIA GeForce GTX 1080 Ti Direct3D11)'; // RENDERER
          // 伪造最大各向异性过滤
          if (param === 0x84FF) return 16;
          return Reflect.apply(target, thisArg, args);
        }
      }
    );
    WebGLRenderingContext.prototype.getParameter = getParameterProxy;

    // WebGL2 同样处理
    if (typeof WebGL2RenderingContext !== 'undefined') {
      WebGL2RenderingContext.prototype.getParameter = getParameterProxy;
    }

    // 伪造 WEBGL_debug_renderer_info 扩展
    const originalGetExtension = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function(name) {
      if (name === 'WEBGL_debug_renderer_info') {
        return {
          UNMASKED_VENDOR_WEBGL: 0x9245,
          UNMASKED_RENDERER_WEBGL: 0x9246,
        };
      }
      return originalGetExtension.call(this, name);
    };
  `;
}
```

---

### 2.3 TLS/JA3 指纹 — playwright-extra + stealth plugin

**问题**：Playwright 的 TLS 握手特征（JA3 指纹）与正常浏览器不同，可被服务端识别。

**建议方案**：集成 `playwright-extra` 生态：

```bash
pnpm add playwright-extra puppeteer-extra-plugin-stealth
```

```typescript
// src/core/BrowserManagerStealth.ts
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// 注册隐身插件
chromium.use(StealthPlugin());

export class BrowserManagerStealth {
  async launchBrowser() {
    // stealth plugin 自动处理：
    // - navigator.webdriver 移除
    // - chrome.runtime 伪造
    // - iframe contentWindow 访问修复
    // - Media Codec 支持伪造
    // - 权限查询结果修正
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return browser;
  }
}
```

**如果不引入 playwright-extra**，可手动处理部分 JA3 特征：

```typescript
// 通过 CDP 修改 TLS 客户端参数（实验性）
const cdp = await context.newCDPSession(page);
await cdp.send('Network.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...',
  acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
  platform: 'macOS',
});
```

---

### 2.4 鼠标轨迹贝塞尔曲线模拟

**问题**：`page.click()` 是瞬移点击，没有鼠标移动轨迹，易被高级风控检测。

```typescript
// src/core/fingerprint/mouse.ts

interface Point { x: number; y: number; }

/**
 * 三次贝塞尔曲线鼠标轨迹生成
 * 模拟真实鼠标从 A 点移动到 B 点的非线性路径
 */
export function generateBezierPath(
  start: Point,
  end: Point,
  steps: number = 20,
): Point[] {
  // 生成两个随机控制点（模拟手部抖动）
  const cp1: Point = {
    x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * 100,
    y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * 80,
  };
  const cp2: Point = {
    x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * 100,
    y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * 80,
  };

  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    points.push({
      x: mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x,
      y: mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y,
    });
  }
  return points;
}

/**
 * 沿贝塞尔曲线移动鼠标并点击
 */
export async function humanClick(page: Page, selector: string): Promise<void> {
  const element = await page.waitForSelector(selector, { state: 'visible' });
  const box = await element!.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // 目标点添加随机偏移（不总是点击正中心）
  const target: Point = {
    x: box.x + box.width * (0.3 + Math.random() * 0.4),
    y: box.y + box.height * (0.3 + Math.random() * 0.4),
  };

  // 获取当前鼠标位置（模拟值）
  const start: Point = {
    x: Math.random() * 1440,
    y: Math.random() * 900,
  };

  // 生成贝塞尔曲线路径
  const path = generateBezierPath(start, target, 15 + Math.floor(Math.random() * 10));

  // 沿路径移动鼠标
  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await new Promise(r => setTimeout(r, 5 + Math.random() * 15)); // 5-20ms 每步
  }

  // 模拟点击前的微停顿
  await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
  await page.mouse.click(target.x, target.y);
}
```

---

### 2.5 Cookie 新鲜度维护

**问题**：长时间不刷新的 Cookie 可能过期或被平台标记为可疑。

```typescript
// src/core/CookieRefresher.ts

export class CookieRefresher {
  private readonly MAX_AGE_HOURS = 24; // Cookie 最大有效时长

  /**
   * 检查 storageState 是否需要刷新
   */
  needsRefresh(storageStatePath: string): boolean {
    if (!existsSync(storageStatePath)) return true;

    const stat = statSync(storageStatePath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    return ageHours > this.MAX_AGE_HOURS;
  }

  /**
   * 通过访问平台首页刷新 Cookie
   * 模拟日常浏览行为，保持会话活跃
   */
  async refreshSession(
    platform: string,
    context: BrowserContext,
    homeUrl: string,
  ): Promise<void> {
    console.log(`[CookieRefresher] 刷新 ${platform} 会话...`);

    const page = await context.newPage();
    try {
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });

      // 模拟正常浏览行为
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      await page.mouse.wheel(0, 200 + Math.random() * 300);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

      // 保存刷新后的状态
      const config = platformConfigs[platform];
      await context.storageState({ path: config.storageStatePath });
      console.log(`[CookieRefresher] ${platform} 会话已刷新`);
    } finally {
      await page.close();
    }
  }
}
```

**集成到发布流程**：

```typescript
// 发布前自动检查并刷新
const refresher = new CookieRefresher();
if (refresher.needsRefresh(config.storageStatePath)) {
  await refresher.refreshSession(platform, context, config.homeUrl);
}
```

---

## 3. 稳定性增强

### 3.1 指数退避重试机制

```typescript
// src/core/RetryPolicy.ts

interface RetryOptions {
  maxRetries: number;
  baseDelay: number;      // 基础延迟（ms）
  maxDelay: number;       // 最大延迟上限（ms）
  backoffFactor: number;  // 退避倍数
  retryableErrors?: string[]; // 可重试的错误关键词
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30_000,
  backoffFactor: 2,
  retryableErrors: ['timeout', 'net::ERR_', 'Navigation', 'ECONNRESET'],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否为可重试错误
      const isRetryable = opts.retryableErrors?.some(
        keyword => lastError!.message.includes(keyword)
      ) ?? true;

      if (!isRetryable || attempt === opts.maxRetries) {
        throw lastError;
      }

      // 计算指数退避延迟（含随机抖动）
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffFactor, attempt),
        opts.maxDelay,
      );
      const jitter = delay * (0.5 + Math.random() * 0.5); // 50%-100% 抖动

      console.warn(
        `[Retry] 第 ${attempt + 1}/${opts.maxRetries} 次重试，` +
        `等待 ${Math.round(jitter)}ms... 错误: ${lastError.message}`
      );

      await new Promise(r => setTimeout(r, jitter));
    }
  }

  throw lastError!;
}
```

**使用示例**：

```typescript
// 对整个发布流程添加重试
const result = await withRetry(
  () => publisher.publish(article, context),
  { maxRetries: 2, baseDelay: 5000 }
);

// 对单个操作添加重试（如网络不稳定的页面导航）
await withRetry(
  () => page.goto(url, { waitUntil: 'networkidle' }),
  { maxRetries: 3, baseDelay: 2000 }
);
```

---

### 3.2 超时分级

**问题**：当前使用统一的 `defaultTimeout`，但不同操作的合理超时差异很大。

```typescript
// src/core/TimeoutConfig.ts

export const TIMEOUTS = {
  /** 页面导航/加载 */
  navigation: 30_000,

  /** 元素出现等待 */
  elementVisible: 10_000,

  /** 元素可交互等待 */
  elementInteractive: 8_000,

  /** 网络请求等待（API 响应） */
  networkResponse: 15_000,

  /** 文件上传完成 */
  fileUpload: 20_000,

  /** 联想下拉出现 */
  autocomplete: 3_000,

  /** 页面跳转（发布后） */
  publishRedirect: 30_000,

  /** 动画/过渡效果 */
  animation: 2_000,
} as const;

export type TimeoutKey = keyof typeof TIMEOUTS;
```

**集成使用**：

```typescript
// 替代硬编码超时值
await page.goto(url, { timeout: TIMEOUTS.navigation });
await page.waitForSelector(selector, { timeout: TIMEOUTS.elementVisible });
await page.waitForURL(pattern, { timeout: TIMEOUTS.publishRedirect });
```

---

### 3.3 健康检查机制（发布前验证登录态）

```typescript
// src/core/HealthCheck.ts

export interface HealthCheckResult {
  platform: string;
  loginValid: boolean;
  cookieAge: number;       // Cookie 文件存在时长（小时）
  lastPublish?: string;    // 最近一次成功发布时间
  error?: string;
}

export class HealthChecker {
  /**
   * 发布前快速验证登录有效性
   * 通过访问用户中心 API 或检查关键 Cookie 判断
   */
  async checkPlatform(
    platform: string,
    context: BrowserContext,
  ): Promise<HealthCheckResult> {
    const page = await context.newPage();

    try {
      const checkUrl = this.getCheckUrl(platform);
      const response = await page.goto(checkUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 10_000,
      });

      // 检查是否被重定向到登录页
      const finalUrl = page.url();
      const loginValid = !this.isLoginPage(platform, finalUrl);

      // 检查 HTTP 状态码
      if (response?.status() === 401 || response?.status() === 403) {
        return {
          platform,
          loginValid: false,
          cookieAge: this.getCookieAge(platform),
          error: `HTTP ${response.status()} - 认证已过期`,
        };
      }

      return {
        platform,
        loginValid,
        cookieAge: this.getCookieAge(platform),
      };
    } catch (err) {
      return {
        platform,
        loginValid: false,
        cookieAge: this.getCookieAge(platform),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await page.close();
    }
  }

  private getCheckUrl(platform: string): string {
    const urls: Record<string, string> = {
      csdn: 'https://me.csdn.net/',
      zhihu: 'https://www.zhihu.com/creator',
      juejin: 'https://juejin.cn/creator/home',
    };
    return urls[platform] ?? '';
  }

  private isLoginPage(platform: string, url: string): boolean {
    const patterns: Record<string, RegExp> = {
      csdn: /passport\.csdn\.net/,
      zhihu: /signin|login/,
      juejin: /login/,
    };
    return patterns[platform]?.test(url) ?? false;
  }

  private getCookieAge(platform: string): number {
    const config = platformConfigs[platform];
    if (!config?.storageStatePath || !existsSync(config.storageStatePath)) return Infinity;
    const stat = statSync(config.storageStatePath);
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
  }
}
```

**发布前自动执行**：

```typescript
const checker = new HealthChecker();
const health = await checker.checkPlatform(platform, context);

if (!health.loginValid) {
  console.error(`❌ ${platform} 登录已失效，请运行 autopublish login ${platform}`);
  continue; // 跳过该平台
}
```

---

### 3.4 平台 DOM 变更自适应 — 选择器配置化

**问题**：平台前端频繁迭代，DOM 结构和 class 名随时可能变化，硬编码选择器维护成本高。

```typescript
// selectors/csdn.json
{
  "editor": {
    "titleInput": [
      "input.article-bar__title",
      "input[placeholder*='标题']",
      "#title-input"
    ],
    "contentArea": [
      ".editor__inner",
      ".CodeMirror textarea",
      "div[contenteditable='true']"
    ],
    "markdownEditor": [
      ".editor__inner",
      ".CodeMirror",
      "textarea.article-textarea__textarea"
    ]
  },
  "publish": {
    "publishButton": [
      "button.btn-publish",
      "button:has-text('发布文章')"
    ],
    "confirmButton": [
      "button.modal__btn-publish",
      "button:has-text('确认发布')",
      "button.btn-b-red"
    ],
    "tagInput": [
      "input[placeholder*='标签']",
      ".tag__input input"
    ]
  }
}
```

```typescript
// src/core/SelectorResolver.ts

export class SelectorResolver {
  private selectors: Record<string, string[]>;

  constructor(selectorConfig: Record<string, string[]>) {
    this.selectors = selectorConfig;
  }

  /**
   * 尝试多个候选选择器，返回第一个匹配的
   * 应对平台 DOM 变更，提供降级方案
   */
  async resolve(page: Page, key: string, timeout = 10_000): Promise<string> {
    const candidates = this.selectors[key];
    if (!candidates?.length) {
      throw new Error(`未配置选择器: ${key}`);
    }

    // 并行竞争：哪个选择器先出现就用哪个
    const result = await Promise.race(
      candidates.map(async (selector) => {
        try {
          await page.waitForSelector(selector, { state: 'visible', timeout });
          return selector;
        } catch {
          return null;
        }
      })
    );

    if (!result) {
      throw new Error(
        `所有候选选择器均未匹配 [${key}]:\n` +
        candidates.map(s => `  - ${s}`).join('\n') +
        '\n⚠️  平台 DOM 可能已变更，请更新 selectors 配置'
      );
    }

    return result;
  }
}
```

**收益**：DOM 变更时仅需更新 JSON 配置文件，无需修改业务代码。

---

## 4. 开发体验（DX）优化

### 4.1 dry-run 模式

```typescript
// src/core/DryRunPublisher.ts

export class DryRunPublisher extends BasePublisher {
  readonly platform = 'dry-run';

  async publish(article: ArticleData, _context: BrowserContext): Promise<PublishResult> {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 DRY-RUN 模式 — 仅解析验证，不执行实际发布');
    console.log('='.repeat(60));

    console.log('\n📄 文章信息:');
    console.log(`   标题: ${article.title}`);
    console.log(`   标签: ${article.tags.join(', ') || '(无)'}`);
    console.log(`   摘要: ${article.summary.slice(0, 100)}...`);
    console.log(`   封面: ${article.cover || '(无)'}`);
    console.log(`   分类: ${article.category || '(无)'}`);
    console.log(`   正文长度: ${article.content.length} 字符`);
    console.log(`   源文件: ${article.sourcePath}`);

    // 验证封面文件是否存在
    if (article.cover && !existsSync(article.cover)) {
      console.warn(`\n⚠️  封面文件不存在: ${article.cover}`);
    }

    // 验证正文不为空
    if (!article.content.trim()) {
      console.error('\n❌ 正文内容为空！');
      return this.buildErrorResult('正文为空');
    }

    // 验证标题长度
    if (article.title.length > 100) {
      console.warn(`\n⚠️  标题过长 (${article.title.length} 字符)，部分平台可能截断`);
    }

    console.log('\n✅ 验证通过，文章可以正常发布');
    return this.buildSuccessResult('dry-run://validated');
  }
}
```

**使用**：

```bash
autopublish publish -f posts/article.md -p csdn --dry-run
```

---

### 4.2 本地调试模式

```typescript
// src/core/DebugMode.ts

export interface DebugOptions {
  headed: boolean;      // 显示浏览器窗口
  slowMo: number;       // 操作间延迟（ms）
  devtools: boolean;    // 自动打开 DevTools
  pauseOnError: boolean; // 出错时暂停（不关闭浏览器）
}

const DEBUG_DEFAULTS: DebugOptions = {
  headed: true,
  slowMo: 500,
  devtools: true,
  pauseOnError: true,
};

export function getDebugLaunchOptions(debug: boolean | Partial<DebugOptions> = false) {
  if (!debug) return {};

  const opts = typeof debug === 'object'
    ? { ...DEBUG_DEFAULTS, ...debug }
    : DEBUG_DEFAULTS;

  return {
    headless: !opts.headed,
    slowMo: opts.slowMo,
    devtools: opts.devtools,
    // 出错时暂停的实现
    ...(opts.pauseOnError && {
      // 在 catch 块中添加 await page.pause() 而非直接关闭
    }),
  };
}
```

**使用**：

```bash
# 完整调试模式
autopublish publish -f article.md -p csdn --debug

# 自定义调试参数
autopublish publish -f article.md -p csdn --debug --slow-mo 1000
```

**配合 `page.pause()` 实现断点调试**：

```typescript
// 在关键步骤前添加可选断点
if (isDebugMode) {
  console.log('[DEBUG] 即将执行发布，按任意键继续...');
  await page.pause(); // 打开 Playwright Inspector
}
await this.clickPublish(page);
```

---

### 4.3 配置校验（zod schema）

```typescript
// src/core/ConfigValidator.ts
import { z } from 'zod';

const PlatformConfigSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  editorUrl: z.string().url(),
  loginUrl: z.string().url(),
  storageStatePath: z.string().min(1),
  enabled: z.boolean(),
});

const BrowserConfigSchema = z.object({
  headless: z.boolean(),
  launchTimeout: z.number().positive().max(120_000),
  defaultTimeout: z.number().positive().max(60_000),
  viewport: z.object({
    width: z.number().int().min(800).max(3840),
    height: z.number().int().min(600).max(2160),
  }),
  proxy: z.object({
    server: z.string().url(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  userAgent: z.string().optional(),
});

const AppConfigSchema = z.object({
  browser: BrowserConfigSchema,
  platforms: z.record(z.string(), PlatformConfigSchema),
  publishHistoryPath: z.string().min(1),
  postsDir: z.string().min(1),
  traceDir: z.string().min(1),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * 启动时校验配置，提前发现错误
 */
export function validateConfig(config: unknown): AppConfig {
  const result = AppConfigSchema.safeParse(config);

  if (!result.success) {
    console.error('❌ 配置校验失败:');
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
```

---

### 4.4 单元测试策略

```typescript
// tests/core/MarkdownParser.test.ts
import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../../src/core/MarkdownParser.js';

describe('MarkdownParser', () => {
  const parser = new MarkdownParser();

  it('should parse front-matter correctly', () => {
    const result = parser.parseArticle('tests/fixtures/sample.md');
    expect(result.title).toBe('测试文章');
    expect(result.tags).toEqual(['tag1', 'tag2']);
    expect(result.summary).toBeTruthy();
  });

  it('should fallback to h1 title', () => {
    const result = parser.parseArticle('tests/fixtures/no-frontmatter-title.md');
    expect(result.title).toMatch(/^#/); // 从正文提取
  });

  it('should resolve relative cover path', () => {
    const result = parser.parseArticle('tests/fixtures/with-cover/index.md');
    expect(result.cover).toMatch(/^\/.*cover\.png$/);
  });
});

// tests/platforms/CsdnPublisher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsdnPublisher } from '../../src/platforms/CsdnPublisher.js';

describe('CsdnPublisher', () => {
  let publisher: CsdnPublisher;
  let mockContext: any;
  let mockPage: any;

  beforeEach(() => {
    publisher = new CsdnPublisher();

    // Mock Playwright Page
    mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      click: vi.fn().mockResolvedValue(null),
      fill: vi.fn().mockResolvedValue(null),
      type: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockResolvedValue(null),
      waitForURL: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue('https://blog.csdn.net/xxx/article/details/123'),
      close: vi.fn().mockResolvedValue(null),
      keyboard: { press: vi.fn().mockResolvedValue(null) },
      mouse: { wheel: vi.fn().mockResolvedValue(null) },
      evaluate: vi.fn().mockResolvedValue(null),
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          waitFor: vi.fn().mockResolvedValue(null),
          isVisible: vi.fn().mockResolvedValue(true),
          click: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(1),
          setInputFiles: vi.fn().mockResolvedValue(null),
        }),
      }),
    };

    // Mock BrowserContext
    mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      tracing: {
        start: vi.fn().mockResolvedValue(null),
        stop: vi.fn().mockResolvedValue(null),
      },
    };
  });

  it('should navigate to CSDN editor', async () => {
    const article = {
      title: 'Test',
      tags: [],
      summary: 'Test summary',
      cover: '',
      content: '# Hello',
      sourcePath: '/tmp/test.md',
    };

    await publisher.publish(article, mockContext);
    expect(mockPage.goto).toHaveBeenCalledWith(
      expect.stringContaining('editor.csdn.net'),
      expect.any(Object),
    );
  });
});
```

**测试分层策略**：

| 层级 | 测试类型 | Mock 范围 | 运行频率 |
|------|----------|-----------|----------|
| Unit | MarkdownParser、ConfigValidator | 文件系统 | 每次提交 |
| Integration | Publisher 交互流程 | Playwright API | PR 合并 |
| E2E | 完整发布流程（测试账号） | 无 Mock | 每日/手动 |

---

## 5. 未来扩展性

### 5.1 掘金（juejin.cn）适配预留

**分析**：掘金编辑器基于 bytemd（字节跳动开源 Markdown 编辑器），支持原生 Markdown 输入。

```typescript
// src/platforms/JuejinPublisher.ts (骨架)

export class JuejinPublisher extends BasePublisher {
  readonly platform = 'juejin';

  async publish(article: ArticleData, context: BrowserContext): Promise<PublishResult> {
    const page = await context.newPage();

    try {
      // 1. 导航到编辑器
      await page.goto('https://juejin.cn/editor/drafts/new', { waitUntil: 'networkidle' });

      // 2. 输入标题
      await this.humanType(page, 'input[placeholder*="标题"]', article.title);

      // 3. 注入 Markdown 正文（bytemd 编辑器）
      //    掘金使用 CodeMirror 6，可通过 .cm-content 注入
      await page.click('.bytemd-editor .cm-content');
      await this.pasteText(page, '.bytemd-editor .cm-content', article.content);

      // 4. 点击"发布"按钮打开设置面板
      await this.safeClick(page, 'button:has-text("发布")');

      // 5. 设置分类（下拉选择）
      await this.setCategory(page, article.category);

      // 6. 设置标签
      await this.setTags(page, article.tags);

      // 7. 设置封面
      if (article.cover) {
        await this.uploadCover(page, article.cover);
      }

      // 8. 设置摘要
      await this.setSummary(page, article.summary);

      // 9. 确认发布
      await this.safeClick(page, 'button:has-text("确定并发布")');

      // 10. 等待发布完成
      await page.waitForURL(/juejin\.cn\/post\//, { timeout: 30_000 });

      return this.buildSuccessResult(page.url());
    } catch (error) {
      return this.buildErrorResult(error instanceof Error ? error.message : String(error));
    } finally {
      await page.close();
    }
  }

  private async setCategory(page: Page, category?: string): Promise<void> {
    // 掘金分类为固定列表，通过文本匹配选择
    if (!category) return;
    const categoryItem = page.locator(`.category-list .item:has-text("${category}")`);
    if (await categoryItem.isVisible()) {
      await categoryItem.click();
    }
  }

  private async setTags(page: Page, tags: string[]): Promise<void> {
    // 掘金标签搜索 + 选择，类似 CSDN
    for (const tag of tags.slice(0, 3)) { // 掘金限制 1-3 个标签
      await page.fill('.tag-input input', tag);
      await this.waitRandom(500, 800);
      await page.click('.suggestion-item:first-child');
    }
  }
}
```

---

### 5.2 今日头条 / 微信公众号适配分析

#### 今日头条（头条号）

| 项目 | 分析 |
|------|------|
| 编辑器 URL | `https://mp.toutiao.com/profile_v4/graphic/publish` |
| 编辑器类型 | 富文本编辑器（非 Markdown） |
| 核心挑战 | 需要将 Markdown 转为 HTML 后粘贴；图片需单独上传获取平台 URL |
| 内容注入 | `contenteditable` div + `execCommand('insertHTML')` |
| 反检测等级 | 中等（字节系安全检测较严） |

#### 微信公众号

| 项目 | 分析 |
|------|------|
| 编辑器 URL | `https://mp.weixin.qq.com/cgi-bin/appmsg` |
| 编辑器类型 | 自研富文本编辑器 |
| 核心挑战 | 登录依赖微信扫码（难以自动化）；富文本格式复杂 |
| 推荐方案 | 使用微信公众平台 API（非浏览器自动化） |
| 替代思路 | 集成 `wechaty` 或调用草稿箱 API |

```typescript
// 微信公众号建议使用 API 方式而非浏览器自动化
// src/platforms/WechatPublisher.ts (API 模式骨架)

export class WechatPublisher extends BasePublisher {
  readonly platform = 'wechat';

  async publish(article: ArticleData, _context: BrowserContext): Promise<PublishResult> {
    // 1. 获取 access_token（需预先配置 appid/secret）
    const token = await this.getAccessToken();

    // 2. 上传文章中的图片，获取 media_id
    const mediaIds = await this.uploadImages(article.content, token);

    // 3. Markdown → HTML（适配微信格式）
    const html = this.markdownToWechatHtml(article.content, mediaIds);

    // 4. 创建草稿
    const draftUrl = await this.createDraft(token, {
      title: article.title,
      content: html,
      thumb_media_id: mediaIds.cover,
      digest: article.summary,
    });

    // 5. 可选：自动群发（需谨慎）
    // await this.publishDraft(token, draftUrl);

    return this.buildSuccessResult(draftUrl);
  }
}
```

---

### 5.3 多账号矩阵支持

```typescript
// config.ts 扩展支持多账号
export interface AccountConfig {
  id: string;
  alias: string;           // 账号别名（如 "主号"、"备用号"）
  storageStatePath: string;
  proxy?: ProxyConfig;     // 每个账号可配不同代理
  enabled: boolean;
}

export const platformConfigs: Record<string, {
  // ... 原有字段
  accounts: AccountConfig[];
}> = {
  csdn: {
    name: 'csdn',
    editorUrl: '...',
    accounts: [
      {
        id: 'csdn-main',
        alias: '主号',
        storageStatePath: 'storage/auth/csdn-main.json',
        enabled: true,
      },
      {
        id: 'csdn-backup',
        alias: '备用号',
        storageStatePath: 'storage/auth/csdn-backup.json',
        proxy: { server: 'http://proxy-2:7890' },
        enabled: true,
      },
    ],
  },
};
```

**CLI 支持**：

```bash
# 指定账号发布
autopublish publish -f article.md -p csdn --account csdn-main

# 矩阵发布（所有启用的账号）
autopublish publish -f article.md -p csdn --all-accounts

# 查看所有账号状态
autopublish status --accounts
```

**注意事项**：
- 不同账号必须使用不同代理 IP，避免关联
- 发布间隔建议 > 10 分钟
- 内容需做差异化处理（标题/开头微调）

---

### 5.4 定时发布（cron / node-schedule）

```typescript
// src/scheduler/PublishScheduler.ts
import { CronJob } from 'cron';
import { readFileSync } from 'node:fs';

interface ScheduleItem {
  file: string;
  platforms: string[];
  publishAt: string;   // cron 表达式 或 ISO 时间
  status: 'pending' | 'completed' | 'failed';
}

export class PublishScheduler {
  private jobs: CronJob[] = [];

  /**
   * 从配置文件加载发布计划
   */
  loadSchedule(schedulePath: string): ScheduleItem[] {
    const raw = readFileSync(schedulePath, 'utf-8');
    return JSON.parse(raw);
  }

  /**
   * 注册定时任务
   */
  schedule(item: ScheduleItem, publishFn: () => Promise<void>): void {
    const job = new CronJob(
      item.publishAt,
      async () => {
        console.log(`⏰ 定时任务触发: ${item.file} → ${item.platforms.join(',')}`);
        try {
          await publishFn();
          item.status = 'completed';
        } catch (err) {
          item.status = 'failed';
          console.error('定时发布失败:', err);
        }
      },
      null,   // onComplete
      true,   // start
      'Asia/Shanghai',
    );

    this.jobs.push(job);
  }

  /**
   * 停止所有定时任务
   */
  stopAll(): void {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
  }
}
```

**发布计划配置** (`schedule.json`):

```json
[
  {
    "file": "posts/article-1/index.md",
    "platforms": ["csdn"],
    "publishAt": "2026-06-04T09:00:00+08:00",
    "status": "pending"
  },
  {
    "file": "posts/article-1/index.md",
    "platforms": ["zhihu"],
    "publishAt": "2026-06-04T10:30:00+08:00",
    "status": "pending"
  },
  {
    "file": "posts/article-2/index.md",
    "platforms": ["csdn", "zhihu"],
    "publishAt": "0 9 * * 1-5",
    "status": "pending"
  }
]
```

**使用**：

```bash
# 启动调度器（常驻进程）
autopublish schedule start

# 查看待发布队列
autopublish schedule list

# 添加定时任务
autopublish schedule add -f article.md -p csdn --at "2026-06-04T09:00:00"
```

---

### 5.5 发布队列与并发控制

```typescript
// src/core/PublishQueue.ts

interface QueueItem {
  id: string;
  article: ArticleData;
  platform: string;
  priority: number;      // 优先级（越小越优先）
  retryCount: number;
  addedAt: string;
}

export class PublishQueue {
  private queue: QueueItem[] = [];
  private concurrency: number;
  private running = 0;
  private platformCooldowns: Map<string, number> = new Map();

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  /**
   * 添加发布任务到队列
   */
  enqueue(article: ArticleData, platform: string, priority = 0): string {
    const id = `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.queue.push({
      id,
      article,
      platform,
      priority,
      retryCount: 0,
      addedAt: new Date().toISOString(),
    });
    this.queue.sort((a, b) => a.priority - b.priority);
    return id;
  }

  /**
   * 处理队列 — 尊重并发限制和平台冷却时间
   */
  async process(publishFn: (item: QueueItem) => Promise<void>): Promise<void> {
    while (this.queue.length > 0) {
      if (this.running >= this.concurrency) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const item = this.getNextAvailable();
      if (!item) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      this.running++;
      publishFn(item)
        .then(() => {
          // 设置平台冷却时间（避免同平台连续请求）
          this.platformCooldowns.set(item.platform, Date.now() + 60_000);
        })
        .catch((err) => {
          console.error(`[Queue] 任务 ${item.id} 失败:`, err);
          if (item.retryCount < 3) {
            item.retryCount++;
            item.priority += 10; // 降低优先级
            this.queue.push(item);
          }
        })
        .finally(() => {
          this.running--;
        });
    }
  }

  /**
   * 获取下一个可执行的任务（尊重冷却时间）
   */
  private getNextAvailable(): QueueItem | null {
    const now = Date.now();
    const idx = this.queue.findIndex(item => {
      const cooldown = this.platformCooldowns.get(item.platform) ?? 0;
      return now >= cooldown;
    });

    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0];
  }
}
```

**并发控制策略**：

| 策略 | 配置值 | 说明 |
|------|--------|------|
| 全局并发 | 1-2 | 默认串行，避免资源竞争 |
| 平台冷却 | 60s | 同平台两次发布间最小间隔 |
| 失败重试 | 3 次 | 失败后降低优先级重新入队 |
| 优先级 | 0-100 | 数字越小优先级越高 |

---

## 总结：优先级建议

| 优先级 | 建议项 | 收益 | 复杂度 |
|--------|--------|------|--------|
| 🔴 P0 | 指数退避重试 | 大幅提升稳定性 | 低 |
| 🔴 P0 | 超时分级 | 减少误超时/长等待 | 低 |
| 🔴 P0 | 健康检查 | 提前发现登录失效 | 低 |
| 🟠 P1 | CLI 工具化 | 用户体验质变 | 中 |
| 🟠 P1 | dry-run 模式 | 验证流程正确性 | 低 |
| 🟠 P1 | 选择器配置化 | 降低 DOM 变更维护成本 | 中 |
| 🟠 P1 | 配置校验 (zod) | 启动时提前报错 | 低 |
| 🟡 P2 | Canvas/WebGL 指纹 | 增强反检测能力 | 中 |
| 🟡 P2 | 贝塞尔鼠标轨迹 | 对抗高级风控 | 中 |
| 🟡 P2 | Cookie 自动刷新 | 减少手动登录频率 | 低 |
| 🟡 P2 | 事件总线 | 架构解耦，利于扩展 | 中 |
| 🟢 P3 | 掘金适配 | 扩展平台覆盖 | 中 |
| 🟢 P3 | 定时发布 | 内容运营自动化 | 中 |
| 🟢 P3 | 多账号矩阵 | 矩阵运营 | 高 |
| 🟢 P3 | 插件化加载 | 极致可扩展性 | 中 |
| ⚪ P4 | 微信公众号 | 需 API 模式，独立方案 | 高 |
| ⚪ P4 | 发布队列并发 | 大规模场景需要 | 高 |
