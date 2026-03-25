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
    toast({
      title: "Not available",
      description: "Compose save is not yet connected to the backend",
      variant: "destructive"
    });
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

export async function getServerSideProps() {
  return { props: {} };
}