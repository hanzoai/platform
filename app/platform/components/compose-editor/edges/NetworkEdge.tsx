import React from "react";
import { BaseEdge, EdgeProps, getSmoothStepPath } from "reactflow";

export function NetworkEdge(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
  });

  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke: "#10b981", strokeWidth: 2, strokeDasharray: "5,5" }}
      {...props}
    />
  );
}
