declare module 'js-yaml' {
  export function load(input: string): any;
  export function dump(obj: any): string;
}