import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import tar, { Headers } from 'tar-stream';
import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { ChartMetadata } from './helmChartService';

/**
 * Cached archive data with modification time for invalidation
 */
interface ArchiveCacheEntry {
  /** Extracted files content keyed by internal path */
  files: Map<string, string>;
  /** Modification time of the archive file when cached */
  mtime: number;
}

/**
 * Service for reading Helm chart archives (.tgz files)
 * Uses streaming tar extraction for memory efficiency
 */
export class ArchiveReader {
  private static instance: ArchiveReader;
  private cache: Map<string, ArchiveCacheEntry> = new Map();

  private constructor() {}

  public static getInstance(): ArchiveReader {
    if (!ArchiveReader.instance) {
      ArchiveReader.instance = new ArchiveReader();
    }
    return ArchiveReader.instance;
  }

  /**
   * Check if a file path is a .tgz archive
   */
  public isArchive(filePath: string): boolean {
    return filePath.endsWith('.tgz') || filePath.endsWith('.tar.gz');
  }

  /**
   * Get the modification time of an archive file
   */
  private async getArchiveMtime(archivePath: string): Promise<number> {
    try {
      const uri = vscode.Uri.file(archivePath);
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.mtime;
    } catch {
      return 0;
    }
  }

  /**
   * Check if cached data is still valid based on file mtime
   */
  private async isCacheValid(archivePath: string): Promise<boolean> {
    const cached = this.cache.get(archivePath);
    if (!cached) {
      return false;
    }
    const currentMtime = await this.getArchiveMtime(archivePath);
    return cached.mtime === currentMtime;
  }

  /**
   * Extract all files from an archive and cache them
   * Helm chart archives typically have structure: chartname/file.yaml
   */
  private async extractArchive(archivePath: string): Promise<Map<string, string>> {
    return new Promise((resolve, reject) => {
      const files = new Map<string, string>();
      const extract = tar.extract();

      extract.on('entry', (header: Headers, stream: NodeJS.ReadableStream, next: (error?: unknown) => void) => {
        const chunks: Buffer[] = [];

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        stream.on('end', () => {
          if (header.type === 'file') {
            const content = Buffer.concat(chunks).toString('utf-8');
            // Normalize the path - remove leading chart name directory
            // Archives are structured as: chartname/Chart.yaml, chartname/values.yaml, etc.
            const normalizedPath = this.normalizeArchivePath(header.name);
            files.set(normalizedPath, content);
          }
          next();
        });

        stream.on('error', (err: Error) => {
          next(err);
        });

        stream.resume();
      });

      extract.on('finish', () => {
        resolve(files);
      });

      extract.on('error', (err: Error) => {
        reject(err);
      });

      // Create read stream and pipe through gunzip and tar extract
      const readStream = fs.createReadStream(archivePath);
      const gunzip = zlib.createGunzip();

      readStream.on('error', (err: Error) => {
        reject(new Error(`Failed to read archive: ${err.message}`));
      });

      gunzip.on('error', (err: Error) => {
        reject(new Error(`Failed to decompress archive: ${err.message}`));
      });

      readStream.pipe(gunzip).pipe(extract);
    });
  }

  /**
   * Normalize archive path by removing the leading chart directory
   * Helm archives are structured as: chartname/file.yaml
   * We want just: file.yaml or templates/file.yaml
   */
  private normalizeArchivePath(archivePath: string): string {
    const parts = archivePath.split('/');
    // Remove the first part (chart directory name)
    if (parts.length > 1) {
      return parts.slice(1).join('/');
    }
    return archivePath;
  }

  /**
   * Read a specific file from an archive
   */
  public async readFileFromArchive(archivePath: string, internalPath: string): Promise<string | undefined> {
    // Check cache validity
    if (await this.isCacheValid(archivePath)) {
      const cached = this.cache.get(archivePath);
      return cached?.files.get(internalPath);
    }

    // Extract and cache
    try {
      const files = await this.extractArchive(archivePath);
      const mtime = await this.getArchiveMtime(archivePath);
      this.cache.set(archivePath, { files, mtime });
      return files.get(internalPath);
    } catch (error) {
      // Show notification for malformed archives
      const fileName = path.basename(archivePath);
      vscode.window.showWarningMessage(
        `Failed to read Helm chart archive "${fileName}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return undefined;
    }
  }

  /**
   * Extract Chart.yaml metadata from an archive
   */
  public async extractChartMetadata(archivePath: string): Promise<ChartMetadata | undefined> {
    const content = await this.readFileFromArchive(archivePath, 'Chart.yaml');
    if (!content) {
      return undefined;
    }

    try {
      return yaml.load(content) as ChartMetadata;
    } catch (error) {
      const fileName = path.basename(archivePath);
      vscode.window.showWarningMessage(
        `Failed to parse Chart.yaml in archive "${fileName}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return undefined;
    }
  }

  /**
   * Extract values.yaml from an archive
   */
  public async extractValuesYaml(archivePath: string): Promise<Record<string, unknown> | undefined> {
    // Try values.yaml first, then values.yml
    let content = await this.readFileFromArchive(archivePath, 'values.yaml');
    if (!content) {
      content = await this.readFileFromArchive(archivePath, 'values.yml');
    }

    if (!content) {
      return {};
    }

    try {
      return (yaml.load(content) as Record<string, unknown>) || {};
    } catch (error) {
      const fileName = path.basename(archivePath);
      vscode.window.showWarningMessage(
        `Failed to parse values.yaml in archive "${fileName}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return undefined;
    }
  }

  /**
   * Get the chart name from an archive (from Chart.yaml or filename)
   */
  public async getChartName(archivePath: string): Promise<string> {
    const metadata = await this.extractChartMetadata(archivePath);
    if (metadata?.name) {
      return metadata.name;
    }

    // Fall back to parsing filename: chartname-version.tgz
    const fileName = path.basename(archivePath, '.tgz');
    // Remove version suffix (e.g., mysql-8.0.0 -> mysql)
    const match = fileName.match(/^(.+?)-\d+\.\d+\.\d+/);
    if (match) {
      return match[1];
    }
    return fileName;
  }

  /**
   * Invalidate cache for a specific archive
   */
  public invalidateCache(archivePath: string): void {
    this.cache.delete(archivePath);
  }

  /**
   * Invalidate all cache entries for archives in a specific directory
   */
  public invalidateCacheForDirectory(dirPath: string): void {
    const normalizedDir = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    for (const key of this.cache.keys()) {
      if (key.startsWith(normalizedDir)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached archive data
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * List all files in an archive (for debugging/testing)
   */
  public async listArchiveContents(archivePath: string): Promise<string[]> {
    // Check cache validity
    if (await this.isCacheValid(archivePath)) {
      const cached = this.cache.get(archivePath);
      return cached ? Array.from(cached.files.keys()) : [];
    }

    try {
      const files = await this.extractArchive(archivePath);
      const mtime = await this.getArchiveMtime(archivePath);
      this.cache.set(archivePath, { files, mtime });
      return Array.from(files.keys());
    } catch {
      return [];
    }
  }
}
