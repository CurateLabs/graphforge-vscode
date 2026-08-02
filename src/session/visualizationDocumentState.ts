/**
 * Host-owned committed/draft state for an opened visualization artifact.
 * Webviews may propose JSON state, but the extension host remains the source
 * of truth and writes only a validated draft after an explicit Save action.
 */
export class VisualizationDocumentState<T> {
  private committedValue: T;
  private draftValue: T;

  constructor(value: T) {
    this.committedValue = structuredClone(value);
    this.draftValue = structuredClone(value);
  }

  get committed(): T {
    return structuredClone(this.committedValue);
  }

  get draft(): T {
    return structuredClone(this.draftValue);
  }

  get dirty(): boolean {
    return JSON.stringify(this.committedValue) !== JSON.stringify(this.draftValue);
  }

  update(value: T): T {
    this.draftValue = structuredClone(value);
    return this.draft;
  }

  commit(): T {
    this.committedValue = structuredClone(this.draftValue);
    return this.committed;
  }

  revert(): T {
    this.draftValue = structuredClone(this.committedValue);
    return this.draft;
  }
}
