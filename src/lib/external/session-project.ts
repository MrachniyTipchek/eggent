import { getAllProjects } from "@/lib/storage/project-store";
import {
  getOrCreateExternalSession,
  type ExternalSession,
} from "@/lib/storage/external-session-store";

export function chatBelongsToProject(
  chatProjectId: string | undefined,
  projectId: string | undefined
): boolean {
  const left = chatProjectId ?? null;
  const right = projectId ?? null;
  return left === right;
}

export type ResolveExternalSessionProjectResult =
  | {
      ok: true;
      session: ExternalSession;
      resolvedProjectId?: string;
      projectName?: string;
    }
  | {
      ok: false;
      session: ExternalSession;
      kind: "explicit_project_not_found";
      explicitProjectId: string;
      availableProjects: { id: string; name: string }[];
    };

export async function resolveExternalSessionProject(params: {
  sessionId: string;
  explicitProjectId?: string;
}): Promise<ResolveExternalSessionProjectResult> {
  const session = await getOrCreateExternalSession(params.sessionId);
  const projects = await getAllProjects();
  const projectById = new Map(projects.map((project) => [project.id, project]));

  if (session.activeProjectId && !projectById.has(session.activeProjectId)) {
    session.activeProjectId = null;
  }

  let resolvedProjectId: string | undefined;
  const explicit = params.explicitProjectId?.trim() || "";
  if (explicit) {
    if (!projectById.has(explicit)) {
      return {
        ok: false,
        session,
        kind: "explicit_project_not_found",
        explicitProjectId: explicit,
        availableProjects: projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      };
    }
    resolvedProjectId = explicit;
    session.activeProjectId = explicit;
  } else if (session.activeProjectId && projectById.has(session.activeProjectId)) {
    resolvedProjectId = session.activeProjectId;
  } else if (projects.length > 0) {
    resolvedProjectId = projects[0].id;
    session.activeProjectId = projects[0].id;
  } else {
    session.activeProjectId = null;
  }

  return {
    ok: true,
    session,
    resolvedProjectId,
    projectName: resolvedProjectId
      ? projectById.get(resolvedProjectId)?.name
      : undefined,
  };
}
