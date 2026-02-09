import React from "react";
import { Handle, Position } from "reactflow";

interface VolumeNodeProps {
  data: {
    name: string;
    volume: Record<string, unknown>;
  };
}

export function VolumeNode({ data }: VolumeNodeProps) {
  return (
    <div className="border border-purple-500 rounded-lg p-3 bg-purple-50 dark:bg-purple-950 min-w-[150px]">
      <Handle type="target" position={Position.Top} />
      <div className="text-sm font-semibold text-purple-700 dark:text-purple-300">
        {data.name}
      </div>
      <div className="text-xs text-muted-foreground">Volume</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
