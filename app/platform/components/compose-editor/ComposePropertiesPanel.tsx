import React from "react";
import { Node } from "reactflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface ComposePropertiesPanelProps {
  node: Node;
  onClose: () => void;
  onUpdate: (node: Node) => void;
}

export function ComposePropertiesPanel({
  node,
  onClose,
  onUpdate,
}: ComposePropertiesPanelProps) {
  return (
    <div className="w-80 border-l bg-background p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">{node.data.name}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Properties</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs overflow-auto">
            {JSON.stringify(node.data, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
