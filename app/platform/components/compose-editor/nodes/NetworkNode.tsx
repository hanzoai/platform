import React from "react";
import { Handle, Position } from "reactflow";

interface NetworkNodeProps {
  data: {
    name: string;
    network: Record<string, unknown>;
  };
}

export function NetworkNode({ data }: NetworkNodeProps) {
  return (
    <div className="border border-green-500 rounded-lg p-3 bg-green-50 dark:bg-green-950 min-w-[150px]">
      <Handle type="target" position={Position.Top} />
      <div className="text-sm font-semibold text-green-700 dark:text-green-300">
        {data.name}
      </div>
      <div className="text-xs text-muted-foreground">Network</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
