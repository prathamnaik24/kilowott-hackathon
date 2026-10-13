/**
 * Minimal mustache-style renderer: "Hi {{customer.firstName}}" -> "Hi Priya".
 * Unknown variables render as an empty string so templates never leak syntax to customers.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>((obj, key) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined), context);
    return value === undefined || value === null ? '' : String(value);
  });
}
