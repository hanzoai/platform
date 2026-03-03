import { ReactElement } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Server, HardDrive, Globe, Plus } from "lucide-react";

const ServicesPage = () => {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Services</h1>
          <p className="text-muted-foreground">
            Deploy and manage databases, caches, and other services
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Deploy Service
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              PostgreSQL
            </CardTitle>
            <CardDescription>Relational database</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">Deploy PostgreSQL</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              MySQL
            </CardTitle>
            <CardDescription>Relational database</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">Deploy MySQL</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Redis
            </CardTitle>
            <CardDescription>In-memory cache</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">Deploy Redis</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              MongoDB
            </CardTitle>
            <CardDescription>NoSQL database</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">Deploy MongoDB</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              MinIO
            </CardTitle>
            <CardDescription>Object storage</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">Deploy MinIO</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Traefik
            </CardTitle>
            <CardDescription>Reverse proxy</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline">Deploy Traefik</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ServicesPage;

ServicesPage.getLayout = (page: ReactElement) => {
  return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps() {
  return { props: {} };
}
