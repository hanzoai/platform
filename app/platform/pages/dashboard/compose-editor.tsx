/**
 * Compose Editor Page
 *
 * Single-purpose page for editing Compose Spec files
 * Orthogonal design - only handles compose editing, not deployment
 */

import { ReactElement, useState } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { ComposeVisualEditor } from "@/components/compose/visual-editor";
import { ComposeSpec } from "@/lib/compose-spec";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const ComposePage = () => {
  const [spec, setSpec] = useState<ComposeSpec>({
    version: "3.0",
    name: "new-app",
    services: {}
  });
  const { toast } = useToast();
  const handleSave = async () => {
    try {
      // TODO: implement compose save endpoint
      toast({
        title: "Saved",
        description: "Compose spec saved successfully"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save compose spec",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Compose Editor</h1>
          <Button onClick={handleSave}>Save Spec</Button>
        </div>
      </div>
      <div className="flex-1">
        <ComposeVisualEditor
          spec={spec}
          onChange={setSpec}
        />
      </div>
    </div>
  );
};

export default ComposePage;

ComposePage.getLayout = (page: ReactElement) => {
  return <DashboardLayout metaName="Compose Editor">{page}</DashboardLayout>;
};