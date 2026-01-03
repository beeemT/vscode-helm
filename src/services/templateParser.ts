/**
 * Represents a reference to a .Values path in a Helm template
 */
export interface TemplateReference {
  /** The full matched text (e.g., "{{ .Values.foo }}") */
  fullMatch: string;
  /** The values path (e.g., "foo.bar.baz") */
  path: string;
  /** Start offset in the document */
  startOffset: number;
  /** End offset in the document */
  endOffset: number;
  /** Default value if specified with | default */
  defaultValue?: string;
}

/**
 * Service for parsing Helm template files and extracting .Values references
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
   * Parse template text and extract all .Values references.
   *
   * Supported patterns:
   * - {{ .Values.foo }}
   * - {{- .Values.foo -}}
   * - {{ $.Values.foo }}
   * - {{ .Values.foo | default "bar" }}
   * - {{ .Values.foo | default 123 }}
   */
  public parseTemplateReferences(text: string): TemplateReference[] {
    const references: TemplateReference[] = [];

    // Main regex pattern to match .Values and $.Values references
    // Captures:
    // 1. The values path (e.g., "image.repository")
    // 2. Optional default value (string or number)
    const valuesRegex =
      /\{\{-?\s*(?:\$)?\.Values\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*)(?:\s*\|\s*default\s+(?:"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?)))?\s*-?\}\}/g;

    let match;
    while ((match = valuesRegex.exec(text)) !== null) {
      const fullMatch = match[0];
      const path = match[1];
      const defaultValue = match[2] ?? match[3] ?? match[4];

      references.push({
        fullMatch,
        path,
        startOffset: match.index,
        endOffset: match.index + fullMatch.length,
        defaultValue,
      });
    }

    return references;
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
