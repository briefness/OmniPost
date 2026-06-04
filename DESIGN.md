# Playwright Publisher — 自动化多平台文章发布系统设计文档

> **版本**: v1.0.0  
> **最后更新**: 2026-06-03  
> **技术栈**: Playwright + TypeScript + pnpm + ESM + gray-matter

---

## 1. 项目定位

**Playwright Publisher** 是一款基于浏览器自动化的多平台文章发布工具，旨在将本地 Markdown 文章一键同步发布至 CSDN、知乎等内容平台，解决技术博主多平台维护的效率痛点。

### 1.1 核心价值

| 维度 | 说明 |
|------|------|
| 一键多发 | 单次执行即可将文章同步至多个平台 |
| 会话保持 | Cookie 持久化，避免重复登录 |
| 反风控 | 模拟真实用户行为，降低自动化检测风险 |
| 可追溯 | Trace 固化 + 发布历史记录，问题可复现 |
| 易扩展 | 平台适配层与核心层分离，新增平台仅需实现接口 |

### 1.2 技术栈选型

| 技术 | 选型理由 |
|------|----------|
| **Playwright** | 微软出品，跨浏览器支持，原生 TypeScript 类型，内建 Trace Viewer、storageState 等调试/会话工具 |
| **TypeScript** | 静态类型约束，IDE 智能补全，重构安全性高 |
| **pnpm** | 高效磁盘利用，严格的依赖隔离（phantom dependencies 防护） |
| **ESM (ES Modules)** | Node.js 现代模块系统，Tree-shaking 友好，`import.meta.url` 支持 |
| **gray-matter** | 业界标准 front-matter 解析库，支持 YAML/TOML/JSON |
| **tsx** | 开发阶段零配置运行 TypeScript，支持 watch 模式热重载 |

---

## 2. 系统核心架构

系统采用 **核心调度层 + 平台适配层** 分离架构，遵循开放封闭原则（OCP）：

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Entry (index.ts)                       │
│          解析参数 → 调度流程 → 结果汇总 → 历史持久化              │
└───────────────────────────────┬───────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│ MarkdownParser  │  │ BrowserManager  │  │   BasePublisher     │
│ (内容解析)       │  │ (浏览器生命周期) │  │   (发布抽象基类)     │
└─────────────────┘  └─────────────────┘  └──────────┬──────────┘
                                                      │
                              ┌────────────────────────┼────────────────┐
                              │                        │                │
                              ▼                        ▼                ▼
                    ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐
                    │  CsdnPublisher   │  │  ZhihuPublisher  │  │  (未来...)  │
                    │  (CSDN 适配器)    │  │  (知乎适配器)     │  │            │
                    └──────────────────┘  └──────────────────┘  └────────────┘
```

**分层职责**：

| 层级 | 模块 | 职责 |
|------|------|------|
| 入口层 | `src/index.ts` | CLI 参数解析、流程编排、结果汇总、历史记录写入 |
| 核心层 | `src/core/*` | 通用能力封装：Markdown 解析、浏览器管理、反检测基础设施 |
| 适配层 | `src/platforms/*` | 平台特化逻辑：DOM 选择器、交互流程、发布确认 |
| 类型层 | `src/types/*` | 全局 TypeScript 接口/类型定义 |
| 配置层 | `config.ts` | 全局配置（浏览器参数、平台信息、路径常量） |

---

## 3. 完整目录结构

```
autoPublish/
├── config.ts                    # 全局配置（浏览器/平台/路径）
├── package.json                 # 项目元信息 & 脚本
├── tsconfig.json                # TypeScript 编译配置
├── posts/                       # 待发布 Markdown 文章目录
│   └── hello-world/
│       ├── index.md             # 文章正文（含 front-matter）
│       └── cover.png            # 封面图片
├── src/
│   ├── index.ts                 # 主入口：CLI 解析 + 流程编排
│   ├── core/
│   │   ├── MarkdownParser.ts    # Markdown 解析器（gray-matter）
│   │   ├── BrowserManager.ts    # 浏览器生命周期管理
│   │   └── BasePublisher.ts     # 发布器抽象基类
│   ├── platforms/
│   │   ├── CsdnPublisher.ts     # CSDN 平台适配器
│   │   └── ZhihuPublisher.ts    # 知乎平台适配器
│   └── types/
│       └── index.ts             # 全局类型定义
├── storage/
│   ├── auth/                    # 平台认证状态持久化
│   │   ├── csdn.json            # CSDN storageState
│   │   └── zhihu.json           # 知乎 storageState
│   └── logs/
│       ├── publish_history.json # 发布历史记录
│       └── traces/              # Playwright Trace 文件
└── dist/                        # TypeScript 编译输出
```

---

## 4. 核心模块详细设计

### 4.1 MarkdownParser.ts — 文章内容解析器

**职责**: 使用 `gray-matter` 解析 Markdown 文件的 front-matter 元数据，提取标题、标签、摘要、封面路径，正文保留原始 Markdown 格式。

**设计要点**:
- front-matter 采用 YAML 格式，字段优先级高于正文推断
- 标题回退策略：`front-matter.title` > 正文第一个 `# 标题`
- 标签兼容数组和逗号分隔字符串两种格式
- 封面图路径自动解析为绝对路径（相对于 .md 文件目录）

**核心代码**:

```typescript
import matter from 'gray-matter';
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import type { ArticleData } from '../types/index.js';

export class MarkdownParser {
  /**
   * 解析 Markdown 文件，提取 front-matter 和正文内容
   */
  parseArticle(mdFilePath: string): ArticleData {
    const absolutePath = isAbsolute(mdFilePath)
      ? mdFilePath
      : resolve(process.cwd(), mdFilePath);

    const fileContent = readFileSync(absolutePath, 'utf-8');

    // gray-matter 解析 front-matter
    const { data: frontMatter, content } = matter(fileContent);

    const title = this.extractTitle(frontMatter, content);
    const tags = this.extractTags(frontMatter);
    const summary = this.extractSummary(frontMatter, content);
    const cover = this.resolveCoverPath(frontMatter, absolutePath);

    return {
      title,
      tags,
      summary,
      cover,
      content: content.trim(), // 保留原始 Markdown
      category: frontMatter.category ?? frontMatter.categories?.[0] ?? '',
      sourcePath: absolutePath,
    };
  }

  /** 标签提取：兼容数组 & 逗号字符串 */
  private extractTags(frontMatter: Record<string, unknown>): string[] {
    const rawTags = frontMatter.tags ?? frontMatter.keywords ?? [];
    if (Array.isArray(rawTags)) return rawTags.map(String);
    if (typeof rawTags === 'string') {
      return rawTags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
  }

  /** 封面路径解析为绝对路径 */
  private resolveCoverPath(
    frontMatter: Record<string, unknown>,
    mdAbsolutePath: string,
  ): string {
    const coverRaw = frontMatter.cover ?? frontMatter.image ?? '';
    if (!coverRaw || typeof coverRaw !== 'string') return '';
    if (isAbsolute(coverRaw) || coverRaw.startsWith('http')) return coverRaw;
    return resolve(dirname(mdAbsolutePath), coverRaw);
  }
}
```

**支持的 front-matter 格式**:

```yaml
---
title: "Playwright 自动化发布实战"
tags: [Playwright, TypeScript, 自动化]
summary: "基于 Playwright 实现多平台文章自动发布的完整方案"
cover: ./cover.png
category: 前端工程化
---
```

---

### 4.2 BrowserManager.ts — 浏览器生命周期管理

**职责**: 管理 Playwright Chromium 实例的启动/销毁、BrowserContext 创建、指纹抹除、Cookie 会话保持。

**核心特性**:

| 特性 | 实现方式 |
|------|----------|
| 指纹抹除 | `--disable-blink-features=AutomationControlled` + `addInitScript` |
| 会话保持 | `storageState` 持久化/恢复 |
| 登录失效告警 | 检测重定向至登录页时抛出错误 |
| 代理预留 | 配置化 `proxy.server` 注入 |
| 多平台隔离 | 每个平台独立 BrowserContext，Cookie 互不干扰 |

**核心代码**:

```typescript
import { chromium, type Browser, type BrowserContext } from 'playwright';

export class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();

  /**
   * 启动浏览器 — 注入反自动化检测参数
   */
  async launchBrowser(): Promise<Browser> {
    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-infobars',
        '--window-size=1440,900',
        '--disable-dev-shm-usage',
        '--excludeSwitches=enable-automation',
      ],
    });
    return this.browser;
  }

  /**
   * 创建平台专属 Context — 加载已保存认证 + 注入反检测脚本
   */
  async createContext(platform: string): Promise<BrowserContext> {
    const contextOptions = {
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      permissions: ['clipboard-read', 'clipboard-write'],
      // 如果存在已保存的 storageState，自动加载
      ...(existsSync(storageStatePath) && { storageState: storageStatePath }),
    };

    const context = await this.browser!.newContext(contextOptions);

    // 关键：注入脚本抹除 webdriver 指纹
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      });
      (window as any).chrome = { runtime: {} };
    });

    this.contexts.set(platform, context);
    return context;
  }

  /**
   * 保存认证状态 — 发布成功后持久化 Cookie
   */
  async saveState(platform: string, context: BrowserContext): Promise<void> {
    await context.storageState({ path: storageStatePath });
  }
}
```

**指纹抹除策略详解**:

```
┌────────────────────────────────────────────────────────────────┐
│                    Anti-Detection Layers                         │
├────────────────────────────────────────────────────────────────┤
│  Layer 1: Launch Args                                           │
│    └─ --disable-blink-features=AutomationControlled            │
│    └─ --excludeSwitches=enable-automation                       │
├────────────────────────────────────────────────────────────────┤
│  Layer 2: addInitScript (每个新页面自动执行)                      │
│    └─ navigator.webdriver = undefined                           │
│    └─ navigator.plugins = [伪造插件列表]                         │
│    └─ navigator.languages = ['zh-CN', 'zh', 'en']             │
│    └─ window.chrome = { runtime: {} }                          │
├────────────────────────────────────────────────────────────────┤
│  Layer 3: Context Configuration                                 │
│    └─ locale: 'zh-CN'                                          │
│    └─ timezoneId: 'Asia/Shanghai'                              │
│    └─ viewport: 1440x900 (常见分辨率)                           │
└────────────────────────────────────────────────────────────────┘
```

---

### 4.3 BasePublisher.ts — 发布器抽象基类

**职责**: 定义平台发布器的统一接口（`publish`），封装通用反检测工具方法：仿人输入、随机滚动、随机等待。

**设计模式**: Template Method（模板方法） — 子类仅需实现 `publish`，即可复用基类所有反检测能力。

**核心代码**:

```typescript
import type { Page, BrowserContext } from 'playwright';
import type { ArticleData, PublishResult } from '../types/index.js';

export abstract class BasePublisher {
  abstract readonly platform: string;

  /** 子类必须实现的发布方法 */
  abstract publish(article: ArticleData, context: BrowserContext): Promise<PublishResult>;

  /**
   * 仿人输入 — Box-Muller 正态分布延迟
   * 均值 100ms，标准差 30ms，范围 [30ms, 250ms]
   */
  protected async humanType(page: Page, selector: string, text: string): Promise<void> {
    await page.click(selector);
    await page.fill(selector, '');
    await this.waitRandom(100, 300);

    for (const char of text) {
      await page.type(selector, char, {
        delay: this.getTypeDelay(), // 正态分布随机延迟
      });
    }
  }

  /**
   * 模拟随机滚动 — 方向/距离/次数均随机化
   */
  protected async randomScroll(page: Page): Promise<void> {
    const scrollCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < scrollCount; i++) {
      const distance = Math.floor(Math.random() * 300) + 100;
      const direction = Math.random() > 0.3 ? 1 : -1;
      await page.mouse.wheel(0, distance * direction);
      await this.waitRandom(300, 800);
    }
  }

  /**
   * 随机等待 — 模拟人类思考/阅读停顿
   */
  protected async waitRandom(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 剪贴板粘贴 — 适合大段内容注入
   */
  protected async pasteText(page: Page, selector: string, text: string): Promise<void> {
    await page.click(selector);
    await page.evaluate(async (content) => {
      await navigator.clipboard.writeText(content);
    }, text);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyV`);
  }

  /**
   * 安全点击 — 等待元素可见后再操作
   */
  protected async safeClick(page: Page, selector: string): Promise<void> {
    await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
    await this.waitRandom(200, 500);
    await page.click(selector);
  }

  /** Box-Muller 正态分布打字延迟 */
  private getTypeDelay(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(30, Math.min(250, Math.round(100 + normal * 30)));
  }
}
```

---

## 5. 平台适配策略

### 5.1 CSDN 适配器 (`CsdnPublisher.ts`)

**目标页面**: `https://editor.csdn.net/md/`（CSDN 创作中心 Markdown 编辑器）

**发布流程**:

```
导航到编辑器 → 确认 Markdown 模式 → 输入标题 → 粘贴正文
    → 打开发布面板 → 设置标签（联想下拉） → 设置分类
    → 设置文章类型（原创） → 上传封面 → 确认发布 → 等待跳转获取 URL
```

**关键技术点**:

| 环节 | 实现策略 |
|------|----------|
| 编辑器识别 | 检测 `.editor__inner` / `.CodeMirror` 确认 Markdown 模式 |
| 标题输入 | `humanType` 仿人逐字输入 |
| 正文注入 | `Ctrl+A` 全选清空 → `navigator.clipboard.writeText` + `Ctrl+V` 粘贴 |
| 标签选择 | 输入关键词 → 等待 `.tag__suggest-item` 联想下拉 → 选择/回车确认 |
| 分类/类型 | 多级下拉选择，通过 `text=` 定位对应选项 |
| 发布确认 | 两步按钮：打开面板 → 确认发布（`.modal__btn-publish`） |
| 完成检测 | `waitForURL(/blog\.csdn\.net|article\/details/)` 等待页面跳转 |

**核心代码片段 — 标签设置**:

```typescript
private async setTags(page: Page, tags: string[]): Promise<void> {
  const tagInputSelector = 'input[placeholder*="标签"], .tag__input input';

  for (const tag of tags.slice(0, 5)) { // CSDN 最多 5 个标签
    await page.click(tagInputSelector);
    await page.fill(tagInputSelector, tag);
    await this.waitRandom(500, 800);

    // 等待联想下拉
    const suggestionSelector = '.tag__suggest-item, .el-autocomplete-suggestion li';
    try {
      await page.waitForSelector(suggestionSelector, { timeout: 3000 });
      await page.click(`${suggestionSelector}:first-child`);
    } catch {
      await page.keyboard.press('Enter'); // 无联想时直接回车
    }
  }
}
```

### 5.2 知乎适配器 (`ZhihuPublisher.ts`)

**目标页面**: `https://zhuanlan.zhihu.com/write`（知乎专栏创作中心）

**发布流程**:

```
导航到写作页 → 检查登录状态 → fileChooser 导入 .md 文件
    → 确认/修正标题 → 添加话题标签（等待联想下拉） → 上传封面
    → 点击发布 → 处理确认弹窗 → 等待跳转获取 URL
```

**关键技术点**:

| 环节 | 实现策略 |
|------|----------|
| 登录检测 | 检查 URL 是否包含 `signin/login`，检测创作中心标志性元素 |
| 文件导入 | `page.waitForEvent('filechooser')` + `fileChooser.setFiles(mdPath)` |
| 回退方案 | 导入不可用时切换到 contenteditable 粘贴模式 |
| 话题添加 | 逐字输入触发联想 → `waitForSelector` 等待下拉 → 选择第一项 |
| 封面上传 | fileChooser 上传 + 处理裁剪确认弹窗 |
| 发布确认 | 处理可能弹出的二次确认对话框 |

**核心代码片段 — Markdown 文件导入**:

```typescript
private async importMarkdownFile(page: Page, mdFilePath: string): Promise<void> {
  try {
    const importBtnSelector = 'button:has-text("导入文章"), .MenuItem:has-text("导入")';

    // 监听文件选择器事件
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.click(importBtnSelector),
    ]);

    // 通过 fileChooser API 上传 .md 文件
    await fileChooser.setFiles(mdFilePath);
    await this.waitRandom(1000, 2000);
  } catch {
    // 回退到手动粘贴
    await this.fallbackPasteContent(page, mdFilePath);
  }
}
```

**话题标签联想等待**:

```typescript
private async addTopicTags(page: Page, tags: string[]): Promise<void> {
  for (const tag of tags.slice(0, 5)) {
    // 逐字输入以触发联想
    for (const char of tag) {
      await topicInput.type(char, { delay: randomDelay(80, 150) });
    }

    // 关键：必须等待联想下拉出现
    const suggestionSelector = '.TopicSelector-item, .Autocomplete-item';
    await page.waitForSelector(suggestionSelector, { timeout: 3000 });
    await this.waitRandom(300, 600);
    await page.click(`${suggestionSelector}:first-child`);
  }
}
```

---

## 6. 反风控对抗机制

### 6.1 非匀速输入 (`humanType`)

采用 **Box-Muller 正态分布** 生成打字间隔，相比简单随机数更贴近真实人类输入节奏：

```typescript
private getTypeDelay(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  // 均值 100ms，标准差 30ms，限制在 [30ms, 250ms]
  return Math.max(30, Math.min(250, Math.round(100 + normal * 30)));
}
```

**延迟分布特征**：
- 68% 的字符间隔落在 70-130ms（正常打字速度）
- 14% 的字符偏快（<70ms，连续击键）
- 14% 的字符偏慢（>130ms，思考停顿）
- 极少数超过 200ms（罕见长停顿，增加真实感）

### 6.2 视口滑动模拟 (`randomScroll`)

```typescript
protected async randomScroll(page: Page): Promise<void> {
  const scrollCount = Math.floor(Math.random() * 3) + 1; // 1-3 次滚动
  for (let i = 0; i < scrollCount; i++) {
    const distance = Math.floor(Math.random() * 300) + 100;  // 100-400px
    const direction = Math.random() > 0.3 ? 1 : -1;          // 70% 向下
    await page.mouse.wheel(0, distance * direction);
    await this.waitRandom(300, 800); // 滚动间停顿
  }
}
```

### 6.3 IP 代理预留

配置层已预留代理接口，支持 HTTP/SOCKS5 代理：

```typescript
// config.ts
export const browserConfig: BrowserConfig = {
  // ...
  // proxy: {
  //   server: 'http://127.0.0.1:7890',
  //   username: 'user',
  //   password: 'pass',
  // },
};
```

---

## 7. 异常容错设计

### 7.1 Trace 固化

每次发布均开启 Playwright Tracing，无论成功或失败都会保存 `.zip` trace 文件：

```typescript
// 发布开始时
await context.tracing.start({ screenshots: true, snapshots: true });

// 发布结束时（无论成功/失败）
await context.tracing.stop({ path: tracePath });
// 产出：storage/logs/traces/csdn-1717401234567.zip
```

**查看方式**：
```bash
npx playwright show-trace storage/logs/traces/csdn-1717401234567.zip
```

Trace 包含：DOM 快照、网络请求、控制台日志、操作截图，可完整复现问题场景。

### 7.2 发布去重

基于 `publish_history.json` 记录发布历史，防止重复发布：

```typescript
// storage/logs/publish_history.json
{
  "records": [
    {
      "title": "Playwright 自动化实战",
      "sourcePath": "/absolute/path/to/article.md",
      "results": [
        {
          "success": true,
          "platform": "csdn",
          "url": "https://blog.csdn.net/xxx/article/details/12345",
          "publishedAt": "2026-06-03T10:30:00.000Z"
        }
      ],
      "createdAt": "2026-06-03T10:30:00.000Z"
    }
  ]
}
```

**去重策略**：通过文件路径 + 平台 + 标题组合判断是否已发布过。

### 7.3 错误恢复

```typescript
// 平台间容错隔离 — 单平台失败不影响其他平台
for (const platform of cliArgs.platforms) {
  const publisher = createPublisher(platform);
  const result = await publisher.publish(article, context);
  results.push(result); // 收集所有结果，统一汇报

  // 平台间随机等待 3-5 秒
  await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
}

// 全局异常兜底
main().catch((err) => {
  console.error('💥 发生未处理的错误:', err);
  browserManager.close().finally(() => process.exit(1));
});
```

---

## 8. 可观测性方案

### 8.1 结构化日志

每个模块使用 `[模块名]` 前缀输出日志，便于过滤和追踪：

```
🚀 Playwright Publisher 启动中...
📄 解析文章: /path/to/article.md
   标题: Playwright 自动化实战
   标签: Playwright, TypeScript
[BrowserManager] 浏览器已启动
[BrowserManager] 已加载 csdn 的认证状态
[CSDN] 已打开编辑器页面
[CSDN] 已输入标题: Playwright 自动化实战
[CSDN] 已注入正文（2048 字符）
[CSDN] 发布成功: https://blog.csdn.net/xxx/article/details/12345
📊 发布结果汇总
  ✅ csdn: https://blog.csdn.net/xxx/...
  ❌ zhihu: 知乎未登录，请先手动登录...
```

### 8.2 发布结果汇总

执行完毕后输出所有平台的成功/失败状态，便于一眼确认。

### 8.3 Trace 调试链路

失败时返回 `tracePath`，可直接用 Playwright Trace Viewer 回放完整操作过程。

---

## 9. 配置系统

### 9.1 全局配置 (`config.ts`)

```typescript
/** 浏览器全局配置 */
export const browserConfig: BrowserConfig = {
  headless: false,
  launchTimeout: 30_000,
  defaultTimeout: 15_000,
  viewport: { width: 1440, height: 900 },
};

/** 平台配置列表 */
export const platformConfigs: Record<string, PlatformConfig> = {
  csdn: {
    name: 'csdn',
    displayName: 'CSDN',
    editorUrl: 'https://editor.csdn.net/md/',
    loginUrl: 'https://passport.csdn.net/login',
    storageStatePath: resolve(ROOT_DIR, 'storage/auth/csdn.json'),
    enabled: true,
  },
  zhihu: { /* ... */ },
  juejin: { /* ... enabled: false */ },
};
```

### 9.2 TypeScript 编译配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  }
}
```

---

## 10. 使用指南

### 首次使用（登录态建立）

```bash
# 1. 安装依赖
pnpm install

# 2. 首次运行 — 在弹出的浏览器中手动登录
pnpm start -- -f posts/hello-world/index.md -p csdn

# 3. 登录成功后 Cookie 自动保存到 storage/auth/csdn.json
# 4. 后续运行将自动跳过登录
```

### 日常发布

```bash
# 发布到单平台
pnpm start -- -f posts/my-article/index.md -p csdn

# 发布到多平台
pnpm start -- -f posts/my-article/index.md -p csdn,zhihu

# 无头模式（不弹出浏览器窗口）
pnpm start -- -f posts/my-article/index.md -p csdn --headless

# 开启 Trace 调试
pnpm start -- -f posts/my-article/index.md -p csdn --trace
```

---

## 11. 类型系统

所有共享类型集中定义在 `src/types/index.ts`：

```typescript
/** 解析后的文章数据 */
interface ArticleData {
  title: string;
  tags: string[];
  summary: string;
  cover: string;       // 绝对路径或 URL
  content: string;     // 原始 Markdown 正文
  category?: string;
  sourcePath: string;  // 源文件绝对路径
}

/** 发布结果 */
interface PublishResult {
  success: boolean;
  platform: string;
  url?: string;
  publishedAt: string;
  error?: string;
  tracePath?: string;
}

/** 支持的平台类型 */
type PlatformType = 'csdn' | 'zhihu' | 'juejin' | 'segmentfault';
```

---

## 附录：技术决策记录 (ADR)

| # | 决策 | 理由 |
|---|------|------|
| 1 | Playwright 而非 Puppeteer | 更好的 TS 支持、内建 storageState、Trace Viewer |
| 2 | ESM 而非 CJS | 面向未来标准，`import.meta.url` 替代 `__dirname` |
| 3 | 粘贴注入而非逐字输入正文 | 效率 vs 真实性权衡 — 正文太长逐字输入不现实 |
| 4 | 单文件配置而非 .env | 类型安全，IDE 补全，复杂结构表达力更强 |
| 5 | 平台间串行而非并行 | 避免多 Context 资源竞争，降低风控触发概率 |
