import React from "react";

interface Props {
	className?: string;
}

export const Logo = ({ className = "size-14" }: Props) => {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 569 569"
			className={className}
         >
          <path d="M189.287 568.241V378.575H0V568.241H189.287Z" fill="white" />
          <path d="M0 378.575L189.287 397.162V378.575H0Z" fill="#D3D3D3" />
          <path d="M568.501 189.287H189.667L0.758789 378.575H378.954L568.501 189.287Z" fill="white" />
          <path d="M189.287 0H0V189.287H189.287V0Z" fill="white" />
          <path d="M568.621 0H379.333V189.287H568.621V0Z" fill="white" />
          <path d="M568.242 189.287L379.333 170.321V189.287H568.242Z" fill="#D3D3D3" />
          <path d="M568.621 568.241V378.575H379.333V568.241H568.621Z" fill="white" />
		</svg>
	);
};
