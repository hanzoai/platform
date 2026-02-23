import React from "react";
import { BaseEdge, EdgeProps, getSmoothStepPath } from "reactflow";

export function VolumeEdge(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
  });

  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke: "#9333ea", strokeWidth: 2 }}
      {...props}
    />
  );
}
