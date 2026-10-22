/**
 * Binds an object's methods to it, so a scene may take one off it and call
 * it alone, as `const X = graph.toX; X(3)` or `const { toX, toY } = graph`.
 * Methods otherwise lose their object when called that way, and the figure
 * throws on a line that reads as plain JavaScript.
 */
export function bindMethods<T extends object>(target: T): T {
  if (!Object.isExtensible(target)) return target;
  for (let proto: object | null = Object.getPrototypeOf(target) as object | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (key === 'constructor' || typeof descriptor.value !== 'function' || Object.hasOwn(target, key)) continue;
      Object.defineProperty(target, key, { value: (descriptor.value as (...args: unknown[]) => unknown).bind(target), configurable: true, writable: true });
    }
  }
  return target;
}
