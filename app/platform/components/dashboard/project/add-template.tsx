import { ScrollArea } from "@hanzo/ui";
import { PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { TemplateDeployDialog } from "@/components/templates/template-deploy-dialog";
import {
	TemplateGallery,
	type TemplateSummary,
} from "@/components/templates/template-gallery";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { api } from "@/utils/api";

interface Props {
	environmentId: string;
	baseUrl?: string;
}

/**
 * In-project "Create from Template" — the browse experience (TemplateGallery)
 * and the deploy path (TemplateDeployDialog) are shared verbatim with the
 * standalone marketplace. Here the target environment is fixed to the project
 * the user is already inside, so the deploy dialog skips the project picker.
 */
export const AddTemplate = ({ environmentId, baseUrl }: Props) => {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<{
		template: TemplateSummary;
		baseUrl?: string;
	} | null>(null);
	const utils = api.useUtils();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger className="w-full">
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3"
					onSelect={(e) => e.preventDefault()}
				>
					<PuzzleIcon className="size-4 text-muted-foreground" />
					<span>Template</span>
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[90vw] p-0">
				<DialogHeader className="p-6 border-b">
					<DialogTitle>Create from Template</DialogTitle>
					<DialogDescription>
						Create an open source application from a template
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="h-[calc(98vh-8rem)]">
					<div className="p-6">
						<TemplateGallery
							enabled={open}
							baseUrl={baseUrl}
							showBaseUrlInput
							renderAction={(template, currentBaseUrl) => (
								<Button
									variant="secondary"
									size="sm"
									onClick={() =>
										setSelected({ template, baseUrl: currentBaseUrl })
									}
								>
									Create
								</Button>
							)}
						/>
					</div>
				</ScrollArea>
			</DialogContent>

			<TemplateDeployDialog
				template={selected?.template ?? null}
				baseUrl={selected?.baseUrl}
				environmentId={environmentId}
				onOpenChange={(isOpen) => {
					if (!isOpen) setSelected(null);
				}}
				onDeployed={() => {
					utils.environment.one.invalidate({ environmentId });
					setOpen(false);
				}}
			/>
		</Dialog>
	);
};
