import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { HardDriveIcon } from "lucide-react";
import { useTranslation } from "next-i18next";
import { toast } from "sonner";

export const ShowStorageActions = () => {
    const { t } = useTranslation("settings");
    const { mutate: cleanStorage, isLoading } = api.server.cleanStorage.useMutation({
        onSuccess: () => {
            toast.success(t("settings.server.actions.storage.success"));
        },
        onError: (error) => {
            toast.error(
                t("settings.server.actions.storage.error", { error: error.message })
            );
        },
    });

    return (
        <div className="flex flex-col space-y-2 rounded-md border p-4">
            <span className="text-sm font-medium">
                {t("settings.server.actions.storage.title")}
            </span>
            <span className="text-xs text-muted-foreground">
                {t("settings.server.actions.storage.description")}
            </span>
            <div className="mt-2 flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cleanStorage()}
                    disabled={isLoading}
                    className="flex gap-1"
                >
                    <HardDriveIcon className="h-4 w-4" />
                    {t("settings.server.actions.storage.label")}
                </Button>
            </div>
        </div>
    );
}; 