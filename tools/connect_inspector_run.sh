#!/usr/bin/env bash
# Drives every connect tool through the official MCP Inspector (CLI mode) against tools/connect_dev_server.mjs.
# Usage: start the dev server, then: bash tools/connect_inspector_run.sh [url]   (default http://127.0.0.1:8787/mcp)
URL="${1:-http://127.0.0.1:8787/mcp}"
insp() { npx -y @modelcontextprotocol/inspector --cli "$URL" --transport http --header "Authorization: Bearer dev-token" "$@" 2>&1; }
tool() { local name="$1"; shift; local args=(); for a in "$@"; do args+=(--tool-arg "$a"); done; echo "=== $name $*" | cut -c1-120; insp --method tools/call --tool-name "$name" "${args[@]}" | python -c "import sys,json
t=sys.stdin.read()
try:
  d=json.loads(t); print('isError=',d.get('isError')); print(d['content'][0]['text'][:700])
except Exception: print(t[:700])"; }
GOOD=$(node --experimental-strip-types -e "import('./supabase/functions/_shared/templates.ts').then(m=>{const t=m.TEMPLATES[0];console.log(JSON.stringify(m.build(t.id,t.datasets[0],'Inspector film')))})" 2>/dev/null)
tool whoami_and_credits
tool create_project title="Inspector film"
PID=$(insp --method tools/call --tool-name list_projects | python -c "import sys,json;print(json.load(sys.stdin)['structuredContent']['projects'][0]['id'])")
tool set_story project_id="$PID" story='{"schema":2,"engine":"sequence","sequence":{"clips":[]}}'
tool set_story project_id="$PID" story="$GOOD"
tool make_contact_sheet project_id="$PID"
tool make_preview project_id="$PID"
JID=$(insp --method tools/call --tool-name make_preview --tool-arg project_id="$PID" | python -c "import sys,json;print(json.load(sys.stdin)['structuredContent']['job_id'])")
tool job_status job_id="$JID"
tool job_status job_id="$JID"
tool get_film_link project_id="$PID"
tool request_full_render project_id="$PID" preview_job_id="$JID" confirm=true
tool make_preview project_id="$PID" skip_checks=true
