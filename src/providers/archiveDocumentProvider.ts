import * as vscode from 'vscode';
import { ArchiveReader } from '../services/archiveReader';

/**
 * Virtual document provider for files inside .tgz Helm chart archives.
 * Registers a `helm-archive:` URI scheme so VS Code can open read-only views
 * of files extracted from archive subcharts.
 *
 * URI format: helm-archive://<encodedArchivePath>?file=<encodedInternalPath>
 */
export class ArchiveDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'helm-archive';

  private static instance: ArchiveDocumentProvider;

  private constructor() {}

  public static getInstance(): ArchiveDocumentProvider {
    if (!ArchiveDocumentProvider.instance) {
      ArchiveDocumentProvider.instance = new ArchiveDocumentProvider();
    }
    return ArchiveDocumentProvider.instance;
  }

  /**
   * Create a URI for a file inside an archive.
   *
   * @param archivePath Absolute filesystem path to the .tgz file
   * @param internalPath Path within the archive (e.g., "templates/deployment.yaml")
   */
  static createUri(archivePath: string, internalPath: string): vscode.Uri {
    return vscode.Uri.parse(
      `${this.scheme}://${encodeURIComponent(archivePath)}?file=${encodeURIComponent(internalPath)}`
    );
  }

  /**
   * Parse a helm-archive URI back into its archive path and internal file path.
   */
  static parseUri(uri: vscode.Uri): { archivePath: string; internalPath: string } | undefined {
    if (uri.scheme !== this.scheme) {
      return undefined;
    }

    const archivePath = decodeURIComponent(uri.authority);
    const params = new URLSearchParams(uri.query);
    const internalPath = params.get('file');

    if (!archivePath || !internalPath) {
      return undefined;
    }

    return { archivePath, internalPath };
  }

  /**
   * Provide text content for a virtual document from an archive.
   */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = ArchiveDocumentProvider.parseUri(uri);
    if (!parsed) {
      return '';
    }

    const content = await ArchiveReader.getInstance().readFileFromArchive(
      parsed.archivePath,
      parsed.internalPath
    );
    return content ?? '';
  }
}
