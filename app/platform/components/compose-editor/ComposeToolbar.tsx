import React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface ComposeToolbarProps {
  onAddService: () => void;
  onAddNetwork: () => void;
  onAddVolume: () => void;
}

export function ComposeToolbar({
  onAddService,
  onAddNetwork,
  onAddVolume,
}: ComposeToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onAddService}>
        <Plus className="h-4 w-4 mr-1" />
        Service
      </Button>
      <Button variant="outline" size="sm" onClick={onAddNetwork}>
        <Plus className="h-4 w-4 mr-1" />
        Network
      </Button>
      <Button variant="outline" size="sm" onClick={onAddVolume}>
        <Plus className="h-4 w-4 mr-1" />
        Volume
      </Button>
    </div>
  );
}
