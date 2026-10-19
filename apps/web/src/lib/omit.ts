/** `object` without `key`. A computed rest destructuring (`{ [key]: _, ...rest }`) would stop React Compiler. */
export function omitKey<T>(object: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(object).filter(([k]) => k !== key))
}
