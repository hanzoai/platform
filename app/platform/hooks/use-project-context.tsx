"use client";

import { useRouter } from "next/router";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";
import { authClient } from "@/lib/auth-client";
import { api } from "@/utils/api";

interface ProjectContextValue {
	activeProjectId: string | null;
	activeEnvironmentId: string | null;
	setActiveProject: (projectId: string | null) => void;
	setActiveEnvironment: (environmentId: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
	activeProjectId: null,
	activeEnvironmentId: null,
	setActiveProject: () => {},
	setActiveEnvironment: () => {},
});

const STORAGE_KEY = "hanzo-platform-active-context";

function readStorage(): { projectId?: string; environmentId?: string } {
	try {
		if (typeof window === "undefined") return {};
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function writeStorage(projectId: string | null, environmentId: string | null) {
	try {
		if (typeof window === "undefined") return;
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ projectId, environmentId }),
		);
	} catch {}
}

export function ProjectContextProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const { data: activeOrg } = authClient.useActiveOrganization();

	// Extract IDs from URL if on a project/env page
	const urlProjectId =
		(router.query.projectId as string | undefined) ?? null;
	const urlEnvironmentId =
		(router.query.environmentId as string | undefined) ?? null;

	const [activeProjectId, setProjectId] = useState<string | null>(
		urlProjectId,
	);
	const [activeEnvironmentId, setEnvironmentId] = useState<string | null>(
		urlEnvironmentId,
	);

	// Sync from URL when navigating
	useEffect(() => {
		if (urlProjectId) setProjectId(urlProjectId);
		if (urlEnvironmentId) setEnvironmentId(urlEnvironmentId);
	}, [urlProjectId, urlEnvironmentId]);

	// Restore from localStorage on mount (only if URL doesn't have them)
	useEffect(() => {
		if (!urlProjectId && !urlEnvironmentId) {
			const stored = readStorage();
			if (stored.projectId) setProjectId(stored.projectId);
			if (stored.environmentId) setEnvironmentId(stored.environmentId);
		}
	}, []);

	// Reset when org changes
	useEffect(() => {
		if (activeOrg?.id) {
			setProjectId(null);
			setEnvironmentId(null);
		}
	}, [activeOrg?.id]);

	// Persist to localStorage
	useEffect(() => {
		writeStorage(activeProjectId, activeEnvironmentId);
	}, [activeProjectId, activeEnvironmentId]);

	const setActiveProject = useCallback((projectId: string | null) => {
		setProjectId(projectId);
		setEnvironmentId(null); // reset env when project changes
	}, []);

	const setActiveEnvironment = useCallback(
		(environmentId: string | null) => {
			setEnvironmentId(environmentId);
		},
		[],
	);

	return (
		<ProjectContext.Provider
			value={{
				activeProjectId,
				activeEnvironmentId,
				setActiveProject,
				setActiveEnvironment,
			}}
		>
			{children}
		</ProjectContext.Provider>
	);
}

export function useProjectContext() {
	return useContext(ProjectContext);
}
