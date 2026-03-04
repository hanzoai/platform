import { ReactElement } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

const GeneralSettingsPage = () => {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">General Settings</h1>
        <p className="text-muted-foreground">
          Configure general platform settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Platform Configuration
          </CardTitle>
          <CardDescription>General platform settings and preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Platform Version</h3>
              <p className="text-sm text-muted-foreground">v0.25.4</p>
            </div>
            <div>
              <h3 className="text-sm font-medium">Environment</h3>
              <p className="text-sm text-muted-foreground">Production</p>
            </div>
            <div>
              <h3 className="text-sm font-medium">Server Mode</h3>
              <p className="text-sm text-muted-foreground">Self-Hosted</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GeneralSettingsPage;

GeneralSettingsPage.getLayout = (page: ReactElement) => {
  return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps() {
  return { props: {} };
}