import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { GlobeIcon } from "lucide-react";
import { useTranslation } from "next-i18next";
import { toast } from "sonner";

export const ShowTraefikActions = () => {
    const { t } = useTranslation("settings");
    const { mutate: restartTraefik, isLoading } = api.server.restartTraefik.useMutation({
        onSuccess: () => {
            toast.success(t("settings.server.actions.traefik.success"));
        },
        onError: (error) => {
            toast.error(
                t("settings.server.actions.traefik.error", { error: error.message })
            );
        },
    });

    return (
        <div className="flex flex-col space-y-2 rounded-md border p-4">
            <span className="text-sm font-medium">
                {t("settings.server.actions.traefik.title")}
            </span>
            <span className="text-xs text-muted-foreground">
                {t("settings.server.actions.traefik.description")}
            </span>
            <div className="mt-2 flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restartTraefik()}
                    disabled={isLoading}
                    className="flex gap-1"
                >
                    <GlobeIcon className="h-4 w-4" />
                    {t("settings.server.actions.traefik.label")}
                </Button>
            </div>
        </div>
    );
}; 