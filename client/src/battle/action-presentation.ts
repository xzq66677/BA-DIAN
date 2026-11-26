export interface ActionPresentation {
  fx: string;
  mode: 'manual' | 'automatic';
  durationMs?: number;
  major?: boolean;
}

const presentations = new Map<string, ActionPresentation>();

export function registerActionPresentation(actionName: string, presentation: ActionPresentation): void {
  presentations.set(actionName, { ...presentation });
}

export function resolveActionPresentation(actionName: string): ActionPresentation | undefined {
  return presentations.get(actionName);
}

export function actionPresentationDuration(fx: string | undefined): number | undefined {
  for (const presentation of presentations.values()) {
    if (presentation.fx === fx) return presentation.durationMs;
  }
  return undefined;
}

export function isMajorActionPresentation(fx: string | undefined): boolean {
  for (const presentation of presentations.values()) {
    if (presentation.fx === fx) return presentation.major === true;
  }
  return false;
}
