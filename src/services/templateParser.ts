/**
 * The type of Helm object being referenced
 */
export type HelmObjectType = 'Values' | 'Chart' | 'Release' | 'Capabilities' | 'Template' | 'Files';

/**
 * Represents a reference to a Helm object path in a template
 */
export interface TemplateReference {
  /** The type of Helm object (.Values, .Chart, .Release, etc.) */
  objectType: HelmObjectType;
  /** The full matched text (e.g., ".Values.foo" or ".Chart.Name") */
  fullMatch: string;
  /** The path after the object type (e.g., "foo.bar.baz" or "Name") */
  path: string;
  /** Start offset in the document */
  startOffset: number;
  /** End offset in the document */
  endOffset: number;
  /** Default value if specified with | default */
  defaultValue?: string;
}

/**
 * Service for parsing Helm template files and extracting Helm object references
 */
export class TemplateParser {
  private static instance: TemplateParser;

  private constructor() {}

  public static getInstance(): TemplateParser {
    if (!TemplateParser.instance) {
      TemplateParser.instance = new TemplateParser();
    }
    return TemplateParser.instance;
  }

  /**
   * Parse template text and extract all Helm object references.
   *
   * Supported objects:
   * - .Values / $.Values - User-defined values
   * - .Chart - Chart.yaml metadata (Name, Version, AppVersion, etc.)
   * - .Release - Release info (Name, Namespace, IsInstall, IsUpgrade, Service)
   * - .Capabilities - Kubernetes capabilities (APIVersions, KubeVersion)
   * - .Template - Current template info (Name, BasePath)
   * - .Files - Access to non-template files
   *
   * Supported patterns:
   * - {{ .Values.foo }}
   * - {{- .Values.foo -}}
   * - {{ $.Values.foo }}
   * - {{ .Values.foo | default "bar" }}
   * - {{ .Chart.Name }}
   * - {{ .Release.Name }}
   * - {{ .Capabilities.KubeVersion }}
   * - Control flow: if, else if, with, range
   * - Variable assignments: $var := .Values.foo
   * - Function calls: default .Chart.Name .Values.foo
   */
  public parseTemplateReferences(text: string): TemplateReference[] {
    const references: TemplateReference[] = [];
    const seenOffsets = new Set<number>();

    // Pattern to find all Helm object references: .Values, .Chart, .Release, .Capabilities, .Template, .Files
    // Also matches $.Values, $.Chart, etc. for root context access
    const helmObjectPattern = /(?:\$)?\.(Values|Chart|Release|Capabilities|Template|Files)\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*)/g;

    // Find all {{ }} blocks first
    const templateBlockRegex = /\{\{-?([\s\S]*?)-?\}\}/g;

    let blockMatch;
    while ((blockMatch = templateBlockRegex.exec(text)) !== null) {
      const fullBlock = blockMatch[0];
      const blockContent = blockMatch[1];
      const blockStart = blockMatch.index;

      // Calculate where the inner content starts (after {{- or {{)
      const contentStartInBlock = fullBlock.indexOf(blockContent);

      // Find all Helm object references within this block
      helmObjectPattern.lastIndex = 0;
      let objectMatch;
      while ((objectMatch = helmObjectPattern.exec(blockContent)) !== null) {
        const fullObjectMatch = objectMatch[0]; // e.g., ".Values.nameOverride" or ".Chart.Name"
        const objectType = objectMatch[1] as HelmObjectType;
        const path = objectMatch[2];

        // Calculate the absolute offset of this reference
        const matchStart = blockStart + contentStartInBlock + objectMatch.index;
        const matchEnd = matchStart + fullObjectMatch.length;

        // Avoid duplicates
        if (seenOffsets.has(matchStart)) {
          continue;
        }
        seenOffsets.add(matchStart);

        // Check for default value following this reference (only for .Values)
        // Pattern: .Values.path | default "value" or | default 123
        let defaultValue: string | undefined;
        if (objectType === 'Values') {
          const afterValue = blockContent.substring(objectMatch.index + objectMatch[0].length);
          const defaultMatch = afterValue.match(/^\s*\|\s*default\s+(?:"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?))/);
          defaultValue = defaultMatch ? (defaultMatch[1] ?? defaultMatch[2] ?? defaultMatch[3]) : undefined;
        }

        references.push({
          objectType,
          fullMatch: fullObjectMatch,
          path,
          startOffset: matchStart,
          endOffset: matchEnd,
          defaultValue,
        });
      }
    }

    // Sort by offset to maintain document order
    references.sort((a, b) => a.startOffset - b.startOffset);

    return references;
  }

  /**
   * Parse template text and extract only .Values references.
   * This is a convenience method for backward compatibility.
   */
  public parseValuesReferences(text: string): TemplateReference[] {
    return this.parseTemplateReferences(text).filter(ref => ref.objectType === 'Values');
  }

  /**
   * Parse a values path into individual segments.
   * Handles both dot notation and array indexing.
   *
   * Examples:
   * - "image.repository" -> ["image", "repository"]
   * - "items[0].name" -> ["items", 0, "name"]
   */
  public parseValuePath(path: string): (string | number)[] {
    const segments: (string | number)[] = [];
    const parts = path.split('.');

    for (const part of parts) {
      // Check for array notation like "items[0]"
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
      if (arrayMatch) {
        segments.push(arrayMatch[1]);
        segments.push(parseInt(arrayMatch[2], 10));
      } else {
        segments.push(part);
      }
    }

    return segments;
  }

  /**
   * Get the position (line and character) for an offset in the text
   */
  public getPositionFromOffset(
    text: string,
    offset: number
  ): { line: number; character: number } {
    const lines = text.substring(0, offset).split('\n');
    const line = lines.length - 1;
    const character = lines[lines.length - 1].length;
    return { line, character };
  }

  /**
   * Find all template references in a document within a specific range
   */
  public parseTemplateReferencesInRange(
    text: string,
    startOffset: number,
    endOffset: number
  ): TemplateReference[] {
    const rangeText = text.substring(startOffset, endOffset);
    const references = this.parseTemplateReferences(rangeText);

    // Adjust offsets to be relative to the full document
    return references.map((ref) => ({
      ...ref,
      startOffset: ref.startOffset + startOffset,
      endOffset: ref.endOffset + startOffset,
    }));
  }
}
