/**
 * Deploy Page
 *
 * Select compose.yml from repo, paste, edit, and deploy services
 * Each service can be deployed independently to Hanzo Network
 */

import { ReactElement, useState } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { Play, Upload, FileText, GitBranch, Rocket, Server, CheckCircle } from "lucide-react";
import { ComposeSpec, ServiceSpec } from "@/lib/compose-spec";
import { hanzoNetwork } from "@/lib/hanzo-network";
import { api } from "@/utils/api";
import yaml from "js-yaml";

const DeployPage = () => {
  const [spec, setSpec] = useState<ComposeSpec | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [yamlContent, setYamlContent] = useState("");
  const [deployments, setDeployments] = useState<Map<string, string>>(new Map());
  const { toast } = useToast();

  // Compose files discovered in the current repo (none until a repo is selected).
  const repoFiles: string[] = [];

  // Parse YAML to Compose Spec
  const parseYaml = (content: string) => {
    try {
      const parsed = yaml.load(content) as any;
      const spec: ComposeSpec = {
        version: "3.0",
        name: parsed.name || "app",
        services: parsed.services || {},
        networks: parsed.networks,
        volumes: parsed.volumes,
        configs: parsed.configs,
        secrets: parsed.secrets
      };
      setSpec(spec);
      setSelectedServices(new Set(Object.keys(spec.services)));
      toast({ title: "Parsed successfully" });
    } catch (error) {
      toast({
        title: "Parse error",
        description: "Invalid compose specification",
        variant: "destructive"
      });
    }
  };

  // Load compose file from repo
  const loadFromRepo = async (path: string) => {
    const response = await fetch(`/v1/repo/file?path=${path}`);
    const content = await response.text();
    setYamlContent(content);
    parseYaml(content);
  };

  // Deploy selected services
  const deploySelected = async () => {
    if (!spec) return;

    const servicesToDeploy = Array.from(selectedServices);

    for (const serviceName of servicesToDeploy) {
      const service = spec.services[serviceName];
      if (!service) continue;

      try {
        // Deploy individual service as a minimal spec
        const serviceSpec: ComposeSpec = {
          version: "3.0",
          name: `${spec.name}-${serviceName}`,
          services: {
            [serviceName]: service
          }
        };

        const deploymentId = await hanzoNetwork.deploy(serviceSpec);
        setDeployments(prev => new Map(prev).set(serviceName, deploymentId));

        toast({
          title: `Deployed ${serviceName}`,
          description: `Contract: ${deploymentId}`
        });
      } catch (error) {
        toast({
          title: `Failed to deploy ${serviceName}`,
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive"
        });
      }
    }
  };

  // Toggle service selection
  const toggleService = (name: string) => {
    const newSelected = new Set(selectedServices);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedServices(newSelected);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Deploy to Hanzo Network</h1>
        <p className="text-muted-foreground">
          Load compose specs from your repo or paste YAML to deploy services
        </p>
      </div>

      <Tabs defaultValue="repo" className="w-full">
        <TabsList>
          <TabsTrigger value="repo">
            <GitBranch className="w-4 h-4 mr-2" />
            From Repository
          </TabsTrigger>
          <TabsTrigger value="paste">
            <FileText className="w-4 h-4 mr-2" />
            Paste YAML
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="w-4 h-4 mr-2" />
            Upload File
          </TabsTrigger>
        </TabsList>

        <TabsContent value="repo" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Repository Compose Files</CardTitle>
              <CardDescription>
                Select a compose file from your repository
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select onValueChange={loadFromRepo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a compose file" />
                </SelectTrigger>
                <SelectContent>
                  {repoFiles?.map(file => (
                    <SelectItem key={file} value={file}>
                      {file}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paste" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Paste Compose YAML</CardTitle>
              <CardDescription>
                Paste your compose specification in YAML format
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Paste your compose.yml content here..."
                className="min-h-[300px] font-mono"
                value={yamlContent}
                onChange={(e) => setYamlContent(e.target.value)}
              />
              <Button onClick={() => parseYaml(yamlContent)}>
                Parse YAML
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload Compose File</CardTitle>
              <CardDescription>
                Upload a compose.yml or docker-compose.yml file
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                type="file"
                accept=".yml,.yaml"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                      const content = e.target?.result as string;
                      setYamlContent(content);
                      parseYaml(content);
                    };
                    reader.readAsText(file);
                  }
                }}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {spec && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Services to Deploy</CardTitle>
              <CardDescription>
                Select which services you want to deploy to Hanzo Network
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(spec.services).map(([name, service]) => (
                  <div key={name} className="flex items-start space-x-3 p-4 border rounded-lg">
                    <Checkbox
                      id={name}
                      checked={selectedServices.has(name)}
                      onCheckedChange={() => toggleService(name)}
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor={name}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Server className="w-4 h-4" />
                            {name}
                          </div>
                        </label>
                        {deployments.has(name) && (
                          <Badge variant="green">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Deployed
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Image: {service.image}
                      </div>
                      {service.ports && (
                        <div className="flex gap-1">
                          {service.ports.map((port, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {port}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {deployments.has(name) && (
                        <div className="text-xs font-mono text-muted-foreground">
                          Contract: {deployments.get(name)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button
              variant="outline"
              onClick={() => setSelectedServices(new Set(Object.keys(spec.services)))}
            >
              Select All
            </Button>
            <Button
              variant="outline"
              onClick={() => setSelectedServices(new Set())}
            >
              Select None
            </Button>
            <Button
              onClick={deploySelected}
              disabled={selectedServices.size === 0}
            >
              <Rocket className="w-4 h-4 mr-2" />
              Deploy {selectedServices.size} Service{selectedServices.size !== 1 ? "s" : ""}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default DeployPage;

DeployPage.getLayout = (page: ReactElement) => {
  return <DashboardLayout metaName="Deploy">{page}</DashboardLayout>;
};

export async function getServerSideProps() {
  return { props: {} };
}