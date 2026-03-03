import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/utils/api";
import { GitPullRequestIcon, XIcon } from "lucide-react";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import { useState } from "react";
import { toast } from "sonner";

export const ShowPreviewDeployments = ({ applicationId }: { applicationId: string }) => {
    const { t } = useTranslation("application");
    const router = useRouter();
    const [isRemoving, setIsRemoving] = useState<string | null>(null);

    const { data: deployments, refetch } = api.preview.byApplicationId.useQuery(
        { applicationId },
        { refetchInterval: 5000 }
    );

    const { mutate: removePreviewDeployment } = api.preview.remove.useMutation({
        onSuccess: () => {
            toast.success(t("previewDeployments.removed"));
            refetch();
            setIsRemoving(null);
        },
        onError: (error) => {
            toast.error(t("previewDeployments.error", { error: error.message }));
            setIsRemoving(null);
        },
    });

    const handleRemove = (id: string) => {
        setIsRemoving(id);
        removePreviewDeployment({ previewDeploymentId: id });
    };

    if (!deployments || deployments.length === 0) {
        return (
            <Card className="bg-muted/40">
                <CardHeader>
                    <CardTitle>{t("previewDeployments.title")}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-8">
                        <GitPullRequestIcon className="h-10 w-10 text-muted-foreground mb-4" />
                        <p className="text-center text-muted-foreground">
                            {t("previewDeployments.empty")}
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-muted/40">
            <CardHeader>
                <CardTitle>{t("previewDeployments.title")}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {deployments.map((deployment) => (
                        <div
                            key={deployment.previewDeploymentId}
                            className="flex items-center justify-between border p-4 rounded-lg"
                        >
                            <div className="flex flex-col">
                                <div className="flex items-center space-x-2">
                                    <GitPullRequestIcon className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">{deployment.pullRequestTitle}</span>
                                </div>
                                <div className="text-sm text-muted-foreground mt-1">
                                    <span>Branch: {deployment.branch}</span>
                                    <span className="mx-2">•</span>
                                    <span>PR #{deployment.pullRequestNumber}</span>
                                </div>
                                <div className="text-sm text-muted-foreground mt-1">
                                    <span>Status: {deployment.previewStatus}</span>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        window.open(deployment.pullRequestURL, "_blank");
                                    }}
                                >
                                    View PR
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleRemove(deployment.previewDeploymentId)}
                                    disabled={isRemoving === deployment.previewDeploymentId}
                                >
                                    <XIcon className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}; 