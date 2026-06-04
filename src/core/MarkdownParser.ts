import matter from 'gray-matter';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import type { ArticleData } from '../types/index.js';

/**
 * Markdown 解析器
 * 使用 gray-matter 解析 Front-matter 元数据，提取文章的标题、标签、摘要、封面和正文
 */
export class MarkdownParser {
  /**
   * 解析指定路径的 Markdown 文件
   * @param mdFilePath - Markdown 文件的路径
   * @returns 结构化的文章数据
   */
  static parseArticle(mdFilePath: string): ArticleData {
    const absolutePath = resolve(mdFilePath);
    const fileContent = readFileSync(absolutePath, 'utf-8');
    const { data: frontMatter, content } = matter(fileContent);

    // 处理封面图路径：将相对路径转为绝对路径
    let coverPath: string | null = null;
    if (frontMatter.cover) {
      coverPath = resolve(dirname(absolutePath), frontMatter.cover);
    }

    return {
      title: frontMatter.title || '未命名文章',
      tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
      summary: frontMatter.summary || '',
      cover: coverPath,
      content: content.trim(),
      filePath: absolutePath,
    };
  }
}
