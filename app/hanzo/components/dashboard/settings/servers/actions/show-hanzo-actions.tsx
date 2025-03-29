import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { ShieldIcon } from "lucide-react";
import { useTranslation } from "next-i18next";
import { toast } from "sonner";

export const ShowHanzoActions = () => {
    const { t } = useTranslation("settings");
    const { mutate: restart, isLoading } = api.server.restartHanzo.useMutation({
        onSuccess: () => {
            toast.success(t("settings.server.actions.restart.success"));
        },
        onError: (error) => {
            toast.error(
                t("settings.server.actions.restart.error", { error: error.message })
            );
        },
    });

    return (
        <div className="flex flex-col space-y-2 rounded-md border p-4">
            <span className="text-sm font-medium">
                {t("settings.server.actions.hanzo.title")}
            </span>
            <span className="text-xs text-muted-foreground">
                {t("settings.server.actions.hanzo.description")}
            </span>
            <div className="mt-2 flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restart()}
                    disabled={isLoading}
                    className="flex gap-1"
                >
                    <ShieldIcon className="h-4 w-4" />
                    {t("settings.server.actions.restart.label")}
                </Button>
            </div>
        </div>
    );
}; 