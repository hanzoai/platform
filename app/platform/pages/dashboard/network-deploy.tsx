/**
 * Network Deploy Page
 *
 * Single-purpose page for deploying to Hanzo Network
 * Orthogonal design - only handles deployment, not editing
 */

import { ReactElement, useState } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { ComposeSpec } from "@/lib/compose-spec";
import { hanzoNetwork } from "@/lib/hanzo-network";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/utils/api";
import { Loader2, Rocket, CheckCircle, XCircle } from "lucide-react";

const NetworkDeployPage = () => {
  const [deploying, setDeploying] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const { toast } = useToast();
  const specs: ComposeSpec[] | undefined = undefined; // TODO: implement api.compose.list

  const handleDeploy = async (spec: ComposeSpec) => {
    setDeploying(true);
    try {
      const id = await hanzoNetwork.deploy(spec);
      setDeploymentId(id);
      toast({
        title: "Deployed",
        description: `Application deployed to Hanzo Network at ${id}`
      });
    } catch (error) {
      toast({
        title: "Deployment Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Deploy to Hanzo Network</h1>
        <p className="text-muted-foreground">Deploy compose specs to the EVM chain</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Network Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span>Connected to api.hanzo.network</span>
          </div>
        </CardContent>
      </Card>

      {deploymentId && (
        <Card>
          <CardHeader>
            <CardTitle>Latest Deployment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <code className="text-sm">{deploymentId}</code>
              <Badge variant="green">
                <CheckCircle className="w-3 h-3 mr-1" />
                Running
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        <h2 className="text-lg font-semibold">Available Specs</h2>
        {specs?.map(spec => (
          <Card key={spec.name}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{spec.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {Object.keys(spec.services).length} services
                  </p>
                </div>
                <Button
                  onClick={() => handleDeploy(spec)}
                  disabled={deploying}
                >
                  {deploying ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Rocket className="w-4 h-4 mr-2" />
                  )}
                  Deploy
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default NetworkDeployPage;

NetworkDeployPage.getLayout = (page: ReactElement) => {
  return <DashboardLayout metaName="Network Deploy">{page}</DashboardLayout>;
};

export async function getServerSideProps() {
  return { props: {} };
}