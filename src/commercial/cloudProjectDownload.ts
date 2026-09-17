import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProject } from './contractsV9';
import { parseScenarioFile, type ScenarioFile } from '../document/scenarioFile';

/** Export live persisted documents, never a stale historical snapshot. */
export async function downloadCloudProject(api: AuthenticatedCommercialApi, project: CloudProject): Promise<ScenarioFile> {
  const versions = (await api.listProjectVersions(project.id)).filter(v => !v.deletedAt);
  if (!versions.length) throw new Error('Aucune version téléchargeable.');
  const documents = [];
  let bytes = 0;
  for (const version of versions) {
    const document = await api.readCurrentProjectDocument(version.project.id);
    bytes += new TextEncoder().encode(JSON.stringify(document)).length;
    if (bytes > 30 * 1024 * 1024) throw new Error('Le projet dépasse 30 Mo. Téléchargez les versions séparément.');
    documents.push({id:version.id,name:version.name,createdAt:version.createdAt,deletedAt:null,
      basedOnVersionId:versions.some(v=>v.id===version.sourceVersionId)?version.sourceVersionId:null,document});
  }
  if (documents.length === 1) return documents[0].document;
  return parseScenarioFile(JSON.stringify({...documents[0].document,formatVersion:2,title:project.title,
    savedAt:new Date().toISOString(),projectId:project.id,activeVersionId:documents[0].id,versions:documents}));
}
