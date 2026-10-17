// Ryagram library data (2A-2). Every call the app makes to Supabase lives
// here, so the views never build queries and every failure becomes one
// readable Error. The database enforces the rules; this layer just asks.
(() => {
  const ARTIFACT_BUCKET = 'ryagram-artifacts';
  const UPLOAD_BUCKET = 'ryagram-uploads';
  // Links to private files expire after 15 minutes; the page signs fresh ones each time it draws.
  const SIGNED_URL_SECONDS = 900;
  const JOB_COLUMNS = 'id, version_id, job_type, state, attempt, params, story_sha256, sheet_job_id, preview_job_id, engine_commit, '
    + 'cancel_requested, error_class, error_code, error_detail, progress, progress_note, created_at, started_at, ended_at';

  const LOOK_COLUMNS = 'id, name, title, based_on, spec, is_default, created_at, updated_at';

  function ryagramData(client) {
    async function run(promise, fallback) {
      const { data, error } = await promise;
      if (error) throw new Error(error.message || fallback);
      return data;
    }
    // An Edge Function that answers { url }: only Stripe's own pages (or the mock's in-app page) are followed.
    async function invokeUrl(name, body, fallback) {
      const { data, error } = await client.functions.invoke(name, { body });
      if (error) {
        let text = fallback;
        try { text = (await error.context.json()).error || text; } catch { /* keep the plain message */ }
        throw new Error(text);
      }
      const url = String(data?.url || '');
      if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(url) && !/^#\/credits(\?|$)/.test(url)) throw new Error(fallback);
      return url;
    }

    let detailColumn = null;                          // unknown until the first jobs query
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
        // The worker's title-card limits, checked HERE, before anything is sent (assets/app-limits.js): a story that would fail the render is
        // refused with a plain sentence at save time. Every save in the app goes through this function.
        const problems = window.ryagramLimits ? window.ryagramLimits.titleProblems(story) : [];
        if (problems.length) return Promise.reject(new Error(problems.join(' ')));
        return run(client.from('versions').update({ story_spec: story }).eq('id', id)
          .select('id, story_sha256, updated_at').single(), 'Couldn’t save the story.');
      },

      setVersionState(id, state) {
        return run(client.from('versions').update({ state }).eq('id', id).select('id, state').single(),
          'Couldn’t change the version.');
      },

      // progress_detail arrives with SQL 20261003000100; until then the jobs load without it.
      async listJobs(versionId) {
        const query = cols => client.from('jobs').select(cols).eq('version_id', versionId).order('created_at', { ascending: false });
        if (detailColumn !== false) {
          const { data, error } = await query(`${JOB_COLUMNS}, progress_detail`);
          if (!error) { detailColumn = true; return data; }
          if (!/progress_detail/.test(error.message || '')) throw new Error(error.message || 'Couldn’t load the jobs.');
          detailColumn = false;
        }
        return run(query(JOB_COLUMNS), 'Couldn’t load the jobs.');
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

      // Credits (2B ledger). All derived by the database; nothing here stores a balance.
      creditBalances() {
        return run(client.from('credit_balances').select('pool, available, held'), 'Couldn’t load your credits.');
      },
      async creditQuote(versionId, jobType) {
        const rows = await run(client.rpc('credit_quote', { p_version_id: versionId, p_job_type: jobType }), 'Couldn’t price this.');
        return Array.isArray(rows) ? rows[0] || null : rows;
      },
      async jobAccounting(versionId) {
        const rows = await run(client.from('job_accounting')
          .select('job_id, price_code, credits_quoted, free_preview, held, captured, released, refunded')
          .eq('version_id', versionId), 'Couldn’t load job credits.');
        return Object.fromEntries(rows.map(r => [r.job_id, r]));
      },

      // Packs and plans on sale: the current price version's codes that stripe_prices sells.
      async shopOffers() {
        const [prices, onSale] = await Promise.all([
          run(client.from('credit_prices').select('price_version, code, credits, price_cents, monthly, effective_from'), 'Couldn’t load prices.'),
          run(client.from('stripe_prices').select('price_code, mode, active'), 'Couldn’t load prices.')]);
        const now = new Date().toISOString();
        const inEffect = prices.filter(p => p.effective_from <= now);
        const current = inEffect.reduce((a, p) => (!a || p.effective_from > a.effective_from ? p : a), null)?.price_version;
        const sale = new Set(onSale.filter(s => s.active).map(s => s.price_code));
        return inEffect.filter(p => p.price_version === current && sale.has(p.code) && p.price_cents != null)
          .sort((a, b) => a.price_cents - b.price_cents);
      },
      async myPlan() {
        const rows = await run(client.from('stripe_subscriptions')
          .select('subscription_id, price_code, status, current_period_end, cancel_at_period_end'), 'Couldn’t load your plan.');
        const order = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];
        return rows.filter(r => order.includes(r.status)).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0] || null;
      },
      // Both return a Stripe URL to go to; card details are entered only on Stripe's pages.
      startCheckout(priceCode) { return invokeUrl('stripe-checkout', { price_code: priceCode }, 'Couldn’t start the checkout.'); },
      openBillingPortal() { return invokeUrl('stripe-checkout', { action: 'portal' }, 'Couldn’t open plan settings.'); },

      // Account (queue item 7). The password is Supabase Auth's; the rest is the database's.
      async changePassword(password) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new Error(error.message || 'Couldn’t change the password.');
      },
      async uploadRetention() {
        const rows = await run(client.from('account_settings').select('upload_retention'), 'Couldn’t load your settings.');
        return rows[0]?.upload_retention || 'keep';
      },
      setUploadRetention(value) {
        return run(client.from('account_settings').upsert({ upload_retention: value }, { onConflict: 'owner_id' }).select('upload_retention'),
                   'Couldn’t save your choice.');
      },
      async deleteAccount(confirmEmail) {
        const { data, error } = await client.functions.invoke('delete-account', { body: { confirm_email: confirmEmail } });
        if (error) {
          let text = 'Couldn’t delete the account just now.';
          try { text = (await error.context.json()).error || text; } catch { /* keep the plain message */ }
          throw new Error(text);
        }
        return data;
      },
      signOut() { return client.auth.signOut(); },

      // What a film is made from (SQL 20261004000100): the database makes the version's sources match its story
      // and fills each card's facts from its internal catalog. Null when that SQL isn't applied yet.
      async syncSources(versionId) {
        const { data, error } = await client.rpc('sync_version_sources', { p_version: versionId });
        if (error) {
          if (/does not exist|schema cache|PGRST202|Could not find the function/i.test(`${error.message || ''} ${error.code || ''}`)) return null;
          throw new Error(error.message || 'Couldn\u2019t load the sources.');
        }
        return data || [];
      },

      // The sources already recorded (what a refused sync left in place).
      async listSources(versionId) {
        const rows = await run(client.from('version_sources')
          .select('dataset_ref, kind, title, publisher, source_url, coverage, licence_short, licence_full, position')
          .eq('version_id', versionId).order('position', { ascending: true }), 'Couldn’t load the sources.');
        return rows || [];
      },

      // Upload your own data (SQL 20261004000200/300): a spreadsheet goes to the person's own private slot, the worker reads
      // it and reports what it found, the person confirms what the columns mean, then it can be a film's data.
      // Null when that SQL isn't applied yet.
      async listUploads() {
        const { data, error } = await client.from('datasets')
          .select('id, name, filename_label, ext, bytes, status, retention, geography, mapping, ingest_report, uploaded_at, delete_requested_at, created_at')
          .eq('source', 'upload').is('deleted_at', null).is('delete_requested_at', null).order('created_at', { ascending: false });
        if (error) {
          if (/column|does not exist|schema cache/i.test(error.message || '')) return null;
          throw new Error(error.message || 'Couldn’t load your data.');
        }
        const ingests = await run(client.from('dataset_ingests').select('dataset_id, state, error_code, error_detail'), 'Couldn’t load your data.');
        const byId = new Map((ingests || []).map(i => [i.dataset_id, i]));
        return (data || []).map(d => ({ ...d, ingest: byId.get(d.id) || null }));
      },
      // Three steps, in order: open a slot (the database checks type, size and quota), put the file in it, say it's there.
      // If the file never arrives the slot is deleted so nothing is left half-made.
      async startUpload(file, { label, ext, contentType, retention }) {
        const rows = await run(client.rpc('create_upload', { p_label: label, p_ext: ext, p_bytes: file.size, p_retention: retention || null }),
          'Couldn’t start the upload.');
        const slot = Array.isArray(rows) ? rows[0] : rows;
        const { error } = await client.storage.from(UPLOAD_BUCKET).upload(slot.storage_path, file, { contentType, upsert: false });
        if (error) {
          await client.rpc('request_dataset_deletion', { p_dataset: slot.dataset_id });
          throw new Error('The file didn’t upload. Check your connection and try again.');
        }
        await run(client.rpc('finish_upload', { p_dataset: slot.dataset_id }), 'Couldn’t finish the upload.');
        return slot.dataset_id;
      },
      confirmMapping(datasetId, mapping) {
        return run(client.rpc('confirm_dataset_mapping', { p_dataset: datasetId, p_mapping: mapping }), 'Couldn’t save that.');
      },
      attachUpload(versionId, datasetId) {
        return run(client.rpc('attach_upload_to_version', { p_version: versionId, p_dataset: datasetId }), 'Couldn’t use this data.');
      },
      deleteUpload(datasetId) {
        return run(client.rpc('request_dataset_deletion', { p_dataset: datasetId }), 'Couldn’t delete this data.');
      },

      // Ryan's admin view: is this account an admin (false if the SQL isn't applied), and the
      // waitlist COUNTS per film link per day (the function refuses everyone else).
      async isAppAdmin() {
        const { data, error } = await client.rpc('is_app_admin');
        return !error && data === true;
      },
      waitlistByFilm(days) {
        return run(client.rpc('waitlist_by_film', { p_days: days }), 'Couldn\u2019t load the waitlist counts.');
      },
      // Visits to /ryagram/ (a cookieless tally, SQL 20261006000100) next to signups, by day and by link source. Admin only.
      visitsByDay(days) {
        return run(client.rpc('visits_by_day', { p_days: days }), 'Couldn\u2019t load the visit counts.');
      },
      visitsBySource(days) {
        return run(client.rpc('visits_by_source', { p_days: days }), 'Couldn\u2019t load the visit counts.');
      },

      // Operations (SQL 20261010000100): is rendering alive? Never throws: no answer means no notice.
      async serviceStatus() {
        try {
          const { data, error } = await client.rpc('service_status');
          return error ? null : data;
        } catch { return null; }
      },
      // The help form. job is the person's own job id (the server attaches its state and error code, never its content);
      // website is the hidden honeypot field and must stay empty.
      async submitSupport({ email, topic, message, job, website }) {
        return run(client.rpc('submit_support', { p_email: email, p_topic: topic, p_message: message, p_job: job || null, p_website: website || '' }),
          'Couldn\u2019t send that just now. Please try again, or write to ryagram@uselai.com.');
      },

      // Ryan's Operations screen (SQL 20261010000100): one summary, and the three buttons. Admin only; the functions refuse everyone else.
      adminOps() { return run(client.rpc('admin_ops'), 'Couldn\u2019t load operations.'); },
      adminAnswerSupport(id) { return run(client.rpc('admin_answer_support', { p_id: id }), 'Couldn\u2019t update that.'); },
      adminAckStripe(id) { return run(client.rpc('admin_ack_stripe', { p_event_id: id }), 'Couldn’t update that payment event.'); },
      // Creator beta applications (SQL 20261014000100): Ryan's list, and Approve / Decline. Neither sends anything or moves credits.
      adminCreatorBeta() { return run(client.rpc('admin_creator_beta'), 'Couldn\u2019t load creator applications.'); },
      adminDecideCreator(id, decision) { return run(client.rpc('admin_decide_creator', { p_id: id, p_decision: decision }), 'Couldn\u2019t update that application.'); },
      // Creator beta flow (SQL 20261016000200): a signed-in person asks for a film; Ryan makes invites and moves requests along. Each is one RPC.
      filmRequestCost() { return run(client.rpc('film_request_cost'), 'Couldn\u2019t load the price.'); },
      requestFilm(question, notes) { return run(client.rpc('request_film', { p_question: question, p_notes: notes || '' }), 'Couldn\u2019t send that request.'); },
      myFilmRequests() { return run(client.from('film_requests').select('id, created_at, question, notes, credits, status, admin_note, delivered_url').order('id', { ascending: false }).limit(30), 'Couldn\u2019t load your film requests.'); },
      adminFilmRequests() { return run(client.rpc('admin_film_requests'), 'Couldn\u2019t load film requests.'); },
      adminFilmRequestSet(id, status, note, url) { return run(client.rpc('admin_film_request_set', { p_id: id, p_status: status, p_note: note || '', p_url: url || null }), 'Couldn\u2019t update that request.'); },
      adminCreatorInvite(id, credits) { return run(client.rpc('admin_creator_invite', { p_id: id, p_credits: credits == null ? null : credits }), 'Couldn\u2019t make that invite.'); },
      // Engine profiles, "Your look" (SQL 20261017000300). A person reads and deletes only their own rows; every write goes through set_engine_profile(), which refuses any key the
      // profile schema does not have. The server's answer is the one that counts.
      listLooks() { return run(client.from('engine_profiles').select(LOOK_COLUMNS).order('name', { ascending: true }), 'Couldn\u2019t load your looks.'); },
      async getLook(name) {
        const rows = await run(client.from('engine_profiles').select(LOOK_COLUMNS).eq('name', name), 'Couldn\u2019t load that look.');
        return rows[0] || null;
      },
      async defaultLook() {
        const rows = await run(client.from('engine_profiles').select(LOOK_COLUMNS).eq('is_default', true), 'Couldn\u2019t load your default look.');
        return rows[0] || null;
      },
      saveLook(spec, makeDefault) { return run(client.rpc('set_engine_profile', { p_spec: spec, p_make_default: makeDefault === true }), 'Couldn\u2019t save that look.'); },
      deleteLook(id) { return run(client.from('engine_profiles').delete().eq('id', id).select('id'), 'Couldn\u2019t delete that look.'); },
      // A free contact sheet of a look on the engine's sample story, in the person's own "Profile preview (sample)" project (never a render that costs credits).
      async lookSheet(story, periods) {
        const TITLE = 'Profile preview (sample)';
        const projects = await api.listProjects();
        let project = projects.find(p => p.title === TITLE && !p.archived_at);
        let version = null;
        if (project) {
          const all = (await api.getProject(project.id)).versions;
          const last = all[all.length - 1];
          version = last && window.ryagramJobs.versionTakesJobs(last.state) ? last : await api.createVersion(project.id, null);
        } else {
          const made = await api.createProject(TITLE);
          project = made.project; version = made.version;
        }
        await api.saveStory(version.id, story);
        await api.submitJob(version.id, 'contact_sheet', { periods }, null);
        return { projectId: project.id, versionId: version.id };
      },
      async lookSheetStatus(versionId) {
        const got = await api.getVersion(versionId);
        const job = got.jobs.find(j => j.job_type === 'contact_sheet');
        if (!job) return null;
        const art = job.state === 'complete' ? got.artifacts.find(a => a.job_id === job.id && a.kind === 'contact_sheet') : null;
        let url = null;
        if (art) { try { url = await api.fileUrl(art.storage_path); } catch { url = null; } }
        return { state: job.state, job, url };
      },
      // Invite someone (SQL 20261017000200): a single-use code with welcome credits for a person Ryan names; the address stays in Ryan's mail program, never here.
      adminInvitePerson(name, credits) { return run(client.rpc('admin_invite_person', { p_name: name, p_credits: credits == null ? null : credits }), 'Couldn’t make that invite.'); },
      // Cost ledger (SQL 20261016000100): the rollup, and Ryan's limits, plans, rates and typed costs. Admin only.
      adminCostRollup(days) { return run(client.rpc('admin_cost_rollup', { p_days: days || 14 }), 'Couldn\u2019t load costs.'); },
      adminCostSetThreshold(vendor, period, limit, warnPct) { return run(client.rpc('admin_cost_set_threshold', { p_vendor: vendor || null, p_period: period, p_limit_usd: limit, p_warn_pct: warnPct || 80 }), 'Couldn\u2019t save that limit.'); },
      adminCostDeleteThreshold(id) { return run(client.rpc('admin_cost_delete_threshold', { p_id: id }), 'Couldn\u2019t remove that limit.'); },
      adminCostSetPlan(vendor, plan, monthly, startsOn, included) { return run(client.rpc('admin_cost_set_plan', { p_vendor: vendor, p_plan: plan, p_monthly_usd: monthly, p_starts_on: startsOn, p_included: included || {} }), 'Couldn\u2019t save that plan.'); },
      adminCostSetRate(vendor, kind, unitUsd, note) { return run(client.rpc('admin_cost_set_rate', { p_vendor: vendor, p_kind: kind, p_unit_usd: unitUsd, p_note: note || '' }), 'Couldn\u2019t save that rate.'); },
      adminCostRecord(vendor, amount, on, note) { return run(client.rpc('admin_cost_record', { p_vendor: vendor, p_amount_usd: amount, p_on: on, p_note: note || '' }), 'Couldn\u2019t record that cost.'); },
      adminReviewReport(id, outcome) { return run(client.rpc('admin_review_report', { p_id: id, p_outcome: outcome }), 'Couldn\u2019t update that report.'); },

      // Public film pages: opt-in per finished film. Publishing runs in the film-page function,
      // which builds the page's sources from the receipt; stopping is a plain RPC.
      async filmPage(versionId) {
        const rows = await run(client.from('film_pages').select('version_id, slug, title, published, published_at')
          .eq('version_id', versionId), 'Couldn’t load the public page.');
        return rows[0] || null;
      },
      // confirmUploaded: the owner has said yes to publishing a film made from their own upload (the page shows the film and its sources, never the data).
      async publishFilm(versionId, title, { confirmUploaded = false } = {}) {
        const { data, error } = await client.functions.invoke('film-page', { body: { version_id: versionId, title, ...(confirmUploaded ? { confirm_uploaded: true } : {}) } });
        if (error) {
          let text = 'Couldn’t publish just now.', code = null;
          try { const body = await error.context.json(); text = body.error || text; code = body.code || null; } catch { /* keep the plain message */ }
          throw Object.assign(new Error(text), { code });
        }
        return data;
      },
      // Publish, asking the owner once more when the film was made from their own upload. ask(message) -> true to go ahead. Returns { cancelled: true } when the
      // owner says no (nothing is published and no second request is sent), the publish result otherwise; any other error is thrown, never retried. The title is
      // read once, so an edit made while the question is open cannot change what gets published.
      async publishFilmWithConfirm(versionId, title, ask) {
        const fixed = String(title ?? '');
        try { return await api.publishFilm(versionId, fixed); }
        catch (err) {
          if (err.code !== 'confirm_uploaded') throw err;
          if (!ask(err.message)) return { cancelled: true };
          return api.publishFilm(versionId, fixed, { confirmUploaded: true });
        }
      },
      unpublishFilm(versionId) {
        return run(client.rpc('film_unpublish', { p_version: versionId }), 'Couldn’t stop sharing.');
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
