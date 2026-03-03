declare module 'micromatch' {
  export function isMatch(str: string, patterns: string | string[], options?: any): boolean;
  export function some(list: string[], patterns: string | string[], options?: any): boolean;
  export function every(list: string[], patterns: string | string[], options?: any): boolean;
  export function match(list: string[], patterns: string | string[], options?: any): string[];
  export function not(list: string[], patterns: string | string[], options?: any): string[];
  export function contains(str: string, pattern: string, options?: any): boolean;
  export function matchKeys(obj: object, patterns: string | string[], options?: any): object;
  export function filter(patterns: string | string[], options?: any): (file: string) => boolean;
  export function scan(str: string, options?: any): RegExp;
  export function makeRe(pattern: string, options?: any): RegExp;
  export function create(pattern: string, options?: any): (str: string) => boolean;
  export default {
    isMatch,
    some,
    every,
    match,
    not,
    contains,
    matchKeys,
    filter,
    scan,
    makeRe,
    create
  };
}