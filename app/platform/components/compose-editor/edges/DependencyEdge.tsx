import React from "react";
import { BaseEdge, EdgeProps, getSmoothStepPath } from "reactflow";

export function DependencyEdge(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
  });

  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke: "#3b82f6", strokeWidth: 2 }}
      {...props}
    />
  );
}
