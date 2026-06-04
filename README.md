# OmniPost

> 多平台自动化内容发布 + GEO 可见性监控系统，基于 Playwright 浏览器自动化。

## 项目简介

OmniPost 是一款基于 Playwright 的自动化工具，解决技术博主多平台内容分发与 AI 搜索引擎可见性监控的效率痛点。

**核心能力**：

| 能力 | 说明 |
|------|------|
| 📤 一键多发 | 将本地 Markdown 文章同步发布至 CSDN、知乎等内容平台 |
| 🔍 GEO 监控 | 模拟真实用户在 DeepSeek / Kimi / 腾讯元宝 / 秘塔搜索等 AI 引擎中搜索，抓取回答与引用 |
| 🔐 会话保持 | Cookie 持久化 (`storageState`)，免重复登录 |
| 🛡️ 反风控 | 多层指纹抹除 + Box-Muller 正态分布仿人输入 + 随机滚动 |
| 📊 可追溯 | Playwright Trace 固化 + 发布历史记录，问题可复现 |
| 🧩 易扩展 | 平台适配层与核心层分离，新增平台仅需实现接口 |

## 技术栈

| 技术 | 选型理由 |
|------|----------|
| [Playwright](https://playwright.dev/) | 跨浏览器支持，原生 TypeScript 类型，内建 Trace Viewer / storageState |
| TypeScript + ESM | 静态类型 + 现代模块系统 |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | 业界标准 front-matter 解析 |
| tsx | 开发阶段零配置运行 TypeScript |
| pnpm | 高效磁盘利用，严格依赖隔离 |

## 项目结构

```
autoPublish/
├── config.ts                    # 全局配置（浏览器/平台/路径/监控参数）
├── package.json
├── tsconfig.json
├── posts/                       # 待发布的 Markdown 文章
├── src/
│   ├── index.ts                 # CLI 主入口：文章发布
│   ├── server.ts                # HTTP API 服务（发布 + 监控）
│   ├── login.ts                 # 交互式登录脚本
│   ├── monitor-cli.ts           # GEO 监控 CLI
│   ├── diagnose.ts              # DOM 诊断工具
│   ├── core/
│   │   ├── MarkdownParser.ts    # Markdown + front-matter 解析
│   │   ├── BrowserManager.ts    # 浏览器生命周期 + 反检测
│   │   ├── BasePublisher.ts     # 发布器抽象基类（仿人输入/滚动）
│   │   ├── StealthScripts.ts    # 多层指纹抹除脚本
│   │   ├── SelectorEngine.ts    # 智能选择器引擎
│   │   └── MouseHelper.ts      # 鼠标行为模拟
│   ├── platforms/
│   │   ├── CsdnPublisher.ts     # CSDN 平台适配器
│   │   └── ZhihuPublisher.ts    # 知乎平台适配器
│   ├── scrapers/
│   │   ├── index.ts             # 采集器注册中心
│   │   ├── BaseSearchScraper.ts # 采集器抽象基类
│   │   ├── DeepSeekScraper.ts   # DeepSeek 采集器
│   │   ├── KimiScraper.ts       # Kimi 采集器
│   │   ├── YuanbaoScraper.ts    # 腾讯元宝采集器
│   │   └── MetasoScraper.ts     # 秘塔搜索采集器
│   ├── selectors/
│   │   ├── csdn.ts              # CSDN DOM 选择器集
│   │   └── zhihu.ts             # 知乎 DOM 选择器集
│   └── types/
│       └── index.ts             # 全局 TypeScript 类型定义
└── storage/
    ├── auth/                    # 平台认证状态（.gitignore）
    └── logs/                    # 发布历史 + Trace 文件
```

## 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **pnpm**（推荐）

### 安装

```bash
# 安装依赖
pnpm install

# 安装 Playwright 浏览器
npx playwright install chromium
```

### 1. 登录（首次使用）

首次使用需要手动登录各平台以建立 Cookie 会话：

```bash
# 登录 CSDN
pnpm run login:csdn

# 登录知乎
pnpm run login:zhihu

# 登录 AI 搜索引擎（GEO 监控用）
pnpm run login:deepseek
pnpm run login:kimi
pnpm run login:yuanbao
pnpm run login:metaso

# 一次性登录所有平台
pnpm run login:all
```

脚本会打开浏览器窗口，手动完成登录后按 **Enter** 保存状态。后续运行将自动复用保存的 Cookie。

### 2. 发布文章

```bash
# 发布到 CSDN
pnpm run publish:csdn

# 发布到知乎
pnpm run publish:zhihu

# 发布到所有平台
pnpm run publish:all

# 指定文件
pnpm start -- --file posts/my-article/index.md --platform csdn

# 仅解析不发布（Dry-run）
pnpm start -- --file posts/my-article/index.md --dry-run

# 调试模式（有头 + 慢速）
pnpm run debug:csdn
```

### 3. GEO 监控（AI 搜索可见性）

通过 CLI 直接运行监控采集：

```bash
# 单引擎单关键词
pnpm run monitor -- --keyword "友望自集尘吸尘器" --engine deepseek

# 多引擎多关键词
pnpm run monitor -- --keyword "吸尘器推荐" --keyword "友望U12 Pro" --engine deepseek --engine kimi

# 全引擎扫描
pnpm run monitor -- --keyword "吸尘器怎么选" --all-engines

# 调试模式
pnpm run monitor -- --keyword "友望测评" --engine metaso --debug
```

### 4. HTTP API 服务

启动 HTTP 服务后，前端项目可通过 API 调用发布和监控能力：

```bash
pnpm run serve
# 服务默认监听 http://localhost:3210
```

#### 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/publish` | 发布文章到 CSDN/知乎 |
| `POST` | `/monitor` | GEO 监控：AI 引擎搜索采集 |

#### 调用示例

**发布文章**：

```bash
curl -X POST http://localhost:3210/publish \
  -H "Content-Type: application/json" \
  -d '{
    "content": "---\ntitle: 我的文章\ntags: [技术, 分享]\n---\n\n正文内容...",
    "platform": "csdn"
  }'
```

**GEO 监控**：

```bash
curl -X POST http://localhost:3210/monitor \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["自集尘吸尘器推荐", "友望U12 Pro"],
    "engines": ["deepseek", "metaso"]
  }'
```

## 文章格式

文章使用 Markdown 编写，通过 YAML front-matter 定义元数据：

```markdown
---
title: "Playwright 自动化发布实战"
tags: [Playwright, TypeScript, 自动化]
summary: "基于 Playwright 实现多平台文章自动发布的完整方案"
cover: ./cover.png
category: 前端工程化
---

正文内容...
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `title` | string | 否 | 文章标题，缺省时从正文第一个 `# 标题` 提取 |
| `tags` | string[] | 否 | 标签，支持数组或逗号分隔字符串 |
| `summary` | string | 否 | 摘要 |
| `cover` | string | 否 | 封面图路径（相对于 .md 文件或绝对路径/URL） |
| `category` | string | 否 | 分类 |

## 辅助工具

### DOM 诊断

当平台 UI 更新导致选择器失效时，使用诊断脚本快速定位新的 DOM 结构：

```bash
pnpm run diagnose -- --platform csdn
```

### Trace 回放

发布失败时自动保存 Playwright Trace，可通过 Trace Viewer 回放完整操作过程：

```bash
pnpm run trace:view
# 然后在 Trace Viewer 中打开 storage/logs/traces/ 下的 .zip 文件
```

## 可用脚本

| 脚本 | 说明 |
|------|------|
| `pnpm start` | 发布文章（CLI 入口） |
| `pnpm run serve` | 启动 HTTP API 服务 |
| `pnpm run monitor` | GEO 监控 CLI |
| `pnpm run login` | 交互式登录工具 |
| `pnpm run diagnose` | DOM 诊断工具 |
| `pnpm run debug` | 调试模式发布 |
| `pnpm run build` | TypeScript 编译 |
| `pnpm run trace:view` | 启动 Playwright Trace Viewer |

## 架构概览

```
┌──────────────────────────────────────────────────────┐
│              入口层 (CLI / HTTP Server)                │
│     index.ts · server.ts · monitor-cli.ts · login.ts │
└────────────────────────┬─────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│MarkdownParser│ │BrowserManager│ │  BasePublisher /  │
│  内容解析     │ │ 浏览器生命周期│ │ BaseSearchScraper │
└──────────────┘ └──────────────┘ └────────┬─────────┘
                                           │
                    ┌──────────┬───────────┼───────────┐
                    ▼          ▼           ▼           ▼
              CsdnPublisher  ZhihuPublisher  DeepSeekScraper ...
              (平台适配器)    (平台适配器)     (AI 引擎采集器)
```

## License

MIT
