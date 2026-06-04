/** 文章元数据，由 Markdown Front-matter 解析得到 */
export interface ArticleData {
  title: string;
  tags: string[];
  summary: string;
  cover: string | null;  // 封面图绝对路径
  content: string;       // Markdown 正文
  filePath: string;      // 原始 md 文件路径
}

/** 发布结果 */
export interface PublishResult {
  success: boolean;
  platform: string;
  articleTitle: string;
  url?: string;          // 发布成功后的文章链接
  error?: string;
  timestamp: number;
}

/** 平台配置 */
export interface PlatformConfig {
  editorUrl: string;
  statePath: string;
}

/** 浏览器配置 */
export interface BrowserConfig {
  headless: boolean;
  slowMo: number;
  timeout: number;
  viewport: { width: number; height: number };
  proxy?: { server: string; username?: string; password?: string };
}

/** 发布历史记录 */
export interface PublishHistoryEntry {
  hash: string;
  title: string;
  platform: string;
  publishedAt: string;
  url?: string;
}

// ==================== GEO 监控相关类型 ====================

/** AI 搜索引擎抓取结果 */
export interface SearchResult {
  engine: string;          // 'deepseek' | 'kimi' | 'yuanbao' | 'metaso'
  keyword: string;
  responseText: string;    // AI 完整回答文本
  citationUrls: string[];  // 从回答中提取的引用 URL
  success: boolean;
  error?: string;
  duration: number;        // 耗时（毫秒）
  timestamp: string;       // ISO 时间戳
}

/** 监控请求体 */
export interface MonitorRequest {
  keywords: string[];      // 要查询的关键词列表
  engines?: string[];      // 指定引擎（默认全部）
  brand?: string;          // 品牌名（可选，由调用方分析）
}

/** 监控响应体 */
export interface MonitorResponse {
  success: boolean;
  results: SearchResult[];
  errors: string[];
}

/** 采集器平台配置 */
export interface ScraperConfig {
  url: string;
  statePath: string;
}
