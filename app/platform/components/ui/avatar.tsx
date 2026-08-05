/**
 * Avatar — @hanzo/ui 8.x on @hanzo/gui; radix is gone.
 *
 * `AvatarImage` keeps this app's one behavior on top: a `src` that is a solid
 * colour (user-picked swatch, see lib/avatar-utils) renders as a filled circle
 * instead of an <img>.
 */

import { AvatarImage as UiAvatarImage } from "@hanzo/ui";
import type { ComponentProps } from "react";
import { isSolidColorAvatar } from "@/lib/avatar-utils";

export { Avatar, AvatarFallback } from "@hanzo/ui";

const AvatarImage = ({
	src,
	className,
	...props
}: Omit<ComponentProps<typeof UiAvatarImage>, "src"> & {
	src?: string | null;
}) => {
	if (isSolidColorAvatar(src)) {
		return (
			<div
				key={`solid-${src}`}
				className={className}
				style={{
					backgroundColor: src as string,
					width: "100%",
					height: "100%",
					aspectRatio: "1 / 1",
					borderRadius: "9999px",
				}}
			/>
		);
	}
	return <UiAvatarImage src={src ?? ""} className={className} {...props} />;
};

export { AvatarImage };
