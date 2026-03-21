/**
 * Compose Visual Editor
 *
 * Single-purpose ReactFlow editor for Compose Spec
 * No deployment logic, only editing
 */

import { useCallback, useEffect } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from "reactflow";
import "reactflow/dist/style.css";
import { ComposeSpec, ServiceSpec } from "@/lib/compose-spec";

interface Props {
  spec: ComposeSpec;
  onChange: (spec: ComposeSpec) => void;
}

export function ComposeVisualEditor({ spec, onChange }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Initialize nodes from spec
  useEffect(() => {
    const newNodes: Node[] = [];
    let y = 0;

    Object.entries(spec.services).forEach(([name, service], i) => {
      newNodes.push({
        id: name,
        type: "default",
        position: { x: (i % 3) * 200, y: Math.floor(i / 3) * 150 },
        data: { label: name, service }
      });
    });

    setNodes(newNodes);

    // Create edges for dependencies
    const newEdges: Edge[] = [];
    Object.entries(spec.services).forEach(([name, service]) => {
      if (service.depends_on) {
        const deps = Array.isArray(service.depends_on)
          ? service.depends_on
          : Object.keys(service.depends_on);

        deps.forEach(dep => {
          newEdges.push({
            id: `${dep}-${name}`,
            source: dep,
            target: name,
          });
        });
      }
    });

    setEdges(newEdges);
  }, [spec]);

  // Update spec when nodes change
  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes);

      const newSpec: ComposeSpec = {
        ...spec,
        services: {}
      };

      nodes.forEach(node => {
        newSpec.services[node.id] = node.data.service || { image: "httpd:alpine" };
      });

      onChange(newSpec);
    },
    [nodes, spec, onChange, onNodesChange]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => addEdge(params, eds));

      // Update dependencies in spec
      if (params.source && params.target) {
        const newSpec = { ...spec };
        const targetService = newSpec.services[params.target];
        if (targetService) {
          targetService.depends_on = targetService.depends_on || [];
          if (Array.isArray(targetService.depends_on)) {
            targetService.depends_on.push(params.source);
          }
        }
        onChange(newSpec);
      }
    },
    [spec, onChange, setEdges]
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}