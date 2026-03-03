/**
 * Service Node Component for Compose Editor
 *
 * Represents a Docker service in the visual editor
 */

import React, { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, Cpu, HardDrive, Network, Database } from "lucide-react";
import { ServiceSpec } from "@/lib/hanzo-blockchain-infra";

export interface ServiceNodeData {
  name: string;
  service: ServiceSpec;
  onUpdate: (service: ServiceSpec) => void;
}

export const ServiceNode = memo(({ data, selected }: NodeProps<ServiceNodeData>) => {
  const { name, service } = data;

  const getServiceIcon = () => {
    const image = service.image?.toLowerCase() || "";
    if (image.includes("nginx") || image.includes("apache")) return <Server />;
    if (image.includes("postgres") || image.includes("mysql") || image.includes("mongo")) return <Database />;
    if (image.includes("redis") || image.includes("memcached")) return <HardDrive />;
    return <Cpu />;
  };

  const getResourceInfo = () => {
    const cpu = service.deploy?.resources?.limits?.cpus || "0.5";
    const memory = service.deploy?.resources?.limits?.memory || "512M";
    return `${cpu} CPU • ${memory} RAM`;
  };

  return (
    <Card
      className={`
        p-4 min-w-[200px] cursor-pointer transition-all
        ${selected ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"}
      `}
    >
      {/* Handles for connections */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-primary"
        id="top"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-primary"
        id="bottom"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-green-500"
        id="network"
      />
      <Handle
        type="source"
        position={Position.Left}
        className="w-3 h-3 bg-purple-500"
        id="volume"
      />

      {/* Service Content */}
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-primary">{getServiceIcon()}</div>
            <span className="font-semibold">{name}</span>
          </div>
          {service.deploy?.replicas && service.deploy.replicas > 1 && (
            <Badge variant="secondary">{service.deploy.replicas}x</Badge>
          )}
        </div>

        {/* Image */}
        <div className="text-sm text-muted-foreground truncate">
          {service.image || "No image specified"}
        </div>

        {/* Resources */}
        <div className="text-xs text-muted-foreground">
          {getResourceInfo()}
        </div>

        {/* Ports */}
        {service.ports && service.ports.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {service.ports.slice(0, 3).map((port, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {port}
              </Badge>
            ))}
            {service.ports.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{service.ports.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Environment Variables Count */}
        {service.environment && Object.keys(service.environment).length > 0 && (
          <div className="text-xs text-muted-foreground">
            {Object.keys(service.environment).length} env vars
          </div>
        )}

        {/* Health Status Indicator */}
        {service.healthcheck && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs">Health check</span>
          </div>
        )}
      </div>
    </Card>
  );
});