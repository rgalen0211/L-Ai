// Ryagram library data (2A-2). Every call the app makes to Supabase lives
// here, so the views never build queries and every failure becomes one
// readable Error. The database enforces the rules; this layer just asks.
(() => {
  const ARTIFACT_BUCKET = 'ryagram-artifacts';
  // Links to private files expire after 15 minutes; the page signs fresh ones each time it draws.
  const SIGNED_URL_SECONDS = 900;
  const JOB_COLUMNS = 'id, version_id, job_type, state, attempt, params, story_sha256, sheet_job_id, preview_job_id, engine_commit, '
    + 'cancel_requested, error_class, error_code, error_detail, progress, progress_note, created_at, started_at, ended_at';

  function ryagramData(client) {
    async function run(promise, fallback) {
      const { data, error } = await promise;
      if (error) throw new Error(error.message || fallback);
      return data;
    }

    const api = {
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
          api.listJobs(id)
        ]);
        // The database already hides files of jobs that didn't complete (partial uploads);
        // filtering here too keeps the page right against older data or the mock.
        const complete = new Set(jobs.filter(j => j.state === 'complete').map(j => j.id));
        return { version, project, parent, artifacts: artifacts.filter(a => complete.has(a.job_id)), jobs };
      },

      saveStory(id, story) {
        return run(client.from('versions').update({ story_spec: story }).eq('id', id)
          .select('id, story_sha256, updated_at').single(), 'Couldn’t save the story.');
      },

      setVersionState(id, state) {
        return run(client.from('versions').update({ state }).eq('id', id).select('id, state').single(),
          'Couldn’t change the version.');
      },

      listJobs(versionId) {
        return run(client.from('jobs').select(JOB_COLUMNS).eq('version_id', versionId)
          .order('created_at', { ascending: false }), 'Couldn’t load the jobs.');
      },

      // The database checks everything again: parameters, the ladder, the kill switch.
      submitJob(versionId, jobType, params, ladder) {
        return run(client.rpc('submit_job', {
          p_version_id: versionId, p_job_type: jobType, p_params: params || {},
          p_sheet_job_id: ladder?.sheetJobId ?? null, p_preview_job_id: ladder?.previewJobId ?? null
        }), 'Couldn’t submit the job.');
      },

      cancelJob(jobId) {
        return run(client.rpc('cancel_job', { p_job_id: jobId }), 'Couldn’t cancel the job.');
      },

      // The engine version the render worker runs now, or null when unknown (no job has run
      // yet, or the database predates current_engine_commit). Never an error for the page.
      async currentEngine() {
        try {
          const { data, error } = await client.rpc('current_engine_commit');
          return error ? null : data || null;
        } catch { return null; }
      },

      queuePosition(jobId) {
        return run(client.rpc('queue_position', { p_job_id: jobId }), 'Couldn’t read the queue.');
      },

      // Calls onChange whenever one of this version's jobs changes. live() is
      // false until Realtime confirms the subscription, so the caller polls.
      watchJobs(versionId, onChange) {
        let live = false;
        if (typeof client.channel !== 'function') return { live: () => false, stop() {} };
        const channel = client.channel(`jobs:${versionId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `version_id=eq.${versionId}` },
              () => onChange())
          .subscribe(status => { live = status === 'SUBSCRIBED'; });
        return { live: () => live, stop: () => { live = false; client.removeChannel(channel); } };
      },

      // The AI editor (an Edge Function; the Anthropic key never reaches the browser).
      async askEditor(versionId, message) {
        const { data, error } = await client.functions.invoke('ai-editor', { body: { version_id: versionId, message } });
        if (error) {
          let text = 'The editor couldn’t answer just now.';
          try { text = (await error.context.json()).error || text; } catch { /* keep the plain message */ }
          throw new Error(text);
        }
        return data;
      },

      async editorHistory(versionId) {
        const sessions = await run(client.from('ai_sessions').select('id').eq('version_id', versionId), 'Couldn’t load the conversation.');
        if (!sessions.length) return [];
        return run(client.from('ai_messages').select('role, content, created_at').eq('session_id', sessions[0].id)
          .order('created_at', { ascending: true }), 'Couldn’t load the conversation.');
      },

      async fileUrl(path) {
        const data = await run(client.storage.from(ARTIFACT_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS),
          'Couldn’t open the file.');
        return data.signedUrl;
      }
    };
    return api;
  }

  window.ryagramData = ryagramData;
})();
