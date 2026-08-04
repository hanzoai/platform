/**
 * Collapsible — now from the `@hanzo/ui` root barrel.
 *
 * 5.x published it at `@hanzo/ui/collapsible`; 8.x exports every primitive from
 * the root instead, rendered through `@hanzo/gui`. The behavioural contract the
 * call sites rely on is unchanged: the root still emits `data-state="open"`/
 * `"closed"`, which is what `side.tsx` reads through
 * `group-data-[state=open]/collapsible` to turn its chevrons.
 */
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@hanzo/ui";
