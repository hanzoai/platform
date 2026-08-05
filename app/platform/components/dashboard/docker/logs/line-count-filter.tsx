import debounce from "lodash/debounce";
import { CheckIcon } from "lucide-react";
import React, { useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const lineCountOptions = [
	{ label: "100 lines", value: 100 },
	{ label: "300 lines", value: 300 },
	{ label: "500 lines", value: 500 },
	{ label: "1000 lines", value: 1000 },
	{ label: "5000 lines", value: 5000 },
] as const;

interface LineCountFilterProps {
	value: number;
	onValueChange: (value: number) => void;
	title?: string;
}

export function LineCountFilter({
	value,
	onValueChange,
	title = "Limit to",
}: LineCountFilterProps) {
	const [open, setOpen] = React.useState(false);
	const [inputValue, setInputValue] = React.useState("");
	const pendingValueRef = useRef<number | null>(null);

	const isPresetValue = lineCountOptions.some(
		(option) => option.value === value,
	);

	const debouncedValueChange = useCallback(
		debounce((numValue: number) => {
			if (numValue > 0 && numValue !== value) {
				onValueChange(numValue);
				pendingValueRef.current = null;
			}
		}, 500),
		[onValueChange, value],
	);

	const handleInputChange = (input: string) => {
		setInputValue(input);

		// Extract numbers from input and convert
		const numValue = Number.parseInt(input.replace(/[^0-9]/g, ""));
		if (!Number.isNaN(numValue)) {
			pendingValueRef.current = numValue;
			debouncedValueChange(numValue);
		}
	};

	const handleSelect = (selectedValue: string) => {
		const preset = lineCountOptions.find((opt) => opt.label === selectedValue);
		if (preset) {
			if (preset.value !== value) {
				onValueChange(preset.value);
			}
			setInputValue("");
			setOpen(false);
			return;
		}

		const numValue = Number.parseInt(selectedValue);
		if (
			!Number.isNaN(numValue) &&
			numValue > 0 &&
			numValue !== value &&
			numValue !== pendingValueRef.current
		) {
			onValueChange(numValue);
			setInputValue("");
			setOpen(false);
		}
	};

	React.useEffect(() => {
		return () => {
			debouncedValueChange.cancel();
		};
	}, [debouncedValueChange]);

	const displayValue = isPresetValue
		? lineCountOptions.find((option) => option.value === value)?.label
		: `${value} lines`;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="h-9 bg-input text-sm placeholder-gray-400 w-full sm:w-auto"
				>
					{title}
					<Separator orientation="vertical" className="mx-2 h-4" />
					<div className="space-x-1 flex">
						<Badge variant="blank" className="rounded-sm px-1 font-normal">
							{displayValue}
						</Badge>
					</div>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[200px] p-0" align="start">
				<Command>
					<CommandInput
						placeholder="Number of lines"
						value={inputValue}
						onValueChange={handleInputChange}
						onKeyDown={(e: React.KeyboardEvent) => {
							if (e.key === "Enter") {
								e.preventDefault();
								const numValue = Number.parseInt(
									inputValue.replace(/[^0-9]/g, ""),
								);
								if (
									!Number.isNaN(numValue) &&
									numValue > 0 &&
									numValue !== value &&
									numValue !== pendingValueRef.current
								) {
									handleSelect(inputValue);
								}
							}
						}}
					/>
					<CommandList>
						<CommandGroup>
							{lineCountOptions.map((option) => {
								const isSelected = value === option.value;
								return (
									<CommandItem
										key={option.value}
										value={option.label}
										onSelect={() => handleSelect(option.label)}
									>
										<div
											className={cn(
												"flex h-4 w-4 items-center justify-center rounded-sm border border-primary mr-2",
												isSelected
													? "bg-primary text-primary-foreground"
													: "opacity-50 [&_svg]:invisible",
											)}
										>
											<CheckIcon className={cn("h-4 w-4")} />
										</div>
										<span>{option.label}</span>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

export default LineCountFilter;
