/**
 * A scheduler's interval must not be the reason the process stays alive.
 *
 * Node hands back a `Timeout` with `unref()` for exactly that; a host that
 * types the handle as a plain number — a browser, and React Native, whose
 * ambient globals are in the program now that the app renders through
 * @hanzo/gui — has no such method and needs none, because nothing there is
 * waiting to exit.
 *
 * The union is the whole point: it is what `setInterval` returns under either
 * lib set, so both callers and both programs typecheck without a cast telling
 * the compiler something the code cannot prove.
 */
export const releaseHandle = (
	handle: number | { unref?: () => void },
): void => {
	if (typeof handle !== "number") handle.unref?.();
};
