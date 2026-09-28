// Ryagram library data (2A-2). Every call the app makes to Supabase lives
// here, so the views never build queries and every failure becomes one
// readable Error. The database enforces the rules; this layer just asks.
(() => {
  const ARTIFACT_BUCKET = 'ryagram-artifacts';

  function ryagramData(client) {
    async function run(promise, fallback) {
      const { data, error } = await promise;
      if (error) throw new Error(error.message || fallback);
      return data;
    }

    return {
      async listProjects() {
        const projects = await run(
          client.from('projects').select('id, title, created_at, updated_at')
            .is('archived_at', null).order('updated_at', { ascending: false }),
          'Couldn’t load your projects.');
        if (!projects.length) return [];
        const versions = await run(
          client.from('versions').select('project_id, number, state')
            .in('project_id', projects.map(p => p.id)),
          'Couldn’t load your versions.');
        return projects.map(p => {
          const own = versions.filter(v => v.project_id === p.id).sort((a, b) => b.number - a.number);
          return { ...p, versionCount: own.length, latest: own[0] || null };
        });
      },

      // A project always starts with r1.
      async createProject(title) {
        const project = await run(
          client.from('projects').insert({ title: title.trim() }).select('id, title').single(),
          'Couldn’t create the project.');
        const r1 = await run(client.rpc('create_version', { p_project_id: project.id }),
          'The project was created, but r1 wasn’t.');
        return { project, version: r1 };
      },

      renameProject(id, title) {
        return run(client.from('projects').update({ title: title.trim() }).eq('id', id).select('id, title').single(),
          'Couldn’t rename the project.');
      },

      archiveProject(id) {
        return run(client.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', id)
          .select('id').single(), 'Couldn’t archive the project.');
      },

      async getProject(id) {
        const project = await run(
          client.from('projects').select('id, title, created_at, updated_at, archived_at').eq('id', id).single(),
          'Project not found.');
        const versions = await run(
          client.from('versions')
            .select('id, number, state, parent_version_id, restorability, created_at, updated_at')
            .eq('project_id', id).order('number', { ascending: true }),
          'Couldn’t load the versions.');
        return { project, versions };
      },

      // r(n+1), copied from fromVersionId when given.
      createVersion(projectId, fromVersionId) {
        const args = { p_project_id: projectId };
        if (fromVersionId) args.p_from_version_id = fromVersionId;
        return run(client.rpc('create_version', args), 'Couldn’t create the version.');
      },

      async getVersion(id) {
        const version = await run(
          client.from('versions')
            .select('id, project_id, number, state, parent_version_id, story_spec, story_sha256, dataset_id, restorability, note, created_at, updated_at')
            .eq('id', id).single(),
          'Version not found.');
        const [project, parent, artifacts, jobs] = await Promise.all([
          run(client.from('projects').select('id, title').eq('id', version.project_id).single(), 'Project not found.'),
          version.parent_version_id
            ? run(client.from('versions').select('id, number').eq('id', version.parent_version_id).single(), 'Parent not found.')
                .catch(() => null)
            : null,
          run(client.from('artifacts').select('id, job_id, kind, storage_path, mime, bytes, duration_s, width, height, created_at')
                .eq('version_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
              'Couldn’t load the files.'),
          run(client.from('jobs').select('id, job_type, state, attempt, error_class, error_code, error_detail, created_at, ended_at, progress, progress_note')
                .eq('version_id', id).order('created_at', { ascending: false }),
              'Couldn’t load the jobs.')
        ]);
        return { version, project, parent, artifacts, jobs };
      },

      saveStory(id, story) {
        return run(client.from('versions').update({ story_spec: story }).eq('id', id)
          .select('id, story_sha256, updated_at').single(), 'Couldn’t save the story.');
      },

      setVersionState(id, state) {
        return run(client.from('versions').update({ state }).eq('id', id).select('id, state').single(),
          'Couldn’t change the version.');
      },

      async fileUrl(path) {
        const data = await run(client.storage.from(ARTIFACT_BUCKET).createSignedUrl(path, 3600),
          'Couldn’t open the file.');
        return data.signedUrl;
      }
    };
  }

  window.ryagramData = ryagramData;
})();
