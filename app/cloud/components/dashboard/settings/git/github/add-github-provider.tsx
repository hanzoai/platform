import { GithubIcon } from "@/components/icons/data-tools-icons";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";
import { format } from "date-fns";
import { useEffect, useState } from "react";

export const AddGithubProvider = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { data } = api.auth.get.useQuery();
  const [manifestUrl, setManifestUrl] = useState("");
  const [isOrganization, setIsOrganization] = useState(false);
  const [organizationName, setOrganization] = useState("");

  useEffect(() => {
    const origin = window.location.origin;
    const manifest = {
      redirect_url: `${origin}/api/providers/github/setup?authId=${data?.id}`,
      name: `Hanzo-${format(new Date(), "yyyy-MM-dd")}`,
      url: origin,
      hook_attributes: {
        url: `${origin}/api/deploy/github`,
      },
      callback_urls: [`${origin}/api/providers/github/setup`],
      public: false,
      request_oauth_on_install: true,
      default_permissions: {
        contents: "read",
        metadata: "read",
        emails: "read",
        pull_requests: "write",
      },
      default_events: ["pull_request", "push"],
    };

    const manifestParam = encodeURIComponent(JSON.stringify(manifest));
    const baseUrl = isOrganization && organizationName
      ? `https://github.com/organizations/${organizationName}/settings/apps/new`
      : "https://github.com/settings/apps/new";

    setManifestUrl(`${baseUrl}?manifest=${manifestParam}&state=gh_init:${data?.id}`);
  }, [data?.id, isOrganization, organizationName]);

  const handleCreateApp = () => {
    window.location.href = manifestUrl;
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="flex items-center space-x-1">
          <GithubIcon className="text-current fill-current" />
          <span>Github</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Github Provider <GithubIcon className="size-5" />
          </DialogTitle>
        </DialogHeader>

        <div className="grid w-full gap-1">
          <CardContent className="p-0">
            <div className="flex flex-col">
              <p className="text-muted-foreground text-sm">
                To integrate your GitHub account with our services, you'll need
                to create and install a GitHub app. Click below to start.
              </p>
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-row gap-4 items-center">
                  <span>Organization?</span>
                  <Switch
                    checked={isOrganization}
                    onCheckedChange={setIsOrganization}
                  />
                </div>
                {isOrganization && (
                  <Input
                    required
                    placeholder="Organization name"
                    value={organizationName}
                    onChange={(e) => setOrganization(e.target.value)}
                  />
                )}
              </div>

              <div className="flex w-full items-center justify-between mt-4">
                <a
                  href={
                    isOrganization && organizationName
                      ? `https://github.com/organizations/${organizationName}/settings/installations`
                      : "https://github.com/settings/installations"
                  }
                  className={`text-muted-foreground text-sm hover:underline duration-300 ${
                    isOrganization && !organizationName
                      ? "pointer-events-none opacity-50"
                      : ""
                  }`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Unsure if you already have an app?
                </a>
                <Button
                  disabled={isOrganization && !organizationName}
                  onClick={handleCreateApp}
                >
                  Create GitHub App
                </Button>
              </div>
            </div>
          </CardContent>
        </div>
      </DialogContent>
    </Dialog>
  );
};
