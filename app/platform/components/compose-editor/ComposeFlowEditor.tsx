/**
 * ReactFlow-based Compose Editor
 *
 * A visual drag-and-drop editor for Docker Compose specifications
 * Supporting the new Compose Spec v3.0 format
 */

import React, { useCallback, useState, useMemo } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
  Panel,
  NodeTypes,
  EdgeTypes,
} from "reactflow";
import "reactflow/dist/style.css";

import { ServiceNode } from "./nodes/ServiceNode";
import { NetworkNode } from "./nodes/NetworkNode";
import { VolumeNode } from "./nodes/VolumeNode";
import { DependencyEdge } from "./edges/DependencyEdge";
import { NetworkEdge } from "./edges/NetworkEdge";
import { VolumeEdge } from "./edges/VolumeEdge";
import { ComposeToolbar } from "./ComposeToolbar";
import { ComposePropertiesPanel } from "./ComposePropertiesPanel";
import { ComposeSpec, ServiceSpec } from "@/lib/hanzo-blockchain-infra";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, Upload, Code, Eye, Play, Save } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

// Define node types
const nodeTypes: NodeTypes = {
  service: ServiceNode,
  network: NetworkNode,
  volume: VolumeNode,
};

// Define edge types
const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge,
  network: NetworkEdge,
  volume: VolumeEdge,
};

interface ComposeFlowEditorProps {
  initialSpec?: ComposeSpec;
  onSave?: (spec: ComposeSpec) => void;
  onDeploy?: (spec: ComposeSpec) => void;
}

export function ComposeFlowEditor({
  initialSpec,
  onSave,
  onDeploy,
}: ComposeFlowEditorProps) {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "yaml" | "split">("visual");

  // Initialize from spec
  React.useEffect(() => {
    if (initialSpec) {
      loadFromSpec(initialSpec);
    }
  }, [initialSpec]);

  // Load compose spec into visual editor
  const loadFromSpec = (spec: ComposeSpec) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Create service nodes
    let serviceY = 100;
    Object.entries(spec.services || {}).forEach(([name, service], index) => {
      newNodes.push({
        id: `service-${name}`,
        type: "service",
        position: { x: 250 * (index % 3), y: serviceY },
        data: {
          name,
          service,
          onUpdate: (updatedService: ServiceSpec) => updateService(name, updatedService),
        },
      });

      if ((index + 1) % 3 === 0) {
        serviceY += 200;
      }

      // Create dependency edges
      if (service.depends_on) {
        const deps = Array.isArray(service.depends_on)
          ? service.depends_on
          : Object.keys(service.depends_on);

        deps.forEach(dep => {
          newEdges.push({
            id: `dep-${name}-${dep}`,
            source: `service-${dep}`,
            target: `service-${name}`,
            type: "dependency",
            animated: true,
          });
        });
      }
    });

    // Create network nodes
    let networkY = serviceY + 300;
    Object.entries(spec.networks || {}).forEach(([name], index) => {
      newNodes.push({
        id: `network-${name}`,
        type: "network",
        position: { x: 400 * index, y: networkY },
        data: {
          name,
          network: spec.networks![name],
        },
      });

      // Connect services to networks
      Object.entries(spec.services || {}).forEach(([serviceName, service]) => {
        if (service.networks?.includes(name)) {
          newEdges.push({
            id: `net-${serviceName}-${name}`,
            source: `service-${serviceName}`,
            target: `network-${name}`,
            type: "network",
            animated: false,
          });
        }
      });
    });

    // Create volume nodes
    let volumeY = networkY + 150;
    Object.entries(spec.volumes || {}).forEach(([name], index) => {
      newNodes.push({
        id: `volume-${name}`,
        type: "volume",
        position: { x: 400 * index, y: volumeY },
        data: {
          name,
          volume: spec.volumes![name],
        },
      });

      // Connect services to volumes
      Object.entries(spec.services || {}).forEach(([serviceName, service]) => {
        if (service.volumes?.some(v => v.startsWith(`${name}:`))) {
          newEdges.push({
            id: `vol-${serviceName}-${name}`,
            source: `service-${serviceName}`,
            target: `volume-${name}`,
            type: "volume",
            animated: false,
            style: { stroke: "#9333ea" },
          });
        }
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  };

  // Convert visual editor to compose spec
  const exportToSpec = (): ComposeSpec => {
    const spec: ComposeSpec = {
      version: "3.0",
      name: "compose-app",
      services: {},
      networks: {},
      volumes: {},
    };

    nodes.forEach(node => {
      if (node.type === "service") {
        spec.services[node.data.name] = node.data.service;
      } else if (node.type === "network") {
        spec.networks![node.data.name] = node.data.network;
      } else if (node.type === "volume") {
        spec.volumes![node.data.name] = node.data.volume;
      }
    });

    return spec;
  };

  // Update service
  const updateService = (name: string, service: ServiceSpec) => {
    setNodes(nodes =>
      nodes.map(node => {
        if (node.id === `service-${name}`) {
          return {
            ...node,
            data: {
              ...node.data,
              service,
            },
          };
        }
        return node;
      })
    );
  };

  // Handle connections
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => addEdge(params, eds));
    },
    [setEdges]
  );

  // Handle node selection
  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Add new service
  const addService = () => {
    const name = `service-${nodes.length + 1}`;
    const newNode: Node = {
      id: `service-${name}`,
      type: "service",
      position: { x: Math.random() * 500, y: Math.random() * 300 },
      data: {
        name,
        service: {
          image: "httpd:alpine",
        },
        onUpdate: (service: ServiceSpec) => updateService(name, service),
      },
    };
    setNodes(nodes => [...nodes, newNode]);
  };

  // Add new network
  const addNetwork = () => {
    const name = `network-${nodes.filter(n => n.type === "network").length + 1}`;
    const newNode: Node = {
      id: `network-${name}`,
      type: "network",
      position: { x: Math.random() * 500, y: 400 },
      data: {
        name,
        network: {
          driver: "bridge",
        },
      },
    };
    setNodes(nodes => [...nodes, newNode]);
  };

  // Add new volume
  const addVolume = () => {
    const name = `volume-${nodes.filter(n => n.type === "volume").length + 1}`;
    const newNode: Node = {
      id: `volume-${name}`,
      type: "volume",
      position: { x: Math.random() * 500, y: 500 },
      data: {
        name,
        volume: {
          driver: "local",
        },
      },
    };
    setNodes(nodes => [...nodes, newNode]);
  };

  // Export YAML
  const exportYAML = () => {
    const spec = exportToSpec();
    const yaml = JSON.stringify(spec, null, 2); // TODO: Convert to actual YAML
    navigator.clipboard.writeText(yaml);
    toast({
      title: "Exported to clipboard",
      description: "Compose specification copied to clipboard",
    });
  };

  // Import YAML
  const importYAML = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const spec = JSON.parse(text) as ComposeSpec; // TODO: Parse actual YAML
      loadFromSpec(spec);
      toast({
        title: "Imported successfully",
        description: "Compose specification loaded",
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: "Invalid compose specification",
        variant: "destructive",
      });
    }
  };

  // Handle save
  const handleSave = () => {
    const spec = exportToSpec();
    onSave?.(spec);
    toast({
      title: "Saved",
      description: "Compose specification saved successfully",
    });
  };

  // Handle deploy
  const handleDeploy = () => {
    const spec = exportToSpec();
    onDeploy?.(spec);
    toast({
      title: "Deploying",
      description: "Deploying compose specification to blockchain",
    });
  };

  return (
    <div className="h-full w-full flex flex-col">
      {/* Toolbar */}
      <div className="border-b p-2">
        <div className="flex items-center justify-between">
          <ComposeToolbar
            onAddService={addService}
            onAddNetwork={addNetwork}
            onAddVolume={addVolume}
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode("visual")}
              className={viewMode === "visual" ? "bg-accent" : ""}
            >
              <Eye className="h-4 w-4 mr-2" />
              Visual
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode("yaml")}
              className={viewMode === "yaml" ? "bg-accent" : ""}
            >
              <Code className="h-4 w-4 mr-2" />
              YAML
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode("split")}
              className={viewMode === "split" ? "bg-accent" : ""}
            >
              Split
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={importYAML}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button variant="outline" size="sm" onClick={exportYAML}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button size="sm" onClick={handleDeploy}>
              <Play className="h-4 w-4 mr-2" />
              Deploy
            </Button>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex">
        {/* Visual Editor */}
        {(viewMode === "visual" || viewMode === "split") && (
          <div className={`${viewMode === "split" ? "w-1/2" : "w-full"} relative`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}
              fitView
            >
              <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
              <Controls />
              <MiniMap
                nodeColor={(node) => {
                  switch (node.type) {
                    case "service":
                      return "#3b82f6";
                    case "network":
                      return "#10b981";
                    case "volume":
                      return "#9333ea";
                    default:
                      return "#6b7280";
                  }
                }}
              />
            </ReactFlow>
          </div>
        )}

        {/* YAML Editor */}
        {(viewMode === "yaml" || viewMode === "split") && (
          <div className={`${viewMode === "split" ? "w-1/2 border-l" : "w-full"} p-4`}>
            <Card className="h-full">
              <pre className="p-4 overflow-auto h-full">
                <code>{JSON.stringify(exportToSpec(), null, 2)}</code>
              </pre>
            </Card>
          </div>
        )}

        {/* Properties Panel */}
        {selectedNode && viewMode === "visual" && (
          <ComposePropertiesPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onUpdate={(updatedNode) => {
              setNodes(nodes =>
                nodes.map(n => (n.id === updatedNode.id ? updatedNode : n))
              );
            }}
          />
        )}
      </div>
    </div>
  );
}