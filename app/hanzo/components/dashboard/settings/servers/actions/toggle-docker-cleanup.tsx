import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";
import { useEffect, useState } from "react";
import { useTranslation } from "next-i18next";
import { toast } from "sonner";

export const ToggleDockerCleanup = () => {
    const { t } = useTranslation("settings");
    const [enabled, setEnabled] = useState(false);
    const { data: user } = api.user.get.useQuery();
    const { mutate: toggleCleanup, isLoading } = api.user.toggleDockerCleanup.useMutation({
        onSuccess: () => {
            toast.success(t("settings.server.dockerCleanup.success"));
        },
        onError: (error) => {
            toast.error(
                t("settings.server.dockerCleanup.error", { error: error.message })
            );
            setEnabled(!enabled); // Revert on error
        }
    });

    useEffect(() => {
        if (user) {
            setEnabled(user.user.enableDockerCleanup);
        }
    }, [user]);

    const handleToggle = (value: boolean) => {
        setEnabled(value);
        toggleCleanup({ enable: value });
    };

    return (
        <div className="flex items-center gap-2">
            <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={isLoading}
            />
            <span className="text-sm">
                {t("settings.server.dockerCleanup.label")}
            </span>
        </div>
    );
}; 